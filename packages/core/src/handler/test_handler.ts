import type { HttpRequest } from '../request'
import { makeResponse } from '../response'
import type { HttpHandler } from './handler'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function makeFakeHandler(init: {
	timeout?: number
	status?: number
	statusText?: string
	headers?: Headers
	body?: unknown
}): HttpHandler {
	return async (req: HttpRequest) => {
		const url = new URL(req.endpoint, req.host)

		if (init.timeout && init.timeout > 0) {
			await delay(init.timeout)
		}

		return makeResponse({
			url: url.toString(),
			status: init?.status || 0,
			statusText: init?.statusText || '',
			headers: init?.headers || new Headers(),
			body: init?.body || undefined,
		})
	}
}
