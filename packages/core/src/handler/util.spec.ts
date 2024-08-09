import { describe, expect, test } from 'bun:test'
import type { HttpRequest } from '../request'
import { __concatChunks, __getContentLength, __getContentType, __parseBody } from './util'

describe('Handler util', () => {
  test('should concatenate chunks', () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
    const totalLength = 6
    const result = __concatChunks(chunks, totalLength)
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
  })

  describe('test parse body', async () => {
    const request: HttpRequest = {
      endpoint: '/v1/user',
      method: 'GET',
    }

    test('should be null when the response type is not set', async () => {
      expect(__parseBody({ request, contentType: '', content: new Uint8Array([]) })).toBeNull()
    })

    test('should be null when content is set to empty', async () => {
      request.responseType = 'json'
      expect(__parseBody({ request, contentType: '', content: new Uint8Array([]) })).toBeNull()
    })

    test('should be json when content and response type set', async () => {
      request.responseType = 'json'
      const responseBody = { id: 1 }
      const response = Response.json(responseBody)
      const content = await response.arrayBuffer().then(buffer => new Uint8Array(buffer))
      expect(__parseBody({ request, contentType: '', content })).toEqual(responseBody)
    })

    test('should be text when content and response type set', async () => {
      request.responseType = 'text'
      const responseText = 'Hello Word!'
      const response = new Response(responseText)
      const content = await response.arrayBuffer().then(buffer => new Uint8Array(buffer))
      expect(__parseBody({ request, contentType: '', content })).toEqual(responseText)
    })

    test('should be blob when content and response type set', async () => {
      request.responseType = 'blob'
      const responseText = 'Hello Word!'
      const response = new Response(responseText, {
        headers: {
          'Content-Type': 'text/plain',
        },
      })
      const contentType = __getContentType(response.headers)
      const content = await response.arrayBuffer().then(buffer => new Uint8Array(buffer))
      expect(__parseBody({ request, contentType, content })).toBeInstanceOf(Blob)
    })

    test('should be arrayBuffer when content and response type set', async () => {
      request.responseType = 'arraybuffer'
      const responseText = 'Hello Word!'
      const response = new Response(responseText, {
        headers: {
          'Content-Type': 'text/plain',
        },
      })
      const contentType = __getContentType(response.headers)
      const content = await response.arrayBuffer().then(buffer => new Uint8Array(buffer))
      expect(__parseBody({ request, contentType, content })).toBeInstanceOf(ArrayBuffer)
    })
  })

  test('should get content length', () => {
    const header = new Headers()
    expect(__getContentLength(header)).toEqual(0)

    header.set('Content-Length', 'Hello Word!')
    expect(__getContentLength(header)).toEqual(0)

    header.set('Content-Length', '3')
    expect(__getContentLength(header)).toEqual(3)
  })

  test('should get content type', () => {
    const header = new Headers()
    header.set('Content-Type', 'application/json')
    const result = __getContentType(header)
    expect(result).toEqual('application/json')
  })
})
