import { ERR_ABORTED, ERR_NETWORK, ERR_TIMEOUT, ERR_UNKNOWN, HttpError } from '../../error'
import { type HttpRequest, __detectContentTypeHeader, __serializeBody } from '../../request'
import { type HttpResponse, __makeResponse } from '../../response'
import { __getContentType, __parseBody } from '../util'

export function extractHeaders(value: string): Headers {
  const headers = new Headers()

  value.split('\r\n').forEach(header => {
    const [key, value] = header.split(':')
    headers.set(key.trim(), value.trim())
  })

  return headers
}

export function xhrHandler(httpRequest: HttpRequest): Promise<HttpResponse<unknown>> {
  return new Promise((resolve, reject) => {
    const uploadProgress = httpRequest.uploadProgress
    const downloadProgress = httpRequest.downloadProgress
    const xhr = new (globalThis || window).XMLHttpRequest()

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
      const status = xhr.status
      const statusText = xhr.statusText
      const headers = extractHeaders(xhr.getAllResponseHeaders())
      const contentType = __getContentType(headers)
      const body = __parseBody({
        request: httpRequest,
        contentType,
        content: xhr.response,
      })

      resolve(
        __makeResponse({
          body,
          headers,
          status,
          statusText,
          url: xhr.responseURL,
        }),
      )
    }
    const onError = (event: ProgressEvent) => {
      let error: Error

      switch (event.type) {
        case 'error':
          error = ERR_NETWORK
          break
        case 'timeout':
          error = ERR_TIMEOUT
          break
        case 'abort':
          error = ERR_ABORTED
          break
        default:
          error = ERR_UNKNOWN
          break
      }

      reject(
        new HttpError({
          error,
          status: xhr.status,
          statusText: xhr.statusText,
          url: xhr.responseURL,
        }),
      )
    }

    xhr.addEventListener('load', onLoad)
    xhr.addEventListener('error', onError)
    xhr.addEventListener('timeout', onError)
    xhr.addEventListener('abort', onError)

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

    const cancel = () => {
      xhr.removeEventListener('load', onLoad)
      xhr.removeEventListener('error', onError)
      xhr.removeEventListener('abort', onError)
      xhr.removeEventListener('timeout', onError)

      if (uploadProgress && xhr.upload && reqBody) {
        xhr.upload.removeEventListener('progress', onUpProgress)
      }

      if (downloadProgress) {
        xhr.removeEventListener('progress', onDownProgress)
      }

      if (xhr.readyState !== xhr.DONE) {
        xhr.abort()
      }
    }

    xhr.send(reqBody)

    if (httpRequest.abort) {
      httpRequest.abort.addEventListener('abort', cancel)
    }
  })
}
