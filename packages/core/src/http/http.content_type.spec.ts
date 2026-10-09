import { describe, expect, test, vi } from 'vitest'
import { createClient, withEndpoint, withHTTPHandle } from '../client'
import { struct } from '../struct'
import { defineRequest } from './http'

const User = struct.object({ id: struct.number() })
const ApiError = struct.object({ message: struct.string() })

function clientReturning(body: string, init: ResponseInit): { cancelled: () => boolean; client: ReturnType<typeof createClient> } {
  let cancelled = false
  const handle = vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    })
    return new Response(stream, init)
  }) as unknown as typeof fetch

  return {
    cancelled: () => cancelled,
    client: createClient(withEndpoint('https://api.example.test'), withHTTPHandle(handle)),
  }
}

describe('json content-type precheck', () => {
  const useRequest = defineRequest({ error: ApiError, method: 'GET', output: User, path: '/users/1' })

  test.each([
    ['application/json'],
    ['application/json; charset=utf-8'],
    ['APPLICATION/JSON'],
    ['application/problem+json'],
    ['application/vnd.api+json'],
    ['application/vnd.github.v3+json; charset=utf-8'],
  ])('should accept %s as JSON', async (contentType) => {
    const { client } = clientReturning('{"id":1}', { headers: { 'content-type': contentType }, status: 200 })
    const [fault, data] = await client.execute(useRequest())

    expect(fault).toBeNull()
    expect(data).toEqual({ id: 1 })
  })

  test.each([['text/html'], ['text/plain'], ['application/xml'], ['application/jsonp'], ['']])(
    'should reject %s before reading the body',
    async (contentType) => {
      const { cancelled, client } = clientReturning('<!DOCTYPE html>', {
        headers: contentType ? { 'content-type': contentType } : {},
        status: 200,
      })
      const [fault, data, response] = await client.execute(useRequest())

      expect(data).toBeUndefined()
      expect(response).toBeUndefined()
      expect(fault?.code).toBe('RES_MEDIA_TYPE_INVALID')

      if (fault?.code !== 'RES_MEDIA_TYPE_INVALID') {
        throw new Error('Expected a media type fault')
      }

      expect(fault.response.status).toBe(200)
      // The point of the precheck: the body is discarded rather than read, parsed, and decoded.
      expect(cancelled()).toBe(true)
      expect(fault.response).not.toHaveProperty('body')
    },
  )

  test('should apply the precheck to the error side as well', async () => {
    const { cancelled, client } = clientReturning('<html>gateway timeout</html>', {
      headers: { 'content-type': 'text/html' },
      status: 504,
    })
    const [fault] = await client.execute(useRequest())

    expect(fault?.code).toBe('RES_MEDIA_TYPE_INVALID')
    expect(cancelled()).toBe(true)
  })

  test('should skip the precheck when no struct is declared', async () => {
    const useUndeclared = defineRequest({ method: 'GET', path: '/ping' })
    const { client } = clientReturning('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' }, status: 200 })
    const [fault, data] = await client.execute(useUndeclared())

    expect(fault).toBeNull()
    expect(data).toBeUndefined()
  })

  test('should skip the precheck when the output struct is a string', async () => {
    const useText = defineRequest({ method: 'GET', output: struct.string(), path: '/raw' })
    const { client } = clientReturning('plain body', { headers: { 'content-type': 'text/html' }, status: 200 })
    const [fault, data] = await client.execute(useText())

    expect(fault).toBeNull()
    expect(data).toBe('plain body')
  })

  test('should still precheck a JSON error when the output struct is a string', async () => {
    const useRequest = defineRequest({
      error: ApiError,
      method: 'GET',
      output: struct.string(),
      path: '/raw',
    })
    const { cancelled, client } = clientReturning('<html>gateway timeout</html>', {
      headers: { 'content-type': 'text/html' },
      status: 504,
    })
    const [fault] = await client.execute(useRequest())

    expect(fault?.code).toBe('RES_MEDIA_TYPE_INVALID')
    expect(cancelled()).toBe(true)
  })
})
