import { describe, expect, test } from 'bun:test'
import { HttpContext } from './context'
import { field } from './field'
import {
	type HttpRequest,
	defineRequest,
	detectContentTypeHeader,
	fillRequestFromField,
	fillUrl,
	getRequestRefOptions,
	isRequestRef,
	serializeBody,
} from './request'

describe('detect Content-Type', () => {
	test('should FormData is multipart/form-data', () => {
		expect(detectContentTypeHeader(new FormData())).toBe('multipart/form-data')
	})

	test('should ArrayBuffer is application/octet-stream', () => {
		expect(detectContentTypeHeader(new ArrayBuffer(0))).toBe('application/octet-stream')
	})

	test('should URLSearchParams is application/x-www-form-urlencoded', () => {
		expect(detectContentTypeHeader(new URLSearchParams())).toBe('application/x-www-form-urlencoded;charset=UTF-8')
	})

	test('should String is text/plain', () => {
		expect(detectContentTypeHeader('Hello World!')).toBe('text/plain')
	})

	test('should Object is application/json', () => {
		expect(detectContentTypeHeader({ banner: 'Hello World!' })).toBe('application/json')
	})

	test('should Number is application/json', () => {
		expect(detectContentTypeHeader(0)).toBe('application/json')
		expect(detectContentTypeHeader(1)).toBe('application/json')
	})

	test('should Boolean is application/json', () => {
		expect(detectContentTypeHeader(true)).toBe('application/json')
		expect(detectContentTypeHeader(false)).toBe('application/json')
	})

	test('should Null is Null', () => {
		expect(detectContentTypeHeader(null)).toBeNull()
	})

	test('should Undefined is Null', () => {
		expect(detectContentTypeHeader(undefined)).toBeNull()
	})
})

describe('serialize body', () => {
	test('should FormData is FormData', () => {
		expect(serializeBody(new FormData())).toBeInstanceOf(FormData)
	})

	test('should Blob is Blob', () => {
		expect(serializeBody(new Blob())).toBeInstanceOf(Blob)
	})

	test('should ArrayBuffer is ArrayBuffer', () => {
		expect(serializeBody(new ArrayBuffer(0))).toBeInstanceOf(ArrayBuffer)
	})

	test('should Object is string', () => {
		expect(serializeBody({})).toBeTypeOf('string')
	})

	test('should Boolean is string', () => {
		expect(serializeBody(true)).toBeTypeOf('string')
		expect(serializeBody(false)).toBeTypeOf('string')
	})

	test('should Number is string', () => {
		expect(serializeBody(0)).toBeTypeOf('string')
		expect(serializeBody(1)).toBeTypeOf('string')
	})
})

describe('define request', () => {
	test('should return a function', () => {
		expect(defineRequest({ method: '', endpoint: '' })).toBeTypeOf('function')
	})

	test('should isRequestRef return true', () => {
		const options = { method: '', endpoint: '' }
		const req = defineRequest(options)
		const ref = req()
		expect(isRequestRef(ref)).toBeTrue()
	})

	test('should isRequestRef return false', () => {
		expect(isRequestRef({})).toBeFalse()
	})

	test('should getRequestRefOptions return options', () => {
		const options = { method: '', endpoint: '' }
		const req = defineRequest(options)
		const ref = req()
		expect(getRequestRefOptions(ref)).toEqual(options)
	})

	test('should fillUrl return url', () => {
		const map = new Map<string, string>()
		map.set('id', '1')
		map.set('name', 'John')
		const endpoint = 'https://example.com/:id/:name'
		expect(fillUrl(endpoint, map)).toEqual('https://example.com/1/John')
	})

	describe('should fillRequestFromField', () => {
		const baseHttpRequest = () =>
			({
				method: 'GET',
				host: 'https://example.com',
				endpoint: '/v1/:uid/:username',
				headers: new Headers(),
				body: null,
				abort: new AbortController().signal,
				context: new HttpContext(),
				observe: 'body',
				queryParams: new URLSearchParams(),
				responseType: 'json',
				timeout: 0,
			}) as HttpRequest

		test('should fill fieldGroup is working', async () => {
			const hq = baseHttpRequest()
			const fields = {
				id: field(1).withParam('uid').withJson(),
				name: field('John').withParam('username'),
				content: field('Hello World!').withJson(),
			}

			await fillRequestFromField(hq, fields, {
				id: 10,
				name: 'Alice',
				content: 'Hello Alice!',
			})

			expect(hq.endpoint).toEqual('/v1/1/John')
		})

		test('should fill field is working', async () => {
			const hq = baseHttpRequest()
			await fillRequestFromField(hq, field(1).withParam('uid').withBody(), 10)

			expect(hq.endpoint).toEqual('/v1/10/:username')
		})
	})
})
