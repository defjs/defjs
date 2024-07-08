import { beforeEach, describe, expect, test } from 'bun:test'
import { type Client, type ClientConfig, createClient, getClientConfig, isClient } from './client'
import { fetchHandler } from './handler'

describe('Client', () => {
	const clientConfig: ClientConfig = {
		host: 'https://example.com',
		handler: fetchHandler,
		interceptors: [],
	}
	let baseClient: Client

	beforeEach(() => {
		baseClient = createClient(clientConfig)
	})

	test('should isClient return true for client', () => {
		expect(isClient(baseClient)).toBeTrue()
	})

	test('should isClient return false for non-client', () => {
		expect(isClient({})).toBeFalse()
	})

	test('should getClientConfig return client config', () => {
		const conf = getClientConfig(baseClient)
		expect(conf).toEqual(clientConfig)
	})

	test('should getClientConfig return null for non-client', () => {
		const conf = getClientConfig({})
		expect(conf).toBeNull()
	})
})
