import { describe, expect, test } from 'bun:test'
import { HttpError } from '../error'
import { makeFakeHandler } from './test_handler'

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

  test('should create a fake handler with timeout', async () => {
    const handler = makeFakeHandler({
      response: {
        timeout: 100,
      },
    })

    try {
      await handler({
        host: 'https://example.com',
        endpoint: '/v1/user',
        method: 'GET',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect(error).toBeInstanceOf(Error)
    }
  })
})
