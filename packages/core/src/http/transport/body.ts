import type { HttpRequest } from '../../internal/http_request'
import { isBlob, isFormData, isReadableStream, isURLSearchParams } from '../../internal/type_guards'

const BODY_CONTENT_TYPE_SOURCE = 'bodyContentTypeSource'

export function serializeHttpBody(
  body: HttpRequest['body'],
): ArrayBuffer | Uint8Array<ArrayBuffer> | Blob | FormData | URLSearchParams | ReadableStream<Uint8Array> | string | null {
  switch (true) {
    case isFormData(body):
    case isBlob(body):
    case body instanceof ArrayBuffer:
    case isURLSearchParams(body):
    case isReadableStream(body):
    case typeof body === 'string':
      return body
    case ArrayBuffer.isView(body):
      // DOM BodyInit excludes SharedArrayBuffer views; the value itself is unchanged.
      return body as Uint8Array<ArrayBuffer>
    case typeof body === 'object':
    case typeof body === 'boolean':
    case typeof body === 'number':
    case Array.isArray(body):
      return JSON.stringify(body)
    default:
      return null
  }
}

export function applyRequestContentType(request: HttpRequest, headers: Headers): void {
  const body = request.body
  if (typeof body === 'undefined') {
    return
  }

  if (isFormData(body)) {
    headers.delete('Content-Type')
    return
  }

  const hasBodyContentTypeSource = Object.hasOwn(request, BODY_CONTENT_TYPE_SOURCE)
  const bodyContentType = !hasBodyContentTypeSource || request.bodyContentTypeSource === body ? request.bodyContentType : undefined

  if (bodyContentType === null) {
    headers.delete('Content-Type')
    return
  }

  if (typeof bodyContentType === 'string') {
    headers.set('Content-Type', bodyContentType)
    return
  }

  // A builder-declared header wins over detection. Requests without source metadata still recompute.
  if (hasBodyContentTypeSource && request.bodyContentTypeSource === body && headers.has('content-type')) {
    return
  }

  const detectedType = resolveHttpBodyContentType(body)
  if (detectedType) {
    headers.set('Content-Type', detectedType)
  }
}

export function resolveHttpBodyContentType(body: HttpRequest['body']): string | null {
  switch (true) {
    case isFormData(body):
      return null
    case body instanceof ArrayBuffer:
    case ArrayBuffer.isView(body):
      return 'application/octet-stream'
    case isBlob(body):
      return body.type || 'application/octet-stream'
    case isURLSearchParams(body):
      return 'application/x-www-form-urlencoded;charset=UTF-8'
    case isReadableStream(body):
      return 'application/octet-stream'
    case typeof body === 'string':
      return 'text/plain;charset=UTF-8'
    case body === null:
    case typeof body === 'object' && body !== null:
    case typeof body === 'number':
    case typeof body === 'boolean':
      return 'application/json'
    default:
      return null
  }
}
