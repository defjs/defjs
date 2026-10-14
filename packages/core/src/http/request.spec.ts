import { describe, expect, test } from 'vitest'
import { parseEndpointInput } from '../internal/endpoint_input'
import type { OutboundBuilder } from '../internal/outbound_request'
import { struct } from '../struct'
import { createHttpRequest } from './request'
import { createFetchRequestInit } from './transport/fetch'

async function formBlob(value: unknown): Promise<{ text: string; type: string }> {
  expect(value).toBeInstanceOf(Blob)
  const blob = value as Blob
  return { text: await blob.text(), type: blob.type }
}

const options = {
  abort: new AbortController().signal,
  baseEndpoint: 'https://api.example.com',
}

describe('http request helpers', () => {
  test('should create http request with builder params query headers and custom serializer', () => {
    const abort = new AbortController()
    const request = createHttpRequest(
      'POST',
      '/user/:id',
      {
        body: { nickname: 'Miao' },
        headers: { token: 'secret' },
        path: { id: 7 },
        query: { include: true, tags: ['a', 'b'] },
      },
      ((input: {
        body: { nickname: string }
        headers: { token: string }
        path: { id: number }
        query: { include: boolean; tags: string[] }
      }) => ({
        body: { nickname: input.body.nickname },
        headers: { 'x-token': input.headers.token },
        path: { id: input.path.id },
        query: { include: input.query.include, tags: input.query.tags },
      })) as OutboundBuilder,
      {
        abort: abort.signal,
        baseEndpoint: 'https://api.example.com/v1',
        operation: 'users.update',
        querySerializer: (query) => {
          const params = new URLSearchParams()
          for (const [key, value] of Object.entries(query)) {
            if (Array.isArray(value)) {
              for (const item of value) {
                params.append(key, String(item))
              }
              continue
            }
            params.set(key, String(value))
          }
          return `custom=${params.toString()}`
        },
        responseType: 'json',
        withCredentials: true,
      },
    )

    expect(request.baseEndpoint).toBe('https://api.example.com/v1')
    expect(request.endpoint).toBe('/user/7')
    expect(request.operation).toBe('users.update')
    expect(request.queryParams?.get('custom')).toBe('include=true')
    expect(request.queryParams?.getAll('tags')).toEqual(['a', 'b'])
    expect(request.queryString).toBe('custom=include=true&tags=a&tags=b')
    expect(request.headers?.get('x-token')).toBe('secret')
    expect(request.headers?.has('content-type')).toBe(false)
    expect(request.bodyContentType).toBe('application/json')
    expect(request.responseType).toBe('json')
    expect(request.withCredentials).toBe(true)
    expect(request.body).toBe('{"nickname":"Miao"}')
  })

  test('should reject request-shaped missing path params', () => {
    expect(() =>
      createHttpRequest('GET', '/user/:id', { path: {} }, (input) => input, {
        abort: new AbortController().signal,
        baseEndpoint: 'https://api.example.com',
      }),
    ).toThrow('Missing path param: id')
  })

  test('should pass encoded query values to a custom querySerializer', () => {
    const request = createHttpRequest('GET', '/search', { query: { filter: ['active'], include: true } }, (input) => input, {
      abort: new AbortController().signal,
      baseEndpoint: 'https://api.example.com',
      querySerializer: (query) => {
        expect(query).toEqual({ filter: ['active'], include: true })
        return `include=${String(query['include'])}&filter=${encodeURIComponent(JSON.stringify(query['filter']))}`
      },
    })

    expect(request.queryString).toBe(`include=true&filter=${encodeURIComponent(JSON.stringify(['active']))}`)
  })

  test('should encode aliases from parsed endpoint input', async () => {
    const profile = struct.object({
      displayName: struct.string().alias('display_name'),
      internalNote: struct.string(),
    })
    const input = struct.object({
      body: struct.object({
        profile: profile.alias('profile'),
      }),
      path: struct.object({
        orgId: struct.string().alias('org_id'),
      }),
    })
    const parsed = await parseEndpointInput(input, {
      body: {
        profile: {
          displayName: 'Miao',
          internalNote: 'local',
        },
      },
      path: {
        orgId: 'org_1',
      },
    })
    const request = createHttpRequest('POST', '/orgs/:org_id/users', parsed, (input) => input, options)

    expect(request.endpoint).toBe('/orgs/org_1/users')
    expect(request.queryString).toBe('')
    expect(request.body).toBe('{"profile":{"display_name":"Miao","internalNote":"local"}}')
    expect(request.headers?.has('content-type')).toBe(false)
    expect(request.bodyContentType).toBe('application/json')
  })

  test('should encode path query and json body aliases independently', async () => {
    const input = struct.object({
      body: struct.object({
        bodyName: struct.string().alias('name'),
        bodyUid: struct.number().alias('uid'),
      }),
      path: struct.object({
        pathUid: struct.number().alias('uid'),
      }),
      query: struct.object({
        queryName: struct.string().alias('name'),
      }),
    })
    const parsed = await parseEndpointInput(input, {
      body: {
        bodyName: 'baby',
        bodyUid: 1,
      },
      path: {
        pathUid: 7,
      },
      query: {
        queryName: 'Jack',
      },
    })
    const request = createHttpRequest('POST', '/users/:uid', parsed, (input) => input, options)

    expect(request.endpoint).toBe('/users/7')
    expect(request.queryString).toBe('name=Jack')
    expect(JSON.parse(request.body as string)).toEqual({ name: 'baby', uid: 1 })
  })

  test('should support text xml form-url-encoded and raw bodies', async () => {
    const textRequest = createHttpRequest('POST', '/text', undefined, (() => ({ body: 'hello' })) as OutboundBuilder, options)

    expect(textRequest.body).toBe('hello')
    expect(textRequest.headers?.has('content-type')).toBe(false)
    expect(textRequest.bodyContentType).toBe('text/plain;charset=UTF-8')

    const xmlRequest = createHttpRequest(
      'POST',
      '/xml',
      undefined,
      (() => ({
        body: '<root />',
        headers: { 'content-type': 'text/xml;charset=UTF-8' },
      })) as OutboundBuilder,
      options,
    )

    expect(xmlRequest.body).toBe('<root />')
    expect(xmlRequest.headers?.get('content-type')).toBe('text/xml;charset=UTF-8')

    const Form = struct.urlencoded({
      ids: struct.array(struct.number()),
    })
    const parsed = await parseEndpointInput(Form, { ids: [1, 2] })
    const encodedRequest = createHttpRequest('POST', '/form', undefined, (() => ({ body: parsed })) as OutboundBuilder, options)

    expect(encodedRequest.body).toBeInstanceOf(URLSearchParams)
    expect((encodedRequest.body as URLSearchParams).toString()).toBe('ids=1&ids=2')
    expect(encodedRequest.headers?.has('content-type')).toBe(false)
    expect(encodedRequest.bodyContentType).toBe('application/x-www-form-urlencoded;charset=UTF-8')

    const rawRequest = createHttpRequest(
      'POST',
      '/raw',
      undefined,
      (() => ({ body: new Uint8Array([1, 2, 3]).buffer })) as OutboundBuilder,
      options,
    )

    expect(rawRequest.body).toBeInstanceOf(ArrayBuffer)
    expect(rawRequest.headers?.has('content-type')).toBe(false)
    expect(rawRequest.bodyContentType).toBe('application/octet-stream')
  })

  test('should let a declared content-type win and classify each body once', async () => {
    const jsonRequest = createHttpRequest(
      'POST',
      '/json',
      undefined,
      (() => ({
        body: { ok: true },
        headers: { 'content-type': 'text/plain' },
      })) as OutboundBuilder,
      options,
    )
    const textRequest = createHttpRequest('POST', '/text', undefined, (() => ({ body: 'hello' })) as OutboundBuilder, options)
    const Form = struct.urlencoded({ id: struct.string() })
    const parsed = await parseEndpointInput(Form, { id: '1' })
    const urlencodedRequest = createHttpRequest('POST', '/urlencoded', undefined, (() => ({ body: parsed })) as OutboundBuilder, options)
    const nullBodyRequest = createHttpRequest('POST', '/raw-null', undefined, (() => ({ body: null })) as OutboundBuilder, options)
    const noBodyRequest = createHttpRequest('POST', '/json-undefined', undefined, (() => ({})) as OutboundBuilder, options)

    expect(jsonRequest.body).toBe('{"ok":true}')
    expect(jsonRequest.headers?.get('content-type')).toBe('text/plain')
    expect(textRequest.headers?.has('content-type')).toBe(false)
    expect(textRequest.bodyContentType).toBe('text/plain;charset=UTF-8')
    expect(urlencodedRequest.headers?.has('content-type')).toBe(false)
    expect(urlencodedRequest.bodyContentType).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    expect(nullBodyRequest.body).toBe('null')
    expect(nullBodyRequest.headers?.has('content-type')).toBe(false)
    expect(nullBodyRequest.bodyContentType).toBe('application/json')
    expect(noBodyRequest.body).toBeUndefined()
    expect(noBodyRequest.headers?.has('content-type')).toBe(false)
  })

  test('should classify scalar bodies by the body table', () => {
    const stringRequest = createHttpRequest('POST', '/json-string', undefined, (() => ({ body: 'hello' })) as OutboundBuilder, options)
    const numberRequest = createHttpRequest('POST', '/json-number', undefined, (() => ({ body: 1 })) as OutboundBuilder, options)
    const booleanRequest = createHttpRequest('POST', '/json-boolean', undefined, (() => ({ body: true })) as OutboundBuilder, options)
    const nullRequest = createHttpRequest('POST', '/json-null', undefined, (() => ({ body: null })) as OutboundBuilder, options)

    expect(stringRequest.body).toBe('hello')
    expect(stringRequest.headers?.has('content-type')).toBe(false)
    expect(stringRequest.bodyContentType).toBe('text/plain;charset=UTF-8')
    expect(numberRequest.body).toBe('1')
    expect(booleanRequest.body).toBe('true')
    expect(nullRequest.body).toBe('null')
    expect(numberRequest.headers?.has('content-type')).toBe(false)
    expect(numberRequest.bodyContentType).toBe('application/json')
  })

  test('should carry the inferred type through a request copy', () => {
    const request = createHttpRequest('POST', '/', undefined, () => ({ body: { before: true } }), options)
    const copied = { ...request, headers: new Headers(request.headers) }
    expect(copied.bodyContentType).toBe('application/json')
    expect(new Headers(createFetchRequestInit(copied).headers).get('content-type')).toBe('application/json')
  })

  test.each([
    { type: 'application/custom', header: undefined, sent: 'text/plain;charset=UTF-8' },
    { type: null, header: undefined, sent: 'text/plain;charset=UTF-8' },
    { type: undefined, header: 'application/json', sent: 'application/json' },
  ])('should detect a replaced body unless a header declares it ($type, $header)', ({ type, header, sent }) => {
    const request = createHttpRequest('POST', '/', undefined, () => ({ body: { before: true } }), options)
    const replaced = {
      ...request,
      body: 'changed',
      bodyContentType: type,
      headers: new Headers(header ? { 'content-type': header } : undefined),
    }
    expect(new Headers(createFetchRequestInit(replaced).headers).get('content-type')).toBe(sent)
  })

  test('should retain inferred media type when an interceptor removes the optional headers', () => {
    const request = createHttpRequest('POST', '/', undefined, () => ({ body: { before: true } }), options)
    request.headers = undefined
    expect(request.bodyContentType).toBe('application/json')
    expect(new Headers(createFetchRequestInit(request).headers).get('content-type')).toBe('application/json')
  })

  test('should build form data bodies and reject unsupported nested values', async () => {
    const avatar = new Blob(['avatar'], { type: 'image/png' })
    const files = [new Blob(['a']), new Blob(['b'])]
    const Form = struct.formData({
      age: struct.number(),
      avatar: struct.blob(),
      files: struct.array(struct.blob()),
      name: struct.string(),
    })
    const parsed = await parseEndpointInput(Form, {
      age: 18,
      avatar,
      files,
      name: 'Miao',
    })
    const request = createHttpRequest(
      'POST',
      '/upload',
      undefined,
      (() => ({
        body: parsed,
        headers: { 'content-type': 'multipart/form-data' },
      })) as OutboundBuilder,
      options,
    )

    expect(request.body).toBeInstanceOf(FormData)
    expect(request.headers?.has('content-type')).toBe(false)
    expect((request.body as FormData).get('age')).toBe('18')
    expect((request.body as FormData).get('name')).toBe('Miao')
    expect(await formBlob((request.body as FormData).get('avatar'))).toEqual(await formBlob(avatar))
    expect(await Promise.all((request.body as FormData).getAll('files').map((entry) => formBlob(entry)))).toEqual(
      await Promise.all(files.map((entry) => formBlob(entry))),
    )

    const Nested = struct.formData({
      profile: struct.object({ nested: struct.boolean() }),
    })
    const bad = await parseEndpointInput(Nested, { profile: { nested: true } })
    expect(() => createHttpRequest('POST', '/upload', undefined, (() => ({ body: bad })) as OutboundBuilder, options)).toThrow(/profile/)
  })
})
