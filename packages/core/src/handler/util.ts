import type { HttpRequest } from '../request'

export function getContentLength(headers: Headers): number {
  const value = headers.get('Content-Length')
  if (!value) {
    return 0
  }

  const num = Number(value)
  if (isNaN(num)) {
    return 0
  }

  return num
}

export function getContentType(headers: Headers): string {
  return headers.get('Content-Type') || ''
}

export function parseBody(params: {
  request: HttpRequest
  contentType: string
  content: Uint8Array
}): string | ArrayBuffer | Blob | object | null {
  const { request, content, contentType } = params
  const responseType = request.responseType
  if (!responseType) {
    return null
  }

  switch (responseType) {
    case 'json': {
      const text = new TextDecoder().decode(content)
      if (text === '') {
        return null
      }
      return JSON.parse(text) as object
    }
    case 'text':
      return new TextDecoder().decode(content)
    case 'blob': {
      return new Blob([content], { type: contentType })
    }
    case 'arraybuffer':
      return content.buffer
    default:
      return null
  }
}

export function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const chunksAll = new Uint8Array(totalLength)
  let position = 0
  for (const chunk of chunks) {
    chunksAll.set(chunk, position)
    position += chunk.length
  }

  return chunksAll
}
