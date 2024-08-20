import { makeFakeHandler } from '@src/handler/test_handler'
import type { HttpRequest } from '@src/request'
import { describe, expect, test } from 'vitest'

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
      host: 'https://example.com',
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

  test('should make empty response', async () => {
    const handler = makeFakeHandler()
    const hq: HttpRequest = {
      host: 'https://example.com',
      endpoint: '/v1/user',
      method: 'GET',
    }

    const res = await handler(hq)
    expect(res.status).toBe(0)
    expect(res.statusText).toBe('')
  })
})
