export type HttpResponseBody = string | ArrayBuffer | Blob | object | null

export type HttpResponse<R> =
	| {
			ok: true
			status: number
			statusText: string
			url: string
			headers: Headers
			body: R | null
	  }
	| {
			ok: false
			error: Error
			status: number
			statusText: string
			url: string
			headers: Headers
			body: R | null
	  }

export type MakeResponseOptions<R> = {
	status?: number
	statusText?: string
	url?: string
	headers?: Headers
	body?: R | null
	error?: Error
}

export function makeResponse<R>(options: MakeResponseOptions<R>): HttpResponse<R> {
	const status = options.status ?? 0
	const statusText = options.statusText ?? ''
	const ok = status >= 200 && status < 300
	const url = options.url ?? ''
	const headers = options.headers ?? new Headers()
	const body = options.body ?? null

	if (!ok) {
		const error = options.error || new Error(`Http failure response for ${options.url}: ${status} ${statusText}`)

		return {
			ok: false,
			error,
			status,
			statusText,
			url,
			headers,
			body,
		}
	}

	return {
		ok: true,
		status,
		statusText,
		url,
		headers,
		body,
	}
}

// interface IHttpResponse<R> {
// 	readonly status: number;
// 	readonly statusText: string;
// 	readonly url: string | null;
// 	readonly headers: Headers;
// 	readonly body: R | null;
// }

// export class HttpResponse<R> implements IHttpResponse<R> {
// 	readonly status: number;
// 	readonly statusText: string;
// 	readonly url: string | null;
// 	readonly headers: Headers;
// 	readonly body: R | null;

// 	constructor(init: {
// 		status?: number;
// 		statusText?: string;
// 		url?: string;
// 		headers?: Headers;
// 		body?: R;
// 	}) {
// 		this.status = init.status ?? 0;
// 		this.statusText = init.statusText ?? "";
// 		this.url = init.url ?? null;
// 		this.headers = init.headers ?? new Headers();
// 		this.body = init.body ?? null;
// 	}
// }

// export class HttpStreamResponse<R> implements IHttpResponse<R> {
// 	readonly status: number;
// 	readonly statusText: string;
// 	readonly url: string | null;
// 	readonly headers: Headers;
// 	readonly body: R | null;

// 	constructor(init: {
// 		status?: number;
// 		statusText?: string;
// 		url?: string;
// 		headers?: Headers;
// 		body?: R;
// 	}) {
// 		this.status = init.status ?? 0;
// 		this.statusText = init.statusText ?? "";
// 		this.url = init.url ?? null;
// 		this.headers = init.headers ?? new Headers();
// 		this.body = init.body ?? null;
// 	}
// }

// export class HttpResponseError<R> extends Error implements IHttpResponse<R> {
// 	readonly status: number;
// 	readonly statusText: string;
// 	readonly url: string | null;
// 	readonly headers: Headers;
// 	readonly body: R | null;

// 	constructor(init: {
// 		error?: string | Error | unknown;
// 		status?: number;
// 		statusText?: string;
// 		url?: string;
// 		headers?: Headers;
// 		body?: R;
// 	}) {
// 		let message = `Http failure response for ${init.url || "(unknown url)"}: ${init.status} ${init.statusText}`;

// 		if (init.status && init.status >= 200 && init.status < 300) {
// 			message = `Http failure during parsing for ${init.url || "(unknown url)"}`;
// 		}

// 		super(message, {
// 			cause: init.error,
// 		});

// 		super.name = "HttpErrorResponse";
// 		this.status = init.status ?? 0;
// 		this.statusText = init.statusText || "";
// 		this.headers = init.headers ?? new Headers();
// 		this.url = init.url ?? null;
// 		this.body = init.body ?? null;
// 	}
// }
