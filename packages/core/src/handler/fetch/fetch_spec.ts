import { describe, expect, test } from 'bun:test'
import { HttpContext } from '../../context'
import type { HttpRequest } from '../../request'
import { concatChunks, createRequest, getContentLength, parseBody } from './fetch'

describe('Fetch handler', () => {
	test('should create a request', () => {
		const headers = new Headers()
		headers.set('Content-Type', 'application/json')
		const body = { id: 1 }
		const hq: HttpRequest = {
			host: 'https://example.com',
			endpoint: '/v1/user',
			method: 'GET',
			withCredentials: true,
			headers,
			body,
			abort: new AbortController().signal,
			context: new HttpContext(),
			observe: 'body',
			queryParams: new URLSearchParams(),
			responseType: 'json',
			timeout: 0,
		}
		const request = createRequest(hq)

		expect(request.url).toEqual(new URL(hq.endpoint, hq.host).toString())
		expect(request.body).toBeInstanceOf(ReadableStream)
		expect(request.headers.get('Content-Type')).toEqual('application/json')
		expect(request.method).toEqual('GET')
		expect(request.credentials).toEqual('include')
	})

	test('should concatenate chunks', () => {
		const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
		const totalLength = 6
		const result = concatChunks(chunks, totalLength)
		expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
	})

	test('should parse body', async () => {
		const body = { id: 1 }
		const request: HttpRequest = {
			host: 'https://example.com',
			endpoint: '/v1/user',
			method: 'GET',
			withCredentials: true,
			headers: new Headers(),
			body: body,
			abort: new AbortController().signal,
			context: new HttpContext(),
			observe: 'body',
			queryParams: new URLSearchParams(),
			responseType: 'json',
			timeout: 0,
		}
		const response = Response.json(body)
		const content = await response.arrayBuffer().then(buffer => new Uint8Array(buffer))
		const result = parseBody(request, response, content)
		expect(result).toEqual(body)
	})

	test('should get content length', () => {
		const header = new Headers()
		header.set('Content-Length', '3')
		const result = getContentLength(header)
		expect(result).toEqual(3)
	})
})
