import { describe, expect, inject, test } from 'vitest'
import type { HttpRequest } from '../../request'
import { ERR_ABORTED, ERR_TIMEOUT } from '../../response'
import { __createRequest, fetchHandler } from './fetch'

describe('Fetch handler', () => {
  test('should create a request', async () => {
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    const body = { id: 1 }
    const hq: HttpRequest = {
      host: 'https://example.com',
      endpoint: '/v1/user',
      method: 'POST',
      headers,
      body: { id: 1 },
      withCredentials: true,
    }
    const request = __createRequest(hq)

    expect(request.url).toEqual(new URL(hq.endpoint, hq.host).toString())
    expect(await request.json()).toEqual(body)
    expect(request.headers.get('Content-Type')).toEqual('application/json')
    expect(request.method).toEqual('POST')
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
      method: 'POST',
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
      host: inject('testServerHost'),
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
      host: inject('testServerHost'),
      endpoint: '/delay',
      method: 'GET',
      abort: abort.signal,
      queryParams: new URLSearchParams({ ms: '5000' }),
    }

    setTimeout(() => {
      abort.abort()
    }, 0)

    const { error } = await fetchHandler(hq)
    expect(error).toBe(ERR_ABORTED)
  })

  test('should timeout network', async () => {
    const signal = AbortSignal.timeout(100)
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/delay',
      method: 'GET',
      abort: signal,
      queryParams: new URLSearchParams({ ms: '10000' }),
    }

    const { error } = await fetchHandler(hq)
    expect(error).toBe(ERR_TIMEOUT)
  })

  test('should throw error when post request set body', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
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
      host: inject('testServerHost'),
      endpoint: '/json',
      method: 'GET',
      responseType: 'json',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toEqual({ id: 1 })
  })

  test('should body is text', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/json',
      method: 'GET',
      responseType: 'text',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toEqual(JSON.stringify({ id: 1 }))
  })

  test('should throw error when http statusCode not ok', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/500',
      method: 'GET',
      responseType: 'text',
    }

    const { error } = await fetchHandler(hq)
    expect(error).toBeInstanceOf(Error)
  })

  test('should body is arraybuffer', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/json',
      method: 'GET',
      responseType: 'arraybuffer',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toBeInstanceOf(ArrayBuffer)
  })

  test('should body is blob', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/json',
      method: 'GET',
      responseType: 'blob',
    }

    const { body } = await fetchHandler(hq)
    expect(body).toBeInstanceOf(Blob)
  })

  test('should throw error when need json but return text', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
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
      host: inject('testServerHost'),
      endpoint: '/json',
      method: 'GET',
      responseType: 'text',
      downloadProgress: () => {
        called = true
      },
    }

    await fetchHandler(hq)
    expect(called).toBeTruthy()
  })

  test('should parse body throw error', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
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

  test('should has accept', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/',
      method: 'POST',
      responseType: 'json',
      headers: new Headers([['Accept', 'application/json']]),
      body: { id: 1 },
    }

    await expect(fetchHandler(hq)).resolves.not.toThrowError()
  })

  test('should response body is null', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/head',
      method: 'HEAD',
    }

    const res = await fetchHandler(hq)
    expect(res.body).toBeNull()
  })
})
