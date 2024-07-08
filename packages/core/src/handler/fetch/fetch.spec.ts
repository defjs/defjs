import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as bun from 'bun'
import { makeHttpContext } from '../../context'
import type { HttpRequest } from '../../request'
import { FETCH_CONFIG_KEY, __createRequest, fetchHandler } from './fetch'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('Fetch handler', () => {
  let svr: bun.Server

  beforeEach(() => {
    svr = bun.serve({
      port: 0,
      fetch: async request => {
        const url = new URL(request.url)

        switch (url.pathname) {
          case '/text': {
            return new Response('Hello World!')
          }
          case '/json': {
            return Response.json({ id: 1 })
          }
          case '/null': {
            return new Response()
          }
          case '/delay': {
            await delay(10000)
            return new Response()
          }
        }

        return new Response(request.body)
      },
    })
  })

  afterEach(() => {
    svr.stop()
  })

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
      host: svr.url.origin,
      endpoint: '/json',
      method: 'GET',
      abort: abort.signal,
    }

    const { body } = await fetchHandler(hq)
    expect(body).toBeNull()
  })

  test('should throw network error', async () => {
    const abort = new AbortController()
    const hq: HttpRequest = {
      host: svr.url.origin,
      endpoint: '/delay',
      method: 'GET',
      abort: abort.signal,
    }

    setTimeout(() => {
      abort.abort()
    }, 500)
    try {
      await fetchHandler(hq)
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
    }
  })

  test('should body is json', async () => {
    const hq: HttpRequest = {
      host: svr.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'json',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toEqual({ id: 1 })
  })

  test('should body is text', async () => {
    const hq: HttpRequest = {
      host: svr.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'text',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toEqual(JSON.stringify({ id: 1 }))
  })

  test('should body is arraybuffer', async () => {
    const hq: HttpRequest = {
      host: svr.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'arraybuffer',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toBeInstanceOf(ArrayBuffer)
  })

  test('should body is blob', async () => {
    const hq: HttpRequest = {
      host: svr.url.origin,
      endpoint: '/json',
      method: 'GET',
      responseType: 'blob',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toBeInstanceOf(Blob)
  })

  test('should call downloadProgress', async () => {
    let called = false
    const hq: HttpRequest = {
      host: svr.url.origin,
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
      host: svr.url.origin,
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
      host: svr.url.origin,
      endpoint: '/',
      method: 'GET',
      context,
    }

    const request = __createRequest(hq)

    expect(request.credentials).toBe(credentials)
  })
})
