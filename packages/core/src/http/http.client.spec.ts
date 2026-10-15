import { describe, expect, test, vi } from 'vitest'
import { createClient, withEndpoint, withHTTPHandle, withInterceptors, withQuerySerializer } from '../client'
import { createHttpInterceptor } from '../interceptor'
import { makeResponse } from '../internal/http_response'
import { struct } from '../struct'
import { defineRequest } from './index'

describe('request http runtime with client config', () => {
  test('should support querySerializer from client config', async () => {
    let capturedRequestUrl = ''

    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          capturedRequestUrl = `${request.endpoint}?${request.queryString ?? ''}`
          return makeResponse({
            body: null,
            status: 200,
          })
        }),
      ),
      withQuerySerializer((query) => {
        return Object.entries(query)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key.toUpperCase()}=${String(value)}`)
          .join('&')
      }),
    )

    const useSerializedQuery = defineRequest({
      builder: (input) => input,
      input: struct.object({ query: struct.object({ a: struct.string(), b: struct.string() }) }),
      method: 'GET',
      path: '/query',
    })

    const [error] = await client.execute(useSerializedQuery({ query: { a: '1', b: '2' } }))

    expect(error).toBeNull()
    expect(capturedRequestUrl).toBe('/query?A=1&B=2')
  })

  test('should use client http handle after interceptors', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://example.com/query?A=1&B=2')
      return new Response(null, {
        status: 200,
      })
    }) as unknown as typeof fetch
    let interceptorCalls = 0

    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          interceptorCalls += 1
          return await next(request)
        }),
      ),
      withHTTPHandle(fetchMock),
      withQuerySerializer((query) => {
        return Object.entries(query)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key.toUpperCase()}=${String(value)}`)
          .join('&')
      }),
    )

    const useSerializedQuery = defineRequest({
      builder: (input) => input,
      input: struct.object({ query: struct.object({ a: struct.string(), b: struct.string() }) }),
      method: 'GET',
      path: '/query',
    })

    const [error] = await client.execute(useSerializedQuery({ query: { a: '1', b: '2' } }))

    expect(error).toBeNull()
    expect(interceptorCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('should keep the HTTP definition when the caller mutates the configuration object', async () => {
    const definition: { method: 'GET'; path: string } = { method: 'GET', path: '/first' }
    const first = defineRequest(definition)
    definition.path = '/second'
    const second = defineRequest(definition)
    const paths: string[] = []
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          paths.push(request.endpoint)
          return makeResponse({ status: 204 })
        }),
      ),
    )

    expect((await client.execute(first()))[0]).toBeNull()
    expect((await client.execute(second()))[0]).toBeNull()
    expect(paths).toEqual(['/first', '/second'])
  })
})
