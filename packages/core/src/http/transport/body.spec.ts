import { describe, expect, test } from 'vitest'
import type { HttpRequest } from '../../internal/http_request'
import { applyRequestContentType, resolveHttpBodyContentType, serializeHttpBody } from './body'

describe('http utils', () => {
  test('should keep native body types as-is when serializing', () => {
    const formData = new FormData()
    formData.append('name', 'miao')

    const blob = new Blob(['hello'], { type: 'text/plain' })
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer
    const searchParams = new URLSearchParams({ page: '1' })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })

    expect(serializeHttpBody(formData)).toBe(formData)
    expect(serializeHttpBody(blob)).toBe(blob)
    const bytes = new Uint8Array([1, 2, 3])
    const view = new DataView(bytes.buffer)
    expect(serializeHttpBody(arrayBuffer)).toBe(arrayBuffer)
    expect(serializeHttpBody(bytes)).toBe(bytes)
    expect(serializeHttpBody(view)).toBe(view)
    expect(serializeHttpBody(searchParams)).toBe(searchParams)
    expect(serializeHttpBody(stream)).toBe(stream)
    expect(serializeHttpBody('hello')).toBe('hello')
  })

  test('should stringify json-like bodies when serializing', () => {
    expect(serializeHttpBody({ id: 1, name: 'Miao' })).toBe('{"id":1,"name":"Miao"}')
    expect(serializeHttpBody(['a', 'b'])).toBe('["a","b"]')
    expect(serializeHttpBody(true)).toBe('true')
    expect(serializeHttpBody(123)).toBe('123')
  })

  test('should return null for unsupported serialized bodies', () => {
    expect(serializeHttpBody(undefined)).toBeNull()
    expect(serializeHttpBody(null)).toBe('null')
    expect(serializeHttpBody((() => 'noop') as never)).toBeNull()
  })

  test('should detect content type for supported body types', () => {
    const formData = new FormData()
    const blob = new Blob(['hello'], { type: 'text/plain' })
    const searchParams = new URLSearchParams({ page: '1' })
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })

    expect(resolveHttpBodyContentType(formData)).toBeNull()
    const bytes = new Uint8Array([1, 2, 3])
    const view = new DataView(bytes.buffer)
    expect(resolveHttpBodyContentType(arrayBuffer)).toBe('application/octet-stream')
    expect(resolveHttpBodyContentType(bytes)).toBe('application/octet-stream')
    expect(resolveHttpBodyContentType(view)).toBe('application/octet-stream')
    expect(resolveHttpBodyContentType(blob)).toBe(blob.type)
    expect(resolveHttpBodyContentType(new Blob(['hello']))).toBe('application/octet-stream')
    if (typeof File !== 'undefined') {
      const textFile = new File(['hello'], 'hello.txt', { type: 'text/plain' })
      expect(resolveHttpBodyContentType(textFile)).toBe(textFile.type)
      expect(resolveHttpBodyContentType(new File(['hello'], 'hello.bin'))).toBe('application/octet-stream')
    }
    expect(resolveHttpBodyContentType(searchParams)).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    expect(resolveHttpBodyContentType(stream)).toBe('application/octet-stream')
    expect(resolveHttpBodyContentType('hello')).toBe('text/plain;charset=UTF-8')
    expect(resolveHttpBodyContentType({ ok: true })).toBe('application/json')
    expect(resolveHttpBodyContentType(['a', 'b'])).toBe('application/json')
    expect(resolveHttpBodyContentType(true)).toBe('application/json')
    expect(resolveHttpBodyContentType(1)).toBe('application/json')
    expect(resolveHttpBodyContentType(null)).toBe('application/json')
  })

  test('should return null content type for unsupported bodies', () => {
    expect(resolveHttpBodyContentType(undefined)).toBeNull()
    expect(resolveHttpBodyContentType((() => 'noop') as never)).toBeNull()
  })

  test('should keep a header when builder source metadata matches the body', () => {
    const body = '{"ok":true}'
    const headers = new Headers({ 'Content-Type': 'application/merge-patch+json' })
    applyRequestContentType(makeRequest({ body, bodyContentTypeSource: body }), headers)

    expect(headers.get('content-type')).toBe('application/merge-patch+json')
  })

  test('should let a header win over bodyContentType', () => {
    const body = { ok: true }
    const headers = new Headers({ 'Content-Type': 'application/custom' })
    applyRequestContentType(makeRequest({ body, bodyContentType: 'application/json', bodyContentTypeSource: body }), headers)

    expect(headers.get('content-type')).toBe('application/custom')
  })

  test('should ignore stale body content type metadata', () => {
    const headers = new Headers()
    applyRequestContentType(
      makeRequest({
        body: 'plain',
        bodyContentType: 'application/json',
        bodyContentTypeSource: '{}',
      }),
      headers,
    )

    expect(headers.get('content-type')).toBe('text/plain;charset=UTF-8')
  })

  test('should allow explicit content type opt-out', () => {
    const body = 'plain'
    const headers = new Headers()
    applyRequestContentType(makeRequest({ body, bodyContentType: null, bodyContentTypeSource: body }), headers)

    expect(headers.has('content-type')).toBe(false)
  })

  test('should remove explicit content type for FormData bodies', () => {
    const headers = new Headers({ 'Content-Type': 'multipart/form-data' })
    applyRequestContentType(makeRequest({ body: new FormData() }), headers)

    expect(headers.has('content-type')).toBe(false)
  })

  test('should skip content type header when body has no detectable type', () => {
    const headers = new Headers()
    applyRequestContentType(makeRequest({ body: (() => 'noop') as never }), headers)

    expect(headers.has('content-type')).toBe(false)
  })
})

function makeRequest(init: { body: HttpRequest['body'] } & Partial<HttpRequest>): HttpRequest {
  return {
    endpoint: '/test',
    method: 'POST',
    ...init,
  }
}
