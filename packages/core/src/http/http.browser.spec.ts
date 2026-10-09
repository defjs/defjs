import { afterEach, beforeEach, describe, expect, inject, test, vi } from 'vitest'

import { createClient, withEndpoint, withHTTPHandle, withXSRF } from '../client'
import type { Client } from '../client'
import { struct } from '../struct'
import { defineRequest } from './index'

describe('http browser runtime', () => {
  let baseClient: Client

  beforeEach(() => {
    baseClient = createClient(withEndpoint(inject('testServerHost')))
  })

  afterEach(() => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
  })

  test('should resolve request tuples in real browsers', async () => {
    const useGetAccount = defineRequest({
      method: 'GET',
      output: struct.object({
        id: struct.number(),
      }),
      path: '/json',
    })

    const [error, result, response] = await baseClient.execute(useGetAccount())

    expect(error).toBeNull()
    expect(result).toEqual({ id: 1 })
    expect(response?.ok).toBe(true)
  })

  test('should reject a non-JSON body for a declared JSON output in real browsers', async () => {
    const useMalformedResponse = defineRequest({
      method: 'GET',
      output: struct.object({ id: struct.number() }),
      path: '/text',
    })

    const [error, result, response] = await baseClient.execute(useMalformedResponse())

    expect(error?.code).toBe('RES_MEDIA_TYPE_INVALID')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()

    if (error?.code !== 'RES_MEDIA_TYPE_INVALID') {
      throw new Error('Expected a media type fault')
    }

    expect(error.response.status).toBe(200)
    expect(error.cause).toBeInstanceOf(TypeError)
  })

  test('should support fetch download progress hooks in real browsers', async () => {
    const downloadLoaded: number[] = []

    const useCreateAccount = defineRequest({
      input: struct.object({ body: struct.arrayBuffer() }),
      method: 'POST',
      output: struct.arrayBuffer(),
      path: '/',
    })

    const [error, result, response] = await baseClient.execute(useCreateAccount({ body: new Uint8Array(32 * 1024).buffer }), {
      onDownloadProgress(event) {
        downloadLoaded.push(event.loaded)
      },
    })

    expect(error).toBeNull()
    if (!(result instanceof ArrayBuffer)) {
      throw new Error('Expected an ArrayBuffer response')
    }
    expect(result.byteLength).toBe(32 * 1024)
    expect(response?.ok).toBe(true)
    expect(downloadLoaded.length).toBeGreaterThan(0)
  })

  test('should preserve fetch timeout semantics in request runtime', async () => {
    const useDelay = defineRequest({
      input: struct.object({ query: struct.object({ ms: struct.number() }) }),
      method: 'GET',
      path: '/delay',
    })

    const [error, result, response] = await baseClient.execute(useDelay({ query: { ms: 1000 } }), { timeout: 100 })

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('NET_TIMEOUT')
  })

  test('should inject xsrf header from document.cookie on same-origin mutating requests', async () => {
    document.cookie = 'XSRF-TOKEN=browser-cookie; path=/'

    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.url).toBe(`${window.location.origin}/xsrf`)
      expect(request.headers.get('X-XSRF-TOKEN')).toBe('browser-cookie')
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const client = createClient(withEndpoint(window.location.origin), withHTTPHandle(fetchMock), withXSRF())

    const useXsrf = defineRequest({
      method: 'POST',
      path: '/xsrf',
    })

    const [error, result, response] = await client.execute(useXsrf())

    expect(error).toBeNull()
    expect(result).toBeUndefined()
    expect(response?.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('should validate xsrf token through real server round-trip', async () => {
    await fetch('/xsrf-token')

    const client = createClient(withEndpoint(window.location.origin), withXSRF())

    const useValidate = defineRequest({
      method: 'POST',
      output: struct.object({ ok: struct.boolean() }),
      error: struct.object({ ok: struct.boolean(), reason: struct.string() }),
      path: '/xsrf-validate',
    })

    const [error, result, response] = await client.execute(useValidate())

    expect(error).toBeNull()
    expect(result).toEqual({ ok: true })
    expect(response?.ok).toBe(true)
    expect(response?.status).toBe(200)
  })

  test('should be rejected by server when xsrf header is missing', async () => {
    await fetch('/xsrf-token')

    const client = createClient(withEndpoint(window.location.origin))

    const useValidate = defineRequest({
      method: 'POST',
      output: struct.object({ ok: struct.boolean() }),
      error: struct.object({ ok: struct.boolean(), reason: struct.string() }),
      path: '/xsrf-validate',
    })

    const [error, result, response] = await client.execute(useValidate())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')

    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an http status fault')
    }

    expect(error.response.ok).toBe(false)
    expect(error.status).toBe(403)
    expect(error.data.ok).toBe(false)
  })
})
