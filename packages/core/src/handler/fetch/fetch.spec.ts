import { describe, expect, test } from 'bun:test'
import { testServer } from '../../../test-setup'
import { makeHttpContext } from '../../context'
import { ERR_ABORTED, ERR_TIMEOUT, HttpErrorResponse } from '../../error'
import type { HttpRequest } from '../../request'
import { FETCH_CONFIG_KEY, __createRequest, fetchHandler } from './fetch'

describe('Fetch handler', () => {
  test('should create a request', () => {
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    const body = { id: 1 }
    const hq: HttpRequest = {
      host: 'https://example.com',
      endpoint: '/v1/user',
      method: 'GET',
      headers,
      body,
    }
    const request = __createRequest(hq)

    expect(request.url).toEqual(new URL(hq.endpoint, hq.host).toString())
    expect(request.body).toBeInstanceOf(ReadableStream)
    expect(request.headers.get('Content-Type')).toEqual('application/json')
    expect(request.method).toEqual('GET')
    expect(request.credentials).toEqual('include')
  })

  test('should add url search ', () => {
    const hq: HttpRequest = {
      host: 'https://example.com',
      endpoint: '/v1/user',
      method: 'GET',
      queryParams: new URLSearchParams({ id: '1' }),
    }

    const { url } = __createRequest(hq)
    const { searchParams } = new URL(url)
    expect(searchParams.get('id')).toEqual('1')
  })

  test('should add content type when header not set', () => {
    const hq: HttpRequest = {
      host: 'https://example.com',
      endpoint: '/v1/user',
      method: 'GET',
      body: {
        id: 1,
      },
    }

    const request = __createRequest(hq)
    expect(request.headers.get('Content-Type')).toEqual('application/json')
  })

  test('should response is null', async () => {
    const abort = new AbortController()
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/json',
      method: 'GET',
      abort: abort.signal,
    }

    const { body } = await fetchHandler(hq)
    expect(body).toBeNull()
  })

  test('should abort network', async () => {
    const abort = new AbortController()
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/delay',
      method: 'GET',
      abort: abort.signal,
      queryParams: new URLSearchParams({ ms: '5000' }),
    }

    setTimeout(() => {
      abort.abort()
    }, 0)

    try {
      await fetchHandler(hq)
    } catch (e) {
      if (!(e instanceof HttpErrorResponse)) {
        throw new Error('Not HttpErrorResponse')
      }
      expect(e.cause).toBe(ERR_ABORTED)
    }
  })

  test('should timeout network', async () => {
    const signal = AbortSignal.timeout(100)
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/delay',
      method: 'GET',
      abort: signal,
      queryParams: new URLSearchParams({ ms: '5000' }),
    }

    try {
      await fetchHandler(hq)
    } catch (e) {
      if (!(e instanceof HttpErrorResponse)) {
        throw new Error('Not HttpErrorResponse')
      }
      expect(e.cause).toBe(ERR_TIMEOUT)
    }
  })

  test('should throw error when post request set body', async () => {
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/delay',
      method: 'GET',
      body: 'Hello World!',
    }

    try {
      await fetchHandler(hq)
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
    }
  })

  test('should body is json', async () => {
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'json',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toEqual({ id: 1 })
  })

  test('should body is text', async () => {
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'text',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toEqual(JSON.stringify({ id: 1 }))
  })

  test('should throw error when http statusCode not ok', async () => {
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/500',
      method: 'GET',
      responseType: 'text',
    }

    try {
      await fetchHandler(hq)
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
    }
  })

  test('should body is arraybuffer', async () => {
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'arraybuffer',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toBeInstanceOf(ArrayBuffer)
  })

  test('should body is blob', async () => {
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'blob',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toBeInstanceOf(Blob)
  })

  test('should throw error when need json but return text', async () => {
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/text',
      method: 'GET',
      responseType: 'json',
    }

    try {
      await fetchHandler(hq)
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
    }
  })

  test('should call downloadProgress', async () => {
    let called = false
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'text',
      downloadProgress: () => {
        called = true
      },
    }

    await fetchHandler(hq)
    expect(called).toBeTrue()
  })

  test('should parse body throw error', async () => {
    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/',
      method: 'GET',
      responseType: 'json',
      body: '',
    }

    try {
      await fetchHandler(hq)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })

  test('should set fetch config', () => {
    const credentials = 'include'
    const context = makeHttpContext()
    context.set(FETCH_CONFIG_KEY, { credentials })

    const hq: HttpRequest = {
      host: testServer.url.origin,
      endpoint: '/',
      method: 'GET',
      context,
    }

    const request = __createRequest(hq)

    expect(request.credentials).toBe(credentials)
  })
})
