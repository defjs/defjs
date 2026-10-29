import type { HttpRequest } from "./http_request";
import { resolveRequestUrl } from "./url";

const HTTP_RESPONSE: unique symbol = Symbol.for("defjs.http.response");

/**
 * Wire-shape HTTP response that transports produce and interceptors accept.
 *
 * `body` is parsed JSON, text, a `Blob`, or an `ArrayBuffer`, according to
 * `responseType`, not a decoded struct value. `body` is `undefined` when no body
 * was present; a JSON `null` stays `null`. For a JSON representation, a string
 * is a JSON string root and is not parsed again; bytes and blobs are raw and
 * are parsed once. `ok` is true for status codes in the 2xx range. A transport
 * failure is a fault, never a response. `DecodedResponse` is what reaches the
 * caller. The symbol key is an internal brand. Build values with `makeResponse`.
 *
 * @group http
 */
export type HttpResponse<R> = {
  readonly [HTTP_RESPONSE]: true;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  /** Absent when no body was present. JSON `null` stays `null`. */
  readonly body: R | null | undefined;
  readonly ok: boolean;
};

/**
 * Response metadata, available whenever a response reached the client.
 *
 * It carries no `body`: a body only exists once a declared struct decoded it.
 *
 * @group http
 */
export type HttpMeta = {
  readonly headers: Headers;
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
};

/**
 * Response metadata plus a body that decoded against a declared struct.
 *
 * Holding this type is the proof that decoding happened; a failed decode is
 * reported as a fault carrying `HttpMeta` alone.
 *
 * @group http
 */
export type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody };

/**
 * Fields accepted by `makeResponse` when building a synthetic `HttpResponse`, for example in interceptors.
 *
 * `status` defaults to `0` and `statusText` to `''`. `url` and `headers` default
 * to values taken from `request`: its resolved URL (base endpoint, path and
 * query) and a copy of its headers. A request without `baseEndpoint` gives its
 * `endpoint` as written. Without a request, `url` is `''` and `headers` is
 * empty. An omitted `body` stays `undefined`; only an explicit `null` is a JSON
 * `null`.
 *
 * @group http
 */
export type MakeResponseOptions<R> = {
  status?: number;
  statusText?: string;
  url?: string;
  headers?: Headers;
  body?: R | null;
  request?: HttpRequest;
};

/**
 * Builds an `HttpResponse` without a network call, for interceptors that short-circuit `next` and for tests.
 *
 * Default status is `0`, so pass a 2xx `status` for a success. `ok` is true for
 * 2xx. The value it returns goes through the same media-type check and the same
 * declared struct as one off the wire; there is no trusted short-circuit. For a
 * JSON body, set a JSON `content-type` header.
 *
 * @param options - Status, headers, body, and an optional request to copy headers/url from; defaults yield status `0`.
 * @returns An `HttpResponse` with `ok` derived from the status code.
 * @group http
 */
export function makeResponse<R>(
  options?: MakeResponseOptions<R>,
): HttpResponse<R> {
  const status = options?.status ?? 0;
  const ok = status >= 200 && status < 300;
  const statusText = options?.statusText ?? "";
  const url = options?.url ?? requestUrl(options?.request);
  const headers = options?.headers ?? new Headers(options?.request?.headers);
  // Omitted and explicit null are different: only a caller-supplied null is a JSON null.
  const body = options?.body;

  return {
    [HTTP_RESPONSE]: true,
    status,
    statusText,
    url,
    headers,
    body,
    ok,
  };
}

/**
 * Whether `value` is an `HttpResponse`: built by `makeResponse` or the transport, or derived from one by spreading.
 * The brand is the runtime half of the type's nominal guard, so a native `Response` or a lookalike object fails.
 */
export function isHttpResponse(value: unknown): value is HttpResponse<unknown> {
  return (
    (value as Partial<HttpResponse<unknown>> | null | undefined)?.[
      HTTP_RESPONSE
    ] === true
  );
}

export function getHttpErrorMessage(response: {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
}): string {
  let message = `Http failure response: ${response.status}`;
  if (response.statusText) {
    message += ` - ${response.statusText}`;
  }
  return message;
}

function requestUrl(request: HttpRequest | undefined): string {
  if (!request) {
    return "";
  }
  if (!request.baseEndpoint) {
    return request.endpoint;
  }
  return resolveRequestUrl(request).href;
}
