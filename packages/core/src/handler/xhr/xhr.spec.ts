import { extractHeaders, xhrHandler } from '@src/handler/xhr/xhr'
import type { HttpRequest } from '@src/request'
import { describe, expect, inject, test, vi } from 'vitest'

describe('XHR Handler', () => {
  test('should extract headers', () => {
    const headers = extractHeaders('content-type: application/json\r\nx-custom-header: custom-value')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-custom-header')).toBe('custom-value')
  })

  test('should return empty headers', () => {
    const headers = extractHeaders('')
    expect(Array.from(headers.keys()).length).toBe(0)
  })

  test('should create a request', async () => {
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    const body = { id: 1 }
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/',
      method: 'POST',
      responseType: 'json',
      headers,
      body,
    }
    const response = await xhrHandler(hq)

    expect(response.url).toEqual(new URL(hq.endpoint, hq.host).toString())
    expect(response.body).toEqual(body)
    expect(response.headers.get('Content-Type')).toEqual('application/json')
  })

  test('should cancel when timeout', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/delay',
      method: 'GET',
      responseType: 'json',
      queryParams: new URLSearchParams({ ms: '1000' }),
      timeout: 100,
    }

    await expect(xhrHandler(hq)).rejects.toThrowError()
  })

  test('should cancel when abort', async () => {
    const abort = new AbortController()
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/delay',
      method: 'GET',
      responseType: 'json',
      queryParams: new URLSearchParams({ ms: '1000' }),
      abort: abort.signal,
    }

    setTimeout(() => abort.abort(), 100)

    await expect(xhrHandler(hq)).rejects.toThrowError()
  })

  test('should cancel when request done', async () => {
    const abort = new AbortController()
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/delay',
      method: 'GET',
      responseType: 'json',
      queryParams: new URLSearchParams({ ms: '1000' }),
      abort: abort.signal,
    }

    await xhrHandler(hq)

    expect(abort.signal.aborted).toBeFalsy()
    abort.abort()
    expect(abort.signal.aborted).toBeTruthy()
  })

  test('should throw error when not supported', () => {
    vi.stubGlobal('XMLHttpRequest', undefined)

    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/delay',
      method: 'GET',
    }

    expect(() => xhrHandler(hq)).toThrowError()

    vi.unstubAllGlobals()
  })

  test('should with withCredentials', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/',
      method: 'GET',
      withCredentials: true,
    }

    await expect(xhrHandler(hq)).resolves.not.toThrowError()
  })

  test('should set content type header', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/',
      method: 'GET',
      body: new ArrayBuffer(0),
    }

    await expect(xhrHandler(hq)).resolves.not.toThrowError()
  })

  test('should set accept header', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/',
      method: 'GET',
      headers: new Headers([['Accept', 'image/png']]),
      body: new Blob([], { type: 'image/png' }),
    }

    await expect(xhrHandler(hq)).resolves.not.toThrowError()
  })

  test('should throw error when unparse body', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/',
      method: 'POST',
      responseType: 'json',
      body: 'Hello World!',
    }

    await expect(xhrHandler(hq)).rejects.toThrowError()
  })

  test('should throw error when status not ok', async () => {
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/fake',
      method: 'GET',
    }

    await expect(xhrHandler(hq)).rejects.toThrowError()
  })

  test('should throw when network error', async () => {
    const hq: HttpRequest = {
      host: 'http://localhost:9999',
      endpoint: '/fake',
      method: 'GET',
      responseType: 'json',
    }

    await expect(xhrHandler(hq)).rejects.toThrowError()
  })

  test('should call progress', async () => {
    let callUploadProgress = false
    let callDownloadProgress = false
    const hq: HttpRequest = {
      host: inject('testServerHost'),
      endpoint: '/',
      method: 'POST',
      body: new ArrayBuffer(1000),
      uploadProgress: () => {
        callUploadProgress = true
      },
      downloadProgress: () => {
        callDownloadProgress = true
      },
    }

    await xhrHandler(hq)

    expect(callUploadProgress).toBeTruthy()
    expect(callDownloadProgress).toBeTruthy()
  })
})
