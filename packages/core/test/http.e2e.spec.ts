import { beforeEach, describe, expect, inject, test } from 'vitest'
import {
  StructError,
  createClient,
  createHttpInterceptor,
  defineRequest,
  struct,
  withEndpoint,
  withInterceptors,
  withQuerySerializer,
} from '../src'
import type { AnyStruct, Client, Infer } from '../src'
import type { HttpCommand } from '../src/http/http'

test('should settle public HTTP cancellation when an interceptor hangs after a real response', async () => {
  const controller = new AbortController()
  let markNextResolved!: () => void
  const nextResolved = new Promise<void>((resolve) => {
    markNextResolved = resolve
  })
  const client = createClient(
    withEndpoint(inject('testServerHost')),
    withInterceptors(
      createHttpInterceptor(async (request, next) => {
        await next(request)
        markNextResolved()
        return await new Promise<never>(() => undefined)
      }),
    ),
  )
  const useRequest = defineRequest({ method: 'GET', path: '/' })
  const pending = client.execute(useRequest(), { signal: controller.signal })

  await nextResolved
  controller.abort('caller stopped')

  const [error, result, response] = await pending
  expect(error).toMatchObject({ code: 'NET_ABORTED' })
  expect(result).toBeUndefined()
  expect(response).toBeUndefined()
}, 2_000)

const EchoField = struct.object({
  filename: struct.string().optional(),
  name: struct.string(),
  text: struct.string(),
  type: struct.string().optional(),
})

const EchoReport = struct.object({
  bodyBase64: struct.string(),
  bodyText: struct.string(),
  fields: struct.array(EchoField),
  headers: struct.record(struct.string()),
  method: struct.string(),
  path: struct.string(),
  rawQuery: struct.string(),
})

const MissLog = struct.object({
  hits: struct.array(struct.string()),
})

const readMissLog = defineRequest({
  method: 'GET',
  output: MissLog,
  path: '/e2e/miss-log',
})

type Echo = Infer<typeof EchoReport>

