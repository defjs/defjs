// import { HttpContextToken } from "../../context.ts";
// import {
// 	type HttpRequest,
// 	detectContentTypeHeader,
// 	serializeBody,
// } from "../../request";
// import {
// 	type HttpResponseBody,
// 	HttpResponseError,
// } from "../../response";
// import type { HttpHandler } from "../handler";

// export interface FetchConfig {
// 	/** A string indicating how the request will interact with the browser's cache to set request's cache. */
// 	cache?: RequestCache;
// 	/** A string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL. Sets request's credentials. */
// 	credentials?: RequestCredentials;
// 	/** A boolean to set request's keepalive. */
// 	keepalive?: boolean;
// 	/** A string to indicate whether the request will use CORS, or will be restricted to same-origin URLs. Sets request's mode. */
// 	mode?: RequestMode;
// 	priority?: RequestPriority;
// 	/** A string indicating whether request follows redirects, results in an error upon encountering a redirect, or returns the redirect (in an opaque fashion). Sets request's redirect. */
// 	redirect?: RequestRedirect;
// 	/** A string whose value is a same-origin URL, "about:client", or the empty string, to set request's referrer. */
// 	referrer?: string;
// 	/** A referrer policy to set request's referrerPolicy. */
// 	referrerPolicy?: ReferrerPolicy;
// }

// export const FETCH_CONFIG_KEY = new HttpContextToken<FetchConfig>(() => ({}));

// export function createRequest(
// 	abort: AbortController,
// 	request: HttpRequest,
// ): Request {
// 	if (!request.endpoint) {
// 		throw new Error("Request endpoint is empty");
// 	}

// 	if (!request.method) {
// 		throw new Error("Request method is empty");
// 	}

// 	if (!request.path) {
// 		throw new Error("Request path is empty");
// 	}

// 	const url = new URL(request.path, request.endpoint);

// 	if (request.queryParams) {
// 		if (request.queryParams instanceof URLSearchParams) {
// 			url.search = request.queryParams.toString();
// 		} else {
// 			url.search = new URLSearchParams(request.queryParams).toString();
// 		}
// 	}

// 	const detectedType = detectContentTypeHeader(request.body);
// 	const headers = request.headers || new Headers();

// 	if (!headers.has("Content-Type") && detectedType) {
// 		headers.set("Content-Type", detectedType);
// 	}

// 	if (!headers.has("Accept")) {
// 		headers.set("Accept", "application/json, text/plain, */*");
// 	}

// 	const fetchConfig = request.context?.get(FETCH_CONFIG_KEY);

// 	return new Request(url, {
// 		...fetchConfig,
// 		headers,
// 		method: request.method,
// 		body: serializeBody(request),
// 		signal: abort.signal,
// 	});
// }

// export function concatChunks(
// 	chunks: Uint8Array[],
// 	totalLength: number,
// ): Uint8Array {
// 	const chunksAll = new Uint8Array(totalLength);
// 	let position = 0;
// 	for (const chunk of chunks) {
// 		chunksAll.set(chunk, position);
// 		position += chunk.length;
// 	}

// 	return chunksAll;
// }

// export function parseBody(
// 	request: HttpRequest,
// 	response: Response,
// 	content: Uint8Array,
// ): string | ArrayBuffer | Blob | object | null {
// 	const responseType = request.responseType;
// 	if (!responseType) {
// 		return null;
// 	}

// 	switch (responseType) {
// 		case "json": {
// 			const text = new TextDecoder().decode(content);
// 			if (text === "") {
// 				return null;
// 			}
// 			return JSON.parse(text) as object;
// 		}
// 		case "text":
// 			return new TextDecoder().decode(content);
// 		case "blob": {
// 			const contentType = response.headers.get("Content-Type") || undefined;
// 			return new Blob([content], { type: contentType });
// 		}
// 		case "arraybuffer":
// 			return content.buffer;
// 		default:
// 			return null;
// 	}
// }

// export function getContentLength(headers: Headers): number {
// 	const value = headers.get("Content-Length");
// 	if (!value) {
// 		return 0;
// 	}

// 	const num = Number(value);
// 	if (isNaN(num)) {
// 		return 0;
// 	}

// 	return num;
// }

// export async function _requestStream(
// 	abort: AbortController,
// 	httpRequest: HttpRequest,
// ): Promise<unknown> {
// 	const request = createRequest(abort, httpRequest);
// 	let response: Response;

// 	try {
// 		response = await fetch(request);
// 	} catch (error) {
// 		throw new HttpResponseError({
// 			error: error,
// 		});
// 	}

// 	const { headers, status, statusText, url, ok } = response;
// 	let body: HttpResponseBody = null;

// 	if (!response.body) {
// 		throw new HttpResponseError({
// 			status,
// 			statusText,
// 			headers,
// 			url,
// 			body,
// 		});
// 	}
// 	const reader = response.body.getReader();

// 	while (true) {
// 		const { done, value } = await reader.read();

// 		if (done) {
// 			break;
// 		}

// 		try {
// 			body = parseBody(httpRequest, response, value);
// 		} catch (error) {
// 			throw new HttpResponseError({
// 				error,
// 				status,
// 				statusText,
// 				headers,
// 				url,
// 			});
// 		}
// 	}
// }

// /**
//  * 应该实现一个 doRequestStream 的函数，用于流请求，包括WebSocket
//  * */
// export const fetchStreamHandler: HttpHandler = (req: HttpRequest) => {
// 	const abort = new AbortController();

// 	return _requestStream(abort, req);
// };
