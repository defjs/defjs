import { HttpContextToken } from '../../context'
import { type HttpRequest, detectContentTypeHeader, serializeBody } from '../../request'
import { type HttpResponse, type HttpResponseBody, makeResponse } from '../../response'
import type { HttpHandler } from '../handler'

export interface FetchConfig {
	/** A string indicating how the request will interact with the browser's cache to set request's cache. */
	cache?: RequestCache
	/** A string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL. Sets request's credentials. */
	credentials?: RequestCredentials
	/** A boolean to set request's keepalive. */
	keepalive?: boolean
	/** A string to indicate whether the request will use CORS, or will be restricted to same-origin URLs. Sets request's mode. */
	mode?: RequestMode
	priority?: RequestPriority
	/** A string indicating whether request follows redirects, results in an error upon encountering a redirect, or returns the redirect (in an opaque fashion). Sets request's redirect. */
	redirect?: RequestRedirect
	/** A string whose value is a same-origin URL, "about:client", or the empty string, to set request's referrer. */
	referrer?: string
	/** A referrer policy to set request's referrerPolicy. */
	referrerPolicy?: ReferrerPolicy
}

export const FETCH_CONFIG_KEY = new HttpContextToken<FetchConfig>(() => ({}))

export function createRequest(request: HttpRequest): Request {
	const url = new URL(request.endpoint, request.host)
	url.search = request.queryParams.toString()

	if (!request.headers.has('Content-Type')) {
		const detectedType = detectContentTypeHeader(request.body)
		if (detectedType) {
			request.headers.set('Content-Type', detectedType)
		}
	}

	if (!request.headers.has('Accept')) {
		request.headers.set('Accept', 'application/json, text/plain, */*')
	}
	const credentials = request.withCredentials ? 'include' : undefined

	const fetchConfig = request.context.get(FETCH_CONFIG_KEY)

	return new Request(url, {
		...fetchConfig,
		headers: request.headers,
		method: request.method,
		body: serializeBody(request.body),
		signal: request.abort,
		credentials,
	})
}

export function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
	const chunksAll = new Uint8Array(totalLength)
	let position = 0
	for (const chunk of chunks) {
		chunksAll.set(chunk, position)
		position += chunk.length
	}

	return chunksAll
}

export function parseBody(request: HttpRequest, response: Response, content: Uint8Array): string | ArrayBuffer | Blob | object | null {
	const responseType = request.responseType
	if (!responseType) {
		return null
	}

	switch (responseType) {
		case 'json': {
			const text = new TextDecoder().decode(content)
			if (text === '') {
				return null
			}
			return JSON.parse(text) as object
		}
		case 'text':
			return new TextDecoder().decode(content)
		case 'blob': {
			const contentType = response.headers.get('Content-Type') || undefined
			return new Blob([content], { type: contentType })
		}
		case 'arraybuffer':
			return content.buffer
		default:
			return null
	}
}

export function getContentLength(headers: Headers): number {
	const value = headers.get('Content-Length')
	if (!value) {
		return 0
	}

	const num = Number(value)
	if (isNaN(num)) {
		return 0
	}

	return num
}

export async function _request(httpRequest: HttpRequest): Promise<HttpResponse<unknown>> {
	const request = createRequest(httpRequest)
	const downloadProgress = httpRequest.downloadProgress
	let response: Response

	try {
		response = await (globalThis || window).fetch(request)
	} catch (error) {
		throw makeResponse({
			error: error instanceof Error ? error : new Error('Unknown Error'),
			url: request.url,
		})
	}

	const { headers, status, statusText, url } = response
	const contentLength = getContentLength(headers)
	let body: HttpResponseBody = null

	if (response.body) {
		const chunks: Uint8Array[] = []
		const reader = response.body.getReader()
		let receivedLength = 0

		while (true) {
			const { done, value } = await reader.read()

			if (done) {
				break
			}

			chunks.push(value)
			receivedLength += value.length

			downloadProgress?.({
				lengthComputable: contentLength > 0,
				loaded: receivedLength,
				total: contentLength,
			})

			const chunksAll = concatChunks(chunks, receivedLength)

			try {
				body = parseBody(httpRequest, response, chunksAll)
			} catch (error) {
				throw makeResponse({
					error: error instanceof Error ? error : new Error('Unknown Error'),
					url,
					status,
					statusText,
					headers,
				})
			}
		}
	}

	return makeResponse({
		url,
		status,
		statusText,
		headers,
		body,
	})
}

export const fetchHandler: HttpHandler = _request