// Same probe the transport uses. A runtime that rejects duplex request bodies cannot carry a ReadableStream.
function runtimeSupportsStreamingRequestBody(): boolean {
  if (typeof Request !== 'function' || typeof ReadableStream === 'undefined') {
    return false
  }

  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    const request = new Request('https://example.com/', {
      body: stream,
      duplex: 'half',
      method: 'POST',
    } as RequestInit & { duplex?: 'half' })
    return request.body !== null
  } catch {
    return false
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringifyQuery(query: { [key: string]: unknown }, prefix = ''): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    const name = prefix === '' ? key : `${prefix}[${key}]`
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${name}=${String(item)}`)
      }
      continue
    }
    if (isRecord(value)) {
      const nested = stringifyQuery(value, name)
      if (nested !== '') {
        parts.push(nested)
      }
      continue
    }
    if (typeof value !== 'undefined') {
      parts.push(`${name}=${String(value)}`)
    }
  }
  return parts.join('&')
}

async function ok<TInput extends AnyStruct | undefined, TOutput extends AnyStruct, TError extends AnyStruct | undefined>(
  client: Client,
  command: HttpCommand<TInput, TOutput, TError>,
): Promise<Infer<TOutput>> {
  const [error, result] = await client.execute(command)
  expect(error).toBeNull()
  if (result === undefined) {
    throw new Error('Expected a decoded success value')
  }
  return result
}

describe('request builder through the real server', () => {
  let client: Client
  let host: string

  beforeEach(() => {
    host = inject('testServerHost')
    client = createClient(withEndpoint(host))
  })

  async function echo<TInput extends AnyStruct | undefined>(command: HttpCommand<TInput, typeof EchoReport, undefined>): Promise<Echo> {
    return ok(client, command)
  }

  async function missHits(path: string): Promise<readonly string[]> {
    const log = await ok(client, readMissLog())
    return log.hits.filter((hit) => hit.endsWith(` ${path}`))
  }

  async function pingMiss(path: string): Promise<void> {
    const response = await fetch(`${host}${path}`)
    await response.arrayBuffer()
  }

  test('fills path params from a tagged object, applying aliases', async () => {
    const loadUser = defineRequest({
      builder: (input) => ({ path: input }),
      input: struct.object({
        orgId: struct.number().alias('org_id'),
        userId: struct.number().alias('user_id'),
      }),
      method: 'GET',
      output: EchoReport,
      path: '/e2e/echo/orgs/:org_id/users/:user_id',
    })

    const report = await echo(loadUser({ orgId: 3, userId: 7 }))

    expect(report.method).toBe('GET')
    expect(report.path).toBe('/e2e/echo/orgs/3/users/7')
    expect(report.rawQuery).toBe('')
    expect(report.bodyText).toBe('')
  })

  test('encodes flat query values and repeated array keys with the default serializer', async () => {
    const search = defineRequest({
      builder: (input) => ({ query: input }),
      input: struct.object({
        keyword: struct.string(),
        pageSize: struct.number().alias('page_size'),
        tags: struct.array(struct.string()),
      }),
      method: 'GET',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const report = await echo(search({ keyword: 'ada lovelace', pageSize: 10, tags: ['a', 'b'] }))

    expect(report.rawQuery).toBe('keyword=ada+lovelace&page_size=10&tags=a&tags=b')
  })

  test('sends a builder URLSearchParams query verbatim and skips the query serializer', async () => {
    const query = new URLSearchParams()
    query.append('tag', 'a')
    query.append('tag', 'b')
    const serialized = createClient(
      withEndpoint(host),
      withQuerySerializer(() => 'forced=1'),
    )
    const list = defineRequest({
      builder: () => ({ query }),
      method: 'GET',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const report = await ok(serialized, list())

    expect(report.rawQuery).toBe('tag=a&tag=b')
  })

  test('passes alias-encoded nested query objects to withQuerySerializer and the server receives that string', async () => {
    let seen: unknown
    const serialized = createClient(
      withEndpoint(host),
      withQuerySerializer((query) => {
        seen = query
        return stringifyQuery(query)
      }),
    )
    const search = defineRequest({
      builder: (input) => ({ query: input }),
      input: struct.object({
        filter: struct.object({
          state: struct.string().alias('state_code'),
        }),
        pageSize: struct.number().alias('page_size'),
        tags: struct.array(struct.string()),
      }),
      method: 'GET',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const report = await ok(serialized, search({ filter: { state: 'open' }, pageSize: 10, tags: ['a', 'b'] }))

    expect(seen).toEqual({
      filter: { state_code: 'open' },
      page_size: 10,
      tags: ['a', 'b'],
    })
    expect(report.rawQuery).toBe('filter[state_code]=open&page_size=10&tags=a&tags=b')
  })

  test('sends an aliased header record and a native Headers object', async () => {
    const withRecord = defineRequest({
      builder: (input) => ({
        headers: {
          'x-api-version': '2',
          ...input,
        },
      }),
      input: struct.object({
        traceId: struct.string().alias('x-trace-id'),
      }),
      method: 'GET',
      output: EchoReport,
      path: '/e2e/echo',
    })
    const headers = new Headers()
    headers.set('x-native', 'yes')
    headers.append('x-list', 'a')
    headers.append('x-list', 'b')
    const withNative = defineRequest({
      builder: () => ({ headers }),
      method: 'GET',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const record = await echo(withRecord({ traceId: 'abc' }))
    const native = await echo(withNative())

    expect(record.headers['x-api-version']).toBe('2')
    expect(record.headers['x-trace-id']).toBe('abc')
    expect(native.headers['x-native']).toBe('yes')
    expect(native.headers['x-list']).toBe('a, b')
  })

  test('sends JSON with aliases, Date, and bigint', async () => {
    const User = struct.object({
      amount: struct.bigint(),
      birthday: struct.date(),
      displayName: struct.string().alias('display_name'),
    })
    const createUser = defineRequest({
      builder: (input) => ({ body: input.user }),
      input: struct.object({
        user: User,
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const report = await echo(
      createUser({
        user: {
          amount: 12345678901234567890n,
          birthday: new Date('1815-12-10T00:00:00.000Z'),
          displayName: 'Ada',
        },
      }),
    )

    expect(report.headers['content-type']).toBe('application/json')
    expect(report.bodyText).toBe('{"amount":"12345678901234567890","birthday":"1815-12-10T00:00:00.000Z","display_name":"Ada"}')
  })

  test('sends merge-patch JSON with null and omits undefined', async () => {
    const patchProfile = defineRequest({
      builder: (input) => ({
        body: input,
        headers: { 'content-type': 'application/merge-patch+json' },
      }),
      input: struct.object({
        bio: struct.string().nullable().optional(),
        displayName: struct.string().alias('display_name').optional(),
      }),
      method: 'PATCH',
      output: EchoReport,
      path: '/e2e/echo/me',
    })

    const report = await echo(patchProfile({ bio: null }))

    expect(report.method).toBe('PATCH')
    expect(report.headers['content-type']).toBe('application/merge-patch+json')
    expect(report.bodyText).toBe('{"bio":null}')
  })

  test('sends urlencoded codec bodies and native URLSearchParams bodies', async () => {
    const login = defineRequest({
      builder: (input) => ({ body: input.form }),
      input: struct.object({
        form: struct.urlencoded({
          password: struct.string(),
          remember: struct.boolean().optional(),
          userName: struct.string().alias('username'),
        }),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })
    const token = defineRequest({
      builder: (input) => ({
        body: new URLSearchParams({
          client_id: input.clientId,
          grant_type: 'client_credentials',
          scope: input.scope.join(' '),
        }),
      }),
      input: struct.object({
        clientId: struct.string(),
        scope: struct.array(struct.string()),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const form = await echo(login({ form: { password: 'secret', remember: true, userName: 'ada' } }))
    const native = await echo(token({ clientId: 'cid', scope: ['read', 'write'] }))

    expect(form.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    expect(form.bodyText).toBe('password=secret&remember=true&username=ada')
    expect(native.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    expect(native.bodyText).toBe('client_id=cid&grant_type=client_credentials&scope=read+write')
  })

  test('sends multipart codec bodies with array fields and native FormData file names', async () => {
    const notes = new File(['hello-file'], 'notes.txt', { type: 'text/plain' })
    const upload = defineRequest({
      builder: (input) => ({ body: input.form }),
      input: struct.object({
        form: struct.formData({
          file: struct.file(),
          tags: struct.array(struct.string()),
          title: struct.string().alias('t'),
        }),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })
    const uploadMany = defineRequest({
      builder: (input) => {
        const body = new FormData()
        input.photos.forEach((photo, index) => {
          body.append('photo', photo, `photo-${index}.jpg`)
        })
        return { body }
      },
      input: struct.object({
        photos: struct.array(struct.file()),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const coded = await echo(upload({ form: { file: notes, tags: ['red', 'blue'], title: 'Ada' } }))
    const native = await echo(
      uploadMany({
        photos: [new File(['aaa'], 'ignored-0.png', { type: 'image/png' }), new File(['bbb'], 'ignored-1.png', { type: 'image/png' })],
      }),
    )

    const fileField = coded.fields.find((field) => field.name === 'file')
    expect(coded.headers['content-type']).toMatch(/^multipart\/form-data;\s*boundary=/i)
    expect(fileField).toMatchObject({
      filename: 'notes.txt',
      name: 'file',
      text: 'hello-file',
    })
    // Bun's serializer emits the part's real Content-Type. Bun's multipart parser (`formData()`, via Hono
    // `parseBody`) drops a file part's Content-Type and reports `text/plain;charset=utf-8`, so on Bun this
    // assertion cannot tell which type was sent (this file is text/plain anyway).
    expect(fileField?.type?.toLowerCase().replace(/\s+/g, '')).toMatch(/^text\/plain(?:;charset=utf-8)?$/)
    expect(coded.fields.find((field) => field.name === 't')).toEqual({ name: 't', text: 'Ada' })
    expect(coded.fields.filter((field) => field.name === 'tags').map((field) => field.text)).toEqual(['red', 'blue'])
    expect(native.headers['content-type']).toMatch(/^multipart\/form-data;\s*boundary=/i)
    expect(
      native.fields.filter((field) => field.name === 'photo').map((field) => ({ filename: field.filename, text: field.text })),
    ).toEqual([
      { filename: 'photo-0.jpg', text: 'aaa' },
      { filename: 'photo-1.jpg', text: 'bbb' },
    ])
  })

  test('sends text/plain and a custom content-type string', async () => {
    const sendNote = defineRequest({
      builder: (input) => ({ body: input.note }),
      input: struct.object({
        note: struct.string(),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })
    const sendXml = defineRequest({
      builder: (input) => ({
        body: `<order id="${input.id}"/>`,
        headers: { 'content-type': 'application/xml' },
      }),
      input: struct.object({
        id: struct.string(),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const note = await echo(sendNote({ note: 'hello plain' }))
    const xml = await echo(sendXml({ id: '7' }))

    expect(note.headers['content-type']).toBe('text/plain;charset=UTF-8')
    expect(note.bodyText).toBe('hello plain')
    expect(xml.headers['content-type']).toBe('application/xml')
    expect(xml.bodyText).toBe('<order id="7"/>')
  })

  test('sends Blob and File bodies with their content types', async () => {
    const picture = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' })
    const document = new File([Uint8Array.from([9, 8, 7])], 'pic.bin', { type: 'application/pdf' })
    const sendBlob = defineRequest({
      builder: (input) => ({ body: input.file }),
      input: struct.object({
        file: struct.blob(),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })
    const sendFile = defineRequest({
      builder: (input) => ({ body: input.file }),
      input: struct.object({
        file: struct.file(),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const blob = await echo(sendBlob({ file: picture }))
    const file = await echo(sendFile({ file: document }))

    expect(blob.headers['content-type']).toBe('image/png')
    expect(blob.bodyBase64).toBe(bytesToBase64(Uint8Array.from([1, 2, 3, 4])))
    expect(file.headers['content-type']).toBe('application/pdf')
    expect(file.bodyBase64).toBe(bytesToBase64(Uint8Array.from([9, 8, 7])))
  })

  test('sends Uint8Array bodies as octet-stream and with an explicit content-type', async () => {
    const sendBytes = defineRequest({
      builder: () => ({ body: Uint8Array.from([1, 2, 3, 4]) }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })
    const sendProtobuf = defineRequest({
      builder: () => ({
        body: Uint8Array.from([9, 8, 7]),
        headers: { 'content-type': 'application/x-protobuf' },
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const bytes = await echo(sendBytes())
    const protobuf = await echo(sendProtobuf())

    expect(bytes.headers['content-type']).toBe('application/octet-stream')
    expect(bytes.bodyBase64).toBe(bytesToBase64(Uint8Array.from([1, 2, 3, 4])))
    expect(protobuf.headers['content-type']).toBe('application/x-protobuf')
    expect(protobuf.bodyBase64).toBe(bytesToBase64(Uint8Array.from([9, 8, 7])))
  })

  test.skipIf(!runtimeSupportsStreamingRequestBody())(
    'sends a ReadableStream body when the runtime supports duplex request bodies',
    async () => {
      const payload = new TextEncoder().encode('stream-bytes')
      const sendStream = defineRequest({
        builder: () => ({
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(payload)
              controller.close()
            },
          }),
        }),
        method: 'POST',
        output: EchoReport,
        path: '/e2e/echo',
      })

      const report = await echo(sendStream())

      expect(report.headers['content-type']).toBe('application/octet-stream')
      expect(report.bodyText).toBe('stream-bytes')
    },
  )

  test('branches a discriminated-union builder into JSON, file, and urlencoded bodies', async () => {
    const Row = struct.object({
      name: struct.string().alias('n'),
    })
    const importData = defineRequest({
      builder: (input) => {
        switch (input.source) {
          case 'json':
            return { body: input.records }
          case 'file':
            return { body: input.file }
          case 'url':
            return { body: new URLSearchParams({ source_url: input.url }) }
        }
      },
      input: struct.discriminatedUnion('source', [
        struct.object({
          records: struct.array(Row),
          source: struct.literal('json'),
        }),
        struct.object({
          file: struct.file(),
          source: struct.literal('file'),
        }),
        struct.object({
          source: struct.literal('url'),
          url: struct.string(),
        }),
      ]),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/echo',
    })

    const json = await echo(importData({ records: [{ name: 'Ada' }], source: 'json' }))
    const file = await echo(importData({ file: new File(['file-bytes'], 'data.bin', { type: 'application/x-demo' }), source: 'file' }))
    const url = await echo(importData({ source: 'url', url: 'https://example.com/a' }))

    expect(json.headers['content-type']).toBe('application/json')
    expect(json.bodyText).toBe('[{"n":"Ada"}]')
    expect(file.headers['content-type']).toBe('application/x-demo')
    expect(file.bodyText).toBe('file-bytes')
    expect(url.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    expect(url.bodyText).toBe('source_url=https%3A%2F%2Fexample.com%2Fa')
  })

  test('uses an explicit identity builder when input already has the request shape', async () => {
    const updateUser = defineRequest({
      builder: (input) => input,
      input: struct.object({
        body: struct.object({
          displayName: struct.string().alias('display_name'),
        }),
        headers: struct.object({
          traceId: struct.string().alias('x-trace-id'),
        }),
        path: struct.object({
          id: struct.number(),
        }),
        query: struct.object({
          draft: struct.boolean().optional(),
        }),
      }),
      method: 'PATCH',
      output: EchoReport,
      path: '/e2e/echo/users/:id',
    })

    const report = await echo(
      updateUser({
        body: { displayName: 'Ada' },
        headers: { traceId: 'abc' },
        path: { id: 7 },
        query: { draft: true },
      }),
    )

    expect(report.method).toBe('PATCH')
    expect(report.path).toBe('/e2e/echo/users/7')
    expect(report.rawQuery).toBe('draft=true')
    expect(report.headers['x-trace-id']).toBe('abc')
    expect(report.headers['content-type']).toBe('application/json')
    expect(report.bodyText).toBe('{"display_name":"Ada"}')
  })

  test('returns REQ_BUILD_FAILED when the builder throws and does not reach the server', async () => {
    const explode = defineRequest({
      builder: () => {
        throw new Error('builder exploded')
      },
      method: 'POST',
      output: EchoReport,
      path: '/e2e/miss/build-failed',
    })

    expect(() => explode()).not.toThrow()
    const [error, result, response] = await client.execute(explode())
    await pingMiss('/e2e/miss/build-failed-control')

    expect(error).toMatchObject({ code: 'REQ_BUILD_FAILED' })
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    if (error?.code !== 'REQ_BUILD_FAILED') {
      throw new Error('Expected REQ_BUILD_FAILED')
    }
    expect(error.cause).toBeInstanceOf(Error)
    if (!(error.cause instanceof Error)) {
      throw new Error('Expected the builder error as the fault cause')
    }
    expect(error.cause.message).toBe('builder exploded')
    expect(await missHits('/e2e/miss/build-failed')).toEqual([])
    expect(await missHits('/e2e/miss/build-failed-control')).toEqual(['GET /e2e/miss/build-failed-control'])
  })

  test('returns REQ_INPUT_INVALID for invalid input and does not reach the server', async () => {
    const create = defineRequest({
      builder: (input) => ({ body: { name: input.name } }),
      input: struct.object({
        name: struct.string(),
      }),
      method: 'POST',
      output: EchoReport,
      path: '/e2e/miss/input-invalid',
    })

    const [error, result, response] = await client.execute(create({ name: 1 } as never))
    await pingMiss('/e2e/miss/input-invalid-control')

    expect(error).toMatchObject({ code: 'REQ_INPUT_INVALID' })
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    if (error?.code !== 'REQ_INPUT_INVALID') {
      throw new Error('Expected REQ_INPUT_INVALID')
    }
    expect(error.cause).toBeInstanceOf(StructError)
    expect(await missHits('/e2e/miss/input-invalid')).toEqual([])
    expect(await missHits('/e2e/miss/input-invalid-control')).toEqual(['GET /e2e/miss/input-invalid-control'])
  })
})

describe('inbound representation through the real server', () => {
  let client: Client

  beforeEach(() => {
    client = createClient(withEndpoint(inject('testServerHost')))
  })

  test('decodes text output and text error bodies', async () => {
    const readText = defineRequest({
      error: struct.string(),
      method: 'GET',
      output: struct.string(),
      path: '/e2e/in/text',
    })
    const readTextError = defineRequest({
      error: struct.string(),
      method: 'GET',
      output: struct.string(),
      path: '/e2e/in/text-error',
    })

    const text = await ok(client, readText())
    const [error, result, response] = await client.execute(readTextError())

    expect(text).toBe('hello-text')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an HTTP status fault')
    }
    expect(error.status).toBe(400)
    expect(error.data).toBe('bad-text')
  })

  test('decodes blob output and blob error bodies', async () => {
    const readBlob = defineRequest({
      error: struct.blob(),
      method: 'GET',
      output: struct.blob(),
      path: '/e2e/in/blob',
    })
    const readBlobError = defineRequest({
      error: struct.blob(),
      method: 'GET',
      output: struct.blob(),
      path: '/e2e/in/blob-error',
    })

    const blob = await ok(client, readBlob())
    const [error] = await client.execute(readBlobError())

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3, 4]))
    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an HTTP status fault')
    }
    expect(error.status).toBe(415)
    expect(error.data).toBeInstanceOf(Blob)
    expect(error.data.type).toBe('image/png')
    expect(new Uint8Array(await error.data.arrayBuffer())).toEqual(Uint8Array.from([5, 6, 7, 8]))
  })

  test('decodes arrayBuffer output and arrayBuffer error bodies', async () => {
    const readBytes = defineRequest({
      error: struct.arrayBuffer(),
      method: 'GET',
      output: struct.arrayBuffer(),
      path: '/e2e/in/bytes',
    })
    const readBytesError = defineRequest({
      error: struct.arrayBuffer(),
      method: 'GET',
      output: struct.arrayBuffer(),
      path: '/e2e/in/bytes-error',
    })

    const bytes = await ok(client, readBytes())
    const [error] = await client.execute(readBytesError())

    expect(bytes).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(bytes)).toEqual(Uint8Array.from([9, 8, 7]))
    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an HTTP status fault')
    }
    expect(error.status).toBe(400)
    expect(error.data).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(error.data)).toEqual(Uint8Array.from([4, 5, 6]))
  })

  test('decodes JSON output and JSON error bodies, including aliases', async () => {
    const User = struct.object({
      birthday: struct.date(),
      name: struct.string().alias('user_name'),
    })
    const Failure = struct.object({
      code: struct.string().alias('error_code'),
      message: struct.string(),
    })
    const readUser = defineRequest({
      error: Failure,
      method: 'GET',
      output: User,
      path: '/e2e/in/json',
    })
    const readUserError = defineRequest({
      error: Failure,
      method: 'GET',
      output: User,
      path: '/e2e/in/json-error',
    })

    const user = await ok(client, readUser())
    const [error] = await client.execute(readUserError())

    expect(user).toEqual({
      birthday: new Date('1815-12-10T00:00:00.000Z'),
      name: 'Ada',
    })
    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an HTTP status fault')
    }
    expect(error.status).toBe(422)
    expect(error.data).toEqual({ code: 'BAD', message: 'nope' })
  })
})
