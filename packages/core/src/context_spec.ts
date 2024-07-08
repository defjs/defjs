import { describe, expect, test } from 'bun:test'
import { HttpContext, HttpContextToken } from './context'

describe('Context', () => {
	test('should set and get value', () => {
		const context = new HttpContext()
		const token = new HttpContextToken(() => 'default')
		context.set(token, 'value')
		expect(context.get(token)).toBe('value')
	})

	test('should get default value', () => {
		const context = new HttpContext()
		const token = new HttpContextToken(() => 'default')
		expect(context.get(token)).toBe('default')
	})

	test('should delete value', () => {
		const context = new HttpContext()
		const token = new HttpContextToken(() => 'default')
		context.set(token, 'value')
		context.delete(token)
		expect(context.has(token)).toBeFalse()
	})

	test('should check if value exists', () => {
		const context = new HttpContext()
		const token = new HttpContextToken(() => 'default')
		context.set(token, 'value')
		expect(context.has(token)).toBeTrue()
	})

	test('should return keys', () => {
		const context = new HttpContext()
		const token1 = new HttpContextToken(() => 'default')
		const token2 = new HttpContextToken(() => 'default')
		context.set(token1, 'value')
		context.set(token2, 'value')
		const keys = Array.from(context.keys())
		expect(keys).toEqual([token1, token2])
	})
})
