import { describe, expect, test } from 'vitest'
import { getHttpErrorMessage, makeResponse } from './http_response'

describe('Response', () => {
  test('should make response', () => {
    const res = makeResponse({
      status: 200,
      statusText: 'OK',
      body: 'Hello World!',
    })
    expect(res.status).toBe(200)
    expect(res.statusText).toBe('OK')
    expect(res.body).toBe('Hello World!')
    expect(res.ok).toBe(true)
  })

  test('should make error response', () => {
    const res = makeResponse({
      status: 500,
      statusText: 'Server Error',
      body: 'Server Error',
    })
    expect(res.status).toBe(500)
    expect(res.statusText).toBe('Server Error')
    expect(res.body).toBe('Server Error')
    expect(res.ok).toBe(false)
  })

  test('should default to a bare status-0 response with no synthesized failure', () => {
    // Transport failures are faults now, so a response never stands in for one.
    const res = makeResponse()
    expect(res.status).toBe(0)
    expect(res.statusText).toBe('')
    expect(res.ok).toBe(false)
    expect(res.body).toBeUndefined()
    expect(res).not.toHaveProperty('error')
  })

  test('should keep an omitted body absent and an explicit null', () => {
    const absent = makeResponse({ status: 204 })
    const parsedNull = makeResponse({ status: 200, body: null })
    expect(absent.body).toBeUndefined()
    expect(parsedNull.body).toBeNull()
    expect(makeResponse({ ...parsedNull }).body).toBeNull()
    expect({ ...absent }.body).toBeUndefined()
  })

  test('should omit resolved urls from http failure messages', () => {
    expect(
      getHttpErrorMessage({
        status: 404,
        statusText: 'Not Found',
        url: 'https://secret.example/users/1?token=abc',
      }),
    ).toBe('Http failure response: 404 - Not Found')
    expect(
      getHttpErrorMessage({
        status: 500,
        statusText: '',
        url: '',
      }),
    ).toBe('Http failure response: 500')
  })

  test('should copy request headers and url when short-circuiting', () => {
    const requestHeaders = new Headers({ 'x-request-id': 'req-1' })
    const request = {
      baseEndpoint: 'https://example.com',
      endpoint: '/cached',
      headers: requestHeaders,
      method: 'GET',
    }
    const res = makeResponse({
      body: { cached: true },
      request,
      status: 200,
    })

    expect(res.headers.get('x-request-id')).toBe('req-1')
    expect(res.headers).not.toBe(requestHeaders)
    expect(res.url).toBe('https://example.com/cached')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ cached: true })
    expect(requestHeaders.get('x-request-id')).toBe('req-1')
    expect(requestHeaders.has('authorization')).toBe(false)
  })

  test('should copy endpoint when request has no baseEndpoint', () => {
    const res = makeResponse({
      request: { endpoint: '/local', method: 'GET' },
      status: 200,
    })
    expect(res.url).toBe('/local')
    expect(res.headers).toBeInstanceOf(Headers)
  })

  test('should not treat non-2xx status as a transport or representation error', () => {
    const res = makeResponse({
      status: 404,
      statusText: 'Not Found',
      url: '/api/users',
    })

    expect(res).not.toHaveProperty('error')
    expect(res.ok).toBe(false)
  })
})
