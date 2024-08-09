import { describe, expect, test } from 'bun:test'
import { __makeResponse, isHttpResponse } from './response'

describe('Response', () => {
  test('should make response', () => {
    const res = __makeResponse({
      status: 200,
      statusText: 'OK',
      body: 'Hello World!',
    })
    expect(res.ok).toBeTrue()
    expect(res.status).toBe(200)
    expect(res.statusText).toBe('OK')
    expect(res.body).toBe('Hello World!')
  })

  test('should make error response', () => {
    const res = __makeResponse({
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
        __makeResponse({
          status: 200,
          body: 'Hello World!',
        }),
      ),
    ).toBeTrue()
    expect(isHttpResponse({})).toBeFalse()
  })
})
