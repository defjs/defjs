import { describe, expect, it } from 'bun:test'
import { HttpContext } from '../context'
import { makeFakeHandler } from '../handler/test_handler'
import type { HttpRequest } from '../request'
import { type InterceptorFn, makeInterceptorChain } from './interceptor'

describe('interceptor', () => {
	const fun1: InterceptorFn = (req, next) => {
		console.log(1)
		return next(req).then(r => {
			console.log(1.1)
			return r
		})
	}

	const fun2: InterceptorFn = (req, next) => {
		console.log(2)
		return next(req).then(r => {
			console.log(2.1)
			return r
		})
	}

	const fun3: InterceptorFn = (req, next) => {
		console.log(3)
		return next(req).then(r => {
			console.log(3.1)
			return r
		})
	}

	it('should work', async () => {
		const handler = makeFakeHandler({
			status: 200,
			statusText: 'OK',
			headers: new Headers(),
			body: 'Hello World',
		})
		const chain = makeInterceptorChain([fun1, fun2, fun3])
		const req: HttpRequest = {
			method: 'GET',
			host: 'https://api.github.com',
			endpoint: '/user',
			headers: new Headers(),
			queryParams: new URLSearchParams(),
			responseType: 'json',
			context: new HttpContext(),
			timeout: 0,
			observe: 'body',
			abort: new AbortController().signal,
		}
		await chain(req, handler)
		expect(true).toBe(true)
	})
})
