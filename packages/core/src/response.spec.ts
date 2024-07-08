import { describe, expect, test } from 'bun:test'
import { isHttpResponse, isHttpResponseError, makeResponse } from './response'

describe('Response', () => {
  test('should make response', () => {
    const res = makeResponse({
      status: 200,
      statusText: 'OK',
      body: 'Hello World!',
    })
    expect(res.ok).toBeTrue()
    expect(res.status).toBe(200)
    expect(res.statusText).toBe('OK')
    expect(res.body).toBe('Hello World!')
    expect(res.error).toBeNull()
  })

  test('should make error response', () => {
    const res = makeResponse({
      status: 500,
      statusText: 'Server Error',
      body: 'Server Error',
    })
    expect(res.ok).toBeFalse()
    expect(res.status).toBe(500)
    expect(res.statusText).toBe('Server Error')
    expect(res.body).toBe('Server Error')
  })

  test('should isHttpResponse function it work', () => {
    expect(
      isHttpResponse(
        makeResponse({
          status: 200,
          body: 'Hello World!',
        }),
      ),
    ).toBeTrue()
    expect(isHttpResponse({})).toBeFalse()
  })

  test('should isHttpResponseError function it work', () => {
    expect(
      isHttpResponseError(
        makeResponse({
          status: 500,
          body: 'Server Error',
        }),
      ),
    ).toBeTrue()
    expect(
      isHttpResponseError(
        makeResponse({
          status: 200,
          body: 'Hello World!',
        }),
      ),
    ).toBeFalse()
  })
})
