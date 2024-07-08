import { describe, expect, test } from 'bun:test'
import { HttpContext } from '../context'
import { makeFakeHandler } from './test_handler'

describe('Test handler', () => {
	test('should create a fake handler', async () => {
		const body = { id: 1 }
		const headers = new Headers()
		headers.set('Content-Type', 'application/json')
		const handler = makeFakeHandler({
			timeout: 1000,
			status: 200,
			statusText: 'OK',
			headers,
			body,
		})

		const response = await handler({
			host: 'https://example.com',
			endpoint: '/v1/user',
			method: 'GET',
			withCredentials: true,
			headers: new Headers(),
			body,
			abort: new AbortController().signal,
			context: new HttpContext(),
			observe: 'body',
			queryParams: new URLSearchParams(),
			responseType: 'json',
			timeout: 0,
		})

		expect(response.url).toEqual('https://example.com/v1/user')
		expect(response.status).toEqual(200)
		expect(response.statusText).toEqual('OK')
		expect(response.headers.get('Content-Type')).toEqual('application/json')
		expect(response.body).toEqual(body)
	})
})
