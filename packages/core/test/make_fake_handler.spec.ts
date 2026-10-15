import { describe, expect, test } from 'vitest'
import type { HttpRequest } from '../src/http'
import { makeFakeHandler } from './make_fake_handler'

describe('Test handler', () => {
  test('should create a fake handler', async () => {
    const body = { id: 1 }
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    const handler = makeFakeHandler({
      response: {
        status: 200,
        statusText: 'OK',
        headers,
        body,
      },
    })

    const response = await handler({
      baseEndpoint: 'https://example.com',
      endpoint: '/v1/user',
      method: 'GET',
      body,
    })

    expect(response.url).toEqual('https://example.com/v1/user')
    expect(response.status).toEqual(200)
    expect(response.statusText).toEqual('OK')
    expect(response.headers.get('Content-Type')).toEqual('application/json')
    expect(response.body).toEqual(body)
  })

  test('should preserve falsy response body values', async () => {
    for (const body of [0, false, ''] as const) {
      const handler = makeFakeHandler({
        response: {
          status: 200,
          statusText: '',
          headers: new Headers(),
          body,
        },
      })

      const response = await handler({
        baseEndpoint: 'https://example.com',
        endpoint: '/v1/user',
        method: 'GET',
      })

      expect(response.status).toBe(200)
      expect(response.statusText).toBe('')
      expect(response.body).toBe(body)
    }
  })

  test('should make empty response', async () => {
    const handler = makeFakeHandler()
    const hq: HttpRequest = {
      baseEndpoint: 'https://example.com',
      endpoint: '/v1/user',
      method: 'GET',
    }

    const res = await handler(hq)
    expect(res.status).toBe(0)
    expect(res.statusText).toBe('')
  })

  test('should reject requests without baseEndpoint', async () => {
    const handler = makeFakeHandler()

    await expect(
      handler({
        endpoint: '/v1/user',
        method: 'GET',
      }),
    ).rejects.toThrowError('Client endpoint is required')
  })
})
