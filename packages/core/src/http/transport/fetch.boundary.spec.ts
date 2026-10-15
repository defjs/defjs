import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, inject, test, vi } from 'vitest'
import { createClient, withEndpoint, withHTTPHandle, withInterceptors } from '../../client'
import type { HttpProgressEvent, HttpRequest } from '../../http'
import { defineRequest } from '../../http'
import { basicAuthHttpInterceptor, createHttpInterceptor } from '../../interceptor'
import { struct } from '../../struct'
import { createHttpRequest } from '../request'
import { __resetStreamingRequestBodySupportForTests, createFetchRequestInit, fetchHandler } from './fetch'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  __resetStreamingRequestBodySupportForTests()
})

describe('HTTP transport boundary regressions', () => {
  test('should preserve the real outgoing multipart boundary and report unknown upload length', async () => {
    const form = new FormData()
    form.append('file', new File(['streamed file'], 'notes.txt', { type: 'text/plain' }))
    const events: HttpProgressEvent[] = []
    const client = createClient(withEndpoint(inject('testServerHost')))
    const endpoint = defineRequest({
      builder: () => ({ body: form, headers: { 'content-type': 'application/incorrect' } }),
      method: 'POST',
      output: struct.object({ bodyBase64: struct.string(), contentType: struct.string() }),
      path: '/e2e/echo-raw',
    })
    const [fault, data] = await client.execute(endpoint(), {
      onUploadProgress: (event) => {
        events.push(event)
      },
    })

    expect(fault).toBeNull()
    expect(data?.contentType).toContain('multipart/form-data')
    expect(data?.contentType).toContain('boundary=')
    const received = new Response(
      Uint8Array.from(atob(data?.bodyBase64 ?? ''), (character) => character.charCodeAt(0)),
      {
        headers: { 'content-type': data?.contentType ?? '' },
      },
    )
    const uploaded = (await received.formData()).get('file') as File
    expect(uploaded.name).toBe('notes.txt')
    expect(await uploaded.text()).toBe('streamed file')
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0]).toEqual({ lengthComputable: false, loaded: 0, total: 0 })
    expect(events.at(-1)?.loaded).toBeGreaterThan(0)
    expect(events.every((event) => !event.lengthComputable && event.total === 0)).toBe(true)
  })

  test.runIf(!('Bun' in globalThis)).each(['timeout', 'abort'] as const)(
    'should promptly settle a stalled native FormData File upload on %s and unlock the serialized reader',
    async (mode) => {
      let release!: () => void
      let opened!: () => void
      const reading = new Promise<void>((resolve) => {
        opened = resolve
      })
      const source = new ReadableStream<Uint8Array<ArrayBuffer>>(
        {
          pull() {
            opened()
            return new Promise<void>(() => undefined)
          },
          start(controller) {
            release = () => controller.close()
          },
        },
        { highWaterMark: 0 },
      )
      class StalledFile extends File {
        override stream() {
          return source
        }
      }
      const form = new FormData()
      form.append('file', new StalledFile(['x'], 'stalled.txt'))
      const serialized: { body?: ReadableStream<Uint8Array> | null } = {}
      class TrackedResponse extends Response {
        constructor(body?: BodyInit | null, init?: ResponseInit) {
          super(body, init)
          if (body === form) {
            serialized.body = this.body
          }
        }
      }
      vi.stubGlobal('Response', TrackedResponse)
      const controller = new AbortController()
      const client = createClient(
        withEndpoint('https://example.com'),
        withHTTPHandle(async (input) => {
          await (input as Request).arrayBuffer()
          return new Response(null, { status: 204 })
        }),
      )
      const endpoint = defineRequest({ builder: () => ({ body: form }), method: 'POST', path: '/upload' })
      const pending = client.execute(
        endpoint(),
        mode === 'timeout'
          ? { timeout: 20, onUploadProgress: () => undefined }
          : { abort: controller.signal, onUploadProgress: () => undefined },
      )
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await reading
        if (mode === 'abort') {
          timer = setTimeout(() => controller.abort(), 20)
        }
        const [fault] = await settleWithin(pending)
        expect(fault?.code).toBe(mode === 'timeout' ? 'NET_TIMEOUT' : 'NET_ABORTED')
        expect(serialized.body).not.toBeNull()
        expect(serialized.body?.locked).toBe(false)
      } finally {
        clearTimeout(timer)
        if (serialized.body?.locked) {
          release()
        }
        await pending
      }
    },
  )

  test.each(['timeout', 'abort'] as const)('should cancel and unlock a stalled serialized FormData stream on %s', async (mode) => {
    const form = new FormData()
    const cancel = vi.fn()
    let release!: () => void
    const source = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        release = () => controller.close()
      },
    })
    class SerializedResponse extends Response {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        super(
          body === form ? source : body,
          body === form ? { headers: { 'content-type': 'multipart/form-data; boundary=fixture' } } : init,
        )
      }
    }
    vi.stubGlobal('Response', SerializedResponse)
    const controller = new AbortController()
    const client = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(async (input) => {
        await (input as Request).arrayBuffer()
        return new Response(null, { status: 204 })
      }),
    )
    const endpoint = defineRequest({ builder: () => ({ body: form }), method: 'POST', path: '/' })
    const pending = client.execute(
      endpoint(),
      mode === 'timeout'
        ? { timeout: 20, onUploadProgress: () => undefined }
        : { abort: controller.signal, onUploadProgress: () => undefined },
    )
    const timer = mode === 'abort' ? setTimeout(() => controller.abort(), 20) : undefined
    try {
      const [fault] = await settleWithin(pending)
      expect(fault?.code).toBe(mode === 'timeout' ? 'NET_TIMEOUT' : 'NET_ABORTED')
      expect(cancel).toHaveBeenCalledOnce()
      expect(source.locked).toBe(false)
    } finally {
      clearTimeout(timer)
      if (source.locked) {
        release()
        await pending
      }
    }
  })

  test('should preserve a start observer failure even when converted stream cancellation rejects', async () => {
    const body = new Blob(['bytes'])
    const cancel = vi.fn(async () => {
      throw new Error('cancel refused')
    })
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel })
    vi.spyOn(body, 'stream').mockReturnValue(source)
    const cause = new Error('observer failed')
    await expect(
      fetchHandler(
        {
          baseEndpoint: 'https://example.com',
          body,
          endpoint: '/',
          method: 'POST',
          uploadProgress() {
            throw cause
          },
        },
        async () => new Response(null),
      ),
    ).rejects.toMatchObject({ code: 'EXT_OBSERVER_FAILED', cause })
    expect(cancel).toHaveBeenCalledExactlyOnceWith(cause)
    expect(source.locked).toBe(false)
  })

  test.each([
    { kind: 'Blob', body: () => new Blob(['bytes'], { type: 'text/plain' }) },
    { kind: 'File', body: () => new File(['bytes'], 'bytes.txt', { type: 'text/plain' }) },
    { kind: 'ArrayBuffer', body: () => new TextEncoder().encode('bytes').buffer },
  ])('should preserve declared types when converting a $kind for upload progress', async ({ body }) => {
    for (const declaration of ['header', 'bodyContentType', 'null'] as const) {
      const request = createHttpRequest(
        'POST',
        '/upload',
        undefined,
        () => ({
          body: body(),
          headers: declaration === 'header' ? { 'content-type': 'application/custom' } : undefined,
        }),
        { abort: new AbortController().signal, baseEndpoint: 'https://example.com', responseType: 'text' },
      )
      if (declaration === 'bodyContentType') {
        request.bodyContentType = 'application/custom'
      }
      if (declaration === 'null') {
        request.bodyContentType = null
      }
      request.uploadProgress = () => undefined
      let contentType: string | null = null
      let sent = ''
      await fetchHandler(request, async (input) => {
        contentType = (input as Request).headers.get('content-type')
        sent = await (input as Request).text()
        return new Response('ok')
      })
      expect(contentType).toBe(declaration === 'null' ? null : 'application/custom')
      expect(sent).toBe('bytes')
    }
  })

  test.each(['header', 'sameHeader', 'mutatedHeader', 'bodyContentType', 'none', 'remove', 'null'] as const)(
    'should apply interceptor body replacement with %s content type metadata',
    async (declaration) => {
      let contentType: string | null = null
      let sent = ''
      const client = createClient(
        withEndpoint('https://example.com'),
        withInterceptors(
          createHttpInterceptor((request, next) => {
            const replaced: HttpRequest = { ...request, body: declaration === 'remove' ? undefined : '{"next":true}' }
            if (declaration === 'header') {
              replaced.headers = new Headers({ 'content-type': 'application/merge-patch+json' })
            }
            if (declaration === 'sameHeader') {
              replaced.headers = new Headers({ 'content-type': 'application/json' })
            }
            if (declaration === 'mutatedHeader') {
              replaced.headers?.set('content-type', 'application/json')
            }
            if (declaration === 'bodyContentType') {
              replaced.bodyContentType = 'application/json'
            }
            if (declaration === 'null') {
              replaced.bodyContentType = null
            }
            return next(replaced)
          }),
        ),
        withHTTPHandle(async (input) => {
          contentType = (input as Request).headers.get('content-type')
          sent = await (input as Request).text()
          return new Response(null, { status: 204 })
        }),
      )
      const endpoint = defineRequest({ builder: () => ({ body: { before: true } }), method: 'POST', path: '/upload' })
      const [fault] = await client.execute(endpoint())
      expect(fault).toBeNull()
      expect(sent).toBe(declaration === 'remove' ? '' : '{"next":true}')
      expect(contentType).toBe(
        declaration === 'header'
          ? 'application/merge-patch+json'
          : declaration === 'sameHeader' || declaration === 'mutatedHeader'
            ? 'application/json'
            : declaration === 'remove'
              ? null
              : 'text/plain;charset=UTF-8',
      )
    },
  )

  test('should let a signing interceptor read the inferred public body media type', async () => {
    let signedType: string | null = null
    let contentType: string | null = null
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          expect(request.headers?.has('content-type')).toBe(false)
          request.headers?.set('x-signed-content-type', request.bodyContentType ?? 'missing')
          return next(request)
        }),
      ),
      withHTTPHandle(async (input) => {
        signedType = (input as Request).headers.get('x-signed-content-type')
        contentType = (input as Request).headers.get('content-type')
        return new Response(null, { status: 204 })
      }),
    )
    const endpoint = defineRequest({ builder: () => ({ body: { signed: true } }), method: 'POST', path: '/' })
    expect((await client.execute(endpoint()))[0]).toBeNull()
    expect(signedType).toBe('application/json')
    expect(contentType).toBe('application/json')
  })

  test.each(['basicAuth', 'bodyReplacement', 'frozenClone'] as const)(
    'should keep inferred media type readable after a %s interceptor copies the request',
    async (rewrite) => {
      let signedType: string | null = null
      let contentType: string | null = null
      let authorization: string | null = null
      const client = createClient(
        withEndpoint('https://example.com'),
        withInterceptors(
          rewrite === 'basicAuth'
            ? basicAuthHttpInterceptor(() => ({ username: 'u', password: 'p' }))
            : createHttpInterceptor((request, next) =>
                next(
                  rewrite === 'frozenClone'
                    ? Object.freeze({ ...request })
                    : { ...request, body: 'changed', headers: new Headers({ 'content-type': 'text/plain;charset=UTF-8' }) },
                ),
              ),
          createHttpInterceptor((request, next) => {
            request.headers?.set('x-signed-content-type', request.headers.get('content-type') ?? request.bodyContentType ?? 'missing')
            return next(request)
          }),
        ),
        withHTTPHandle(async (input) => {
          const headers = (input as Request).headers
          signedType = headers.get('x-signed-content-type')
          contentType = headers.get('content-type')
          authorization = headers.get('authorization')
          return new Response(null, { status: 204 })
        }),
      )
      const endpoint = defineRequest({ builder: () => ({ body: { signed: true } }), method: 'POST', path: '/' })
      expect((await client.execute(endpoint()))[0]).toBeNull()
      expect(signedType).toBe(rewrite === 'bodyReplacement' ? 'text/plain;charset=UTF-8' : 'application/json')
      expect(contentType).toBe(rewrite === 'bodyReplacement' ? 'text/plain;charset=UTF-8' : 'application/json')
      expect(authorization).toBe(rewrite === 'basicAuth' ? 'Basic dTpw' : null)
    },
  )

  test.each(['inferred', 'explicit'] as const)('should preserve a direct header override with %s body metadata', async (metadata) => {
    let contentType: string | null = null
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          request.headers?.set('content-type', 'application/custom')
          if (metadata === 'explicit') {
            request.bodyContentType = 'application/json'
          }
          return next(request)
        }),
      ),
      withHTTPHandle(async (input) => {
        contentType = (input as Request).headers.get('content-type')
        return new Response(null, { status: 204 })
      }),
    )
    const endpoint = defineRequest({ builder: () => ({ body: { before: true } }), method: 'POST', path: '/' })
    expect((await client.execute(endpoint()))[0]).toBeNull()
    expect(contentType).toBe('application/custom')
  })

  test('should let an interceptor sign the inferred type on its own copy of the request', async () => {
    let signedType: string | null = null
    let contentType: string | null = null
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          const copy = { ...request, headers: new Headers(request.headers) }
          copy.headers.set('x-signed-content-type', copy.headers.get('content-type') ?? copy.bodyContentType ?? 'missing')
          return next(copy)
        }),
      ),
      withHTTPHandle(async (input) => {
        signedType = (input as Request).headers.get('x-signed-content-type')
        contentType = (input as Request).headers.get('content-type')
        return new Response(null, { status: 204 })
      }),
    )
    const endpoint = defineRequest({ builder: () => ({ body: { signed: true } }), method: 'POST', path: '/' })
    expect((await client.execute(endpoint()))[0]).toBeNull()
    expect(signedType).toBe('application/json')
    expect(contentType).toBe('application/json')
  })

  test('should retain a declared header when an interceptor removes the body', async () => {
    const request = createHttpRequest(
      'POST',
      '/',
      undefined,
      () => ({ body: 'before', headers: { 'content-type': 'application/custom' } }),
      {
        abort: new AbortController().signal,
        baseEndpoint: 'https://example.com',
      },
    )
    expect(new Headers(createFetchRequestInit({ ...request, body: undefined }).headers).get('content-type')).toBe('application/custom')
  })

  test.each([
    { encoding: 'gzip', total: 0 },
    { encoding: 'br', total: 0 },
    { encoding: '', total: 0 },
    { encoding: 'identity', total: 5 },
    { encoding: ' IDENTITY ', total: 5 },
    { encoding: undefined, total: 5 },
  ])('should report decoded download length for encoding $encoding', async ({ encoding, total }) => {
    const events: HttpProgressEvent[] = []
    const response = await fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        endpoint: '/',
        method: 'GET',
        responseType: 'text',
        downloadProgress: (event) => {
          events.push(event)
        },
      },
      async () =>
        new Response('hello', {
          headers: {
            'content-length': '5',
            ...(encoding === undefined ? {} : { 'content-encoding': encoding }),
          },
        }),
    )
    expect(response.body).toBe('hello')
    expect(events.at(-1)).toEqual({ lengthComputable: total > 0, loaded: 5, total })
  })

  test('should stop trusting Content-Length once decoded bytes exceed it without an exposed encoding', async () => {
    const events: HttpProgressEvent[] = []
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of ['ab', 'cdef', 'gh']) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })
    const response = await fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        endpoint: '/',
        method: 'GET',
        responseType: 'text',
        downloadProgress: (event) => {
          events.push(event)
        },
      },
      async () => new Response(body, { headers: { 'content-length': '3' } }),
    )
    expect(response.body).toBe('abcdefgh')
    expect(events).toEqual([
      { lengthComputable: true, loaded: 2, total: 3 },
      { lengthComputable: false, loaded: 6, total: 0 },
      { lengthComputable: false, loaded: 8, total: 0 },
    ])
  })

  test.each(['default', 'custom'] as const)('should report unknown total for a real gzip response via %s fetch', async (handle) => {
    const text = 'decoded '.repeat(1000)
    const compressed = gzipSync(text)
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-length': compressed.byteLength })
      response.end(compressed)
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('expected a loopback server')
      }
      const events: HttpProgressEvent[] = []
      const client =
        handle === 'default'
          ? createClient(withEndpoint(`http://127.0.0.1:${address.port}`))
          : createClient(
              withEndpoint(`http://127.0.0.1:${address.port}`),
              withHTTPHandle((input, init) => fetch(input, init)),
            )
      const [fault, data] = await client.execute(defineRequest({ method: 'GET', output: struct.string(), path: '/' })(), {
        onDownloadProgress: (event) => {
          events.push(event)
        },
      })
      expect(fault).toBeNull()
      expect(data).toBe(text)
      expect(events.at(-1)).toEqual({ lengthComputable: false, loaded: 8000, total: 0 })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  test.each(['https://example.com', 'https://other.example'] as const)(
    'should enforce Worker origin isolation for base %s',
    async (baseEndpoint) => {
      vi.stubGlobal('location', { origin: 'https://example.com' })
      vi.stubGlobal('document', undefined)
      const tokenProvider = vi.fn(() => 'worker-token')
      const client = createClient(
        withEndpoint(baseEndpoint),
        (config) => {
          config.xsrf = { cookieName: 'XSRF-TOKEN', headerName: 'x-xsrf-token', tokenProvider }
        },
        withHTTPHandle(async (input) => {
          expect((input as Request).headers.get('x-xsrf-token')).toBe(baseEndpoint === 'https://example.com' ? 'worker-token' : null)
          return new Response(null, { status: 204 })
        }),
      )
      const [fault] = await client.execute(defineRequest({ method: 'POST', path: '/' })())
      expect(fault).toBeNull()
      expect(tokenProvider).toHaveBeenCalledTimes(baseEndpoint === 'https://example.com' ? 1 : 0)
    },
  )

  test('should not read cookies in a Worker without document', () => {
    vi.stubGlobal('location', { origin: 'https://example.com' })
    vi.stubGlobal('document', undefined)
    const init = createFetchRequestInit({
      baseEndpoint: 'https://example.com',
      endpoint: '/',
      method: 'POST',
      xsrf: { cookieName: 'XSRF-TOKEN', headerName: 'x-xsrf-token' },
    })
    expect(new Headers(init.headers).has('x-xsrf-token')).toBe(false)
  })
})

function settleWithin<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('operation did not settle within 250 ms')), 250)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
