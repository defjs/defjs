import { type HttpRequest, __detectContentTypeHeader, __serializeBody } from '@src/request'
import { ERR_ABORTED, ERR_NETWORK, ERR_TIMEOUT, ERR_UNKNOWN, type HttpResponse, type HttpResponseBody, __makeResponse } from '@src/response'
import { __getContentType, __parseBody } from '../util'

export function extractHeaders(value: string): Headers {
  const headers = new Headers()

  value.split('\r\n').forEach(header => {
    const [key, value] = header.split(':')
    if (key && value) {
      headers.set(key.trim(), value.trim())
    }
  })

  return headers
}

export function xhrHandler(httpRequest: HttpRequest): Promise<HttpResponse<unknown>> {
  return new Promise(resolve => {
    if (typeof globalThis.XMLHttpRequest !== 'function') {
      resolve(__makeResponse({ error: new Error('XMLHttpRequest is not supported') }))
      return
    }

    const xhr = new globalThis.XMLHttpRequest()
    const uploadProgress = httpRequest.uploadProgress
    const downloadProgress = httpRequest.downloadProgress

    const url = new URL(httpRequest.endpoint, httpRequest.host)
    if (httpRequest.queryParams) {
      url.search = httpRequest.queryParams.toString()
    }

    xhr.open(httpRequest.method, url, true)

    if (httpRequest.withCredentials) {
      xhr.withCredentials = true
    }

    const headers = httpRequest.headers ?? new Headers()
    headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value)
    })

    if (!headers.has('Accept')) {
      xhr.setRequestHeader('Accept', 'application/json, text/plain, */*')
    }

    if (!headers.has('Content-Type')) {
      const detectedType = __detectContentTypeHeader(httpRequest.body)
      if (detectedType) {
        headers.set('Content-Type', detectedType)
      }
    }

    /** Set the returned data as ArrayBuffer, then parse it based on httpRequest.responseType. */
    xhr.responseType = 'arraybuffer'

    xhr.timeout = httpRequest.timeout || 0

    const reqBody = __serializeBody(httpRequest.body)

    const onLoad = () => {
      const { status, statusText, responseURL, response } = xhr
      const headers = extractHeaders(xhr.getAllResponseHeaders())
      const contentType = __getContentType(headers)
      let body: HttpResponseBody = null

      try {
        body = __parseBody({
          request: httpRequest,
          contentType,
          content: response,
        })
      } catch (error) {
        resolve(
          __makeResponse({
            error,
            status,
            statusText,
            url: responseURL,
          }),
        )
        return
      }

      resolve(
        __makeResponse({
          body,
          headers,
          status,
          statusText,
          url: responseURL,
        }),
      )
    }

    const onError = (event: ProgressEvent) => {
      let error: Error = ERR_UNKNOWN

      switch (event.type) {
        case 'error':
          // todo 检查返回类型
          error = ERR_NETWORK
          break
        case 'timeout':
          error = ERR_TIMEOUT
          break
        case 'abort':
          error = ERR_ABORTED
          break
      }

      resolve(
        __makeResponse({
          error,
          status: xhr.status,
          statusText: xhr.statusText,
          url: xhr.responseURL,
        }),
      )
    }

    const onUpProgress = (event: ProgressEvent) => {
      uploadProgress?.({
        loaded: event.loaded,
        total: event.total,
        lengthComputable: event.lengthComputable,
      })
    }

    const onDownProgress = (event: ProgressEvent) => {
      downloadProgress?.({
        loaded: event.loaded,
        total: event.total,
        lengthComputable: event.lengthComputable,
      })
    }

    if (uploadProgress && xhr.upload && reqBody) {
      xhr.upload.addEventListener('progress', onUpProgress)
    }

    if (downloadProgress) {
      xhr.addEventListener('progress', onDownProgress)
    }

    if (httpRequest.abort) {
      httpRequest.abort.addEventListener('abort', () => {
        if (xhr.readyState !== xhr.DONE) {
          xhr.abort()
        }
      })
    }

    xhr.addEventListener('load', onLoad)
    xhr.addEventListener('error', onError)
    xhr.addEventListener('timeout', onError)
    xhr.addEventListener('abort', onError)

    xhr.send(reqBody)
  })
}
