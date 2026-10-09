import { describe, expect, test } from 'vitest'
import type { HttpRequest } from '../../http'
import { parseMediaTypePrefix } from '../../internal/media_type'
import { parseMediaType } from '../../internal/media_type_parameters'
import { concatChunks, getContentLength, getContentType, isJsonMediaType, parseBytesBody } from './utils'

describe('Handler util', () => {
  test('should concatenate chunks', () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
    const totalLength = 6
    const result = concatChunks(chunks, totalLength)
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
  })

  describe('test parse body', async () => {
    test('should be null when the response type is not set', async () => {
      const request: HttpRequest = {
        endpoint: '/v1/user',
        method: 'GET',
      }
      expect(parseBytesBody(request.responseType, new Uint8Array([]), '')).toBeNull()
    })

    test('should reject empty json content', () => {
      const request: HttpRequest = {
        endpoint: '/v1/user',
        method: 'GET',
        responseType: 'json',
      }
      // A present zero-length body is not a JSON value, including JSON null.
      expect(() => parseBytesBody(request.responseType, new Uint8Array([]), '')).toThrow(SyntaxError)
    })

    test('should be json when content and response type set', async () => {
      const request: HttpRequest = {
        endpoint: '/v1/user',
        method: 'GET',
        responseType: 'json',
      }
      const responseBody = { id: 1 }
      const response = Response.json(responseBody)
      const content = await response.arrayBuffer().then((buffer) => new Uint8Array(buffer))
      expect(parseBytesBody(request.responseType, content, '')).toEqual(responseBody)
    })

    test('should be text when content and response type set', async () => {
      const request: HttpRequest = {
        endpoint: '/v1/user',
        method: 'GET',
        responseType: 'text',
      }
      const responseText = 'Hello Word!'
      const response = new Response(responseText)
      const content = await response.arrayBuffer().then((buffer) => new Uint8Array(buffer))
      expect(parseBytesBody(request.responseType, content, '')).toEqual(responseText)
    })

    test('should be blob when content and response type set', async () => {
      const request: HttpRequest = {
        endpoint: '/v1/user',
        method: 'GET',
        responseType: 'blob',
      }
      const responseText = 'Hello Word!'
      const response = new Response(responseText, {
        headers: {
          'Content-Type': 'text/plain',
        },
      })
      const contentType = getContentType(response.headers)
      const content = await response.arrayBuffer().then((buffer) => new Uint8Array(buffer))
      expect(parseBytesBody(request.responseType, content, contentType)).toBeInstanceOf(Blob)
    })

    test('should be arrayBuffer when content and response type set', async () => {
      const request: HttpRequest = {
        endpoint: '/v1/user',
        method: 'GET',
        responseType: 'arraybuffer',
      }
      const responseText = 'Hello Word!'
      const response = new Response(responseText, {
        headers: {
          'Content-Type': 'text/plain',
        },
      })
      const contentType = getContentType(response.headers)
      const content = await response.arrayBuffer().then((buffer) => new Uint8Array(buffer))
      expect(parseBytesBody(request.responseType, content, contentType)).toBeInstanceOf(ArrayBuffer)
    })

    test('should return exact arraybuffer range for typed array views', () => {
      const request: HttpRequest = {
        endpoint: '/v1/user',
        method: 'GET',
        responseType: 'arraybuffer',
      }
      const backing = new Uint8Array([0, 1, 2, 3, 4])
      const content = backing.subarray(1, 4)

      const result = parseBytesBody(request.responseType, content, '')

      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(Array.from(new Uint8Array(result as ArrayBuffer))).toEqual([1, 2, 3])
    })

    test('should be null when content and response type set', async () => {
      const request: HttpRequest = {
        endpoint: '/v1/user',
        method: 'GET',
      }
      const responseText = 'Hello Word!'
      const response = new Response(responseText, {
        headers: {
          'Content-Type': 'text/plain',
        },
      })
      const contentType = getContentType(response.headers)
      expect(parseBytesBody(request.responseType, new Uint8Array(0), contentType)).toBeNull()
    })
  })

  test('should get content length', () => {
    const header = new Headers()
    expect(getContentLength(header)).toEqual(0)

    header.set('Content-Length', 'Hello Word!')
    expect(getContentLength(header)).toEqual(0)

    header.set('Content-Length', '3')
    expect(getContentLength(header)).toEqual(3)

    header.set('Content-Length', '-5')
    expect(getContentLength(header)).toEqual(0)

    header.set('Content-Length', '0')
    expect(getContentLength(header)).toEqual(0)

    header.set('Content-Length', 'Infinity')
    expect(getContentLength(header)).toEqual(0)
  })

  test('should get content type', () => {
    const header = new Headers()
    header.set('Content-Type', 'application/json')
    const result = getContentType(header)
    expect(result).toEqual('application/json')
  })

  test('should return empty string when content type is missing', () => {
    const header = new Headers()
    const result = getContentType(header)
    expect(result).toEqual('')
  })

  test('should accept a structured json suffix only when the media type essence is valid', () => {
    expect(isJsonMediaType('application/problem+json')).toBe(true)
    expect(isJsonMediaType('application/problem+json; charset=utf-8')).toBe(true)
    expect(isJsonMediaType('APPLICATION/PROBLEM+JSON; charset="utf-8"')).toBe(true)
    expect(isJsonMediaType('application/json; charset=utf-8')).toBe(true)
    expect(isJsonMediaType('+json')).toBe(false)
    expect(isJsonMediaType('+json; charset=utf-8')).toBe(false)
    expect(isJsonMediaType('application/+json')).toBe(false)
    expect(isJsonMediaType('application/+json; charset=utf-8')).toBe(false)
    expect(isJsonMediaType('application/problem+xml')).toBe(false)
    expect(isJsonMediaType('text/json')).toBe(false)
    expect(isJsonMediaType('application/problem+json/extra')).toBe(false)
    expect(isJsonMediaType('app lication/json')).toBe(false)
    expect(isJsonMediaType('application/prob lem+json')).toBe(false)
  })

  test('should keep JSON essence matching separate from strict parameter validation', () => {
    const cases = [
      ['application/json; bare', true, false],
      ['APPLICATION/JSON; charset="utf-8"', true, true],
      [' application/json', true, false],
      ['application/json\n', true, false],
      ['application/json; charset=utf-8\n', true, false],
      ['application/json; x=bad/value', true, false],
      ['text/event-stream; note="a\\;b"', false, true],
    ] as const

    for (const [contentType, json, parametersWellFormed] of cases) {
      const parsed = parseMediaType(contentType)
      expect(isJsonMediaType(contentType)).toBe(json)
      expect(parsed.parametersWellFormed).toBe(parametersWellFormed)
    }
  })

  test('should expose the shared media type prefix tokenizer for malformed prefixes', () => {
    expect(parseMediaTypePrefix('')).toEqual({ position: 0 })
    expect(parseMediaTypePrefix('application')).toEqual({ position: 11 })
    expect(parseMediaTypePrefix('application/')).toEqual({ position: 12 })
    expect(parseMediaTypePrefix('application/json \t;')).toEqual({ essence: 'application/json', position: 16 })
    expect(parseMediaTypePrefix('application/json extra')).toEqual({ position: 16 })
  })
})
