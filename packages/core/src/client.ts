import type { HttpHandler } from './handler'
import { fetchHandler } from './handler'
import type { InterceptorFn } from './interceptor'

export interface ClientOptions {
	host: string
	interceptors?: InterceptorFn[]
	handler?: HttpHandler
	/** @todo: Add support for query params serializer */
	// queryParamsSerializer?: (req) => string
}

export interface ClientConfig {
	host: string
	handler: HttpHandler
	interceptors?: InterceptorFn[]
}

const CLIENT = Symbol('Client')

export type Client = {} & {
	readonly [CLIENT]: ClientConfig
}

export function isClient(value: any): value is Client {
	return typeof value === 'object' && CLIENT in value
}

export function getClientConfig(client: unknown): ClientConfig | null
export function getClientConfig(client: Client): ClientConfig
export function getClientConfig(client: Client | unknown): ClientConfig | null {
	if (!isClient(client)) {
		return null
	}
	return client[CLIENT]
}

export function createClient(options: ClientOptions): Client {
	const conf: ClientConfig = {
		host: options.host,
		interceptors: options.interceptors ?? [],
		handler: options.handler || fetchHandler,
	}

	return {
		[CLIENT]: conf,
	}
}
