import type { FetchHandle } from "../../client/config";
import {
  DEFAULT_FETCH,
  PLATFORM_FETCH_HANDLE,
  resolveGlobalFetch,
} from "../../client/config";
import { isAbortCause, isTimeoutCause } from "../../error/cause";
import { awaitWithSignal, resolveAbortCause } from "../../internal/abort";
import { concatChunks, parseBytesBody } from "../../internal/bytes";
import { fetchWithSignal, NULL_BODY_STATUSES } from "../../internal/fetch";
import type { HttpProgressFn, HttpRequest } from "../../internal/http_request";
import type { HttpMeta, HttpResponse } from "../../internal/http_response";
import { makeResponse } from "../../internal/http_response";
import { resolveRequestUrl } from "../../internal/url";
import { applyRequestContentType } from "./body";
import { BodyFailure, isBodyFailure } from "./body_failure";
import { createFetchInitBase, isReadableStreamBody } from "./fetch_init";
import {
  getContentLength,
  getContentType,
  isJsonMediaType,
  jsonMediaTypeError,
} from "./utils";

/**
 * Relays a caller's stream so its bytes can be counted and its failure seen: a stream `fetch` holds
 * stays locked whether it errored or not.
 */
function wrapUploadStream(
  stream: ReadableStream<Uint8Array>,
  onProgress: HttpProgressFn | undefined,
  total: number,
  signal: AbortSignal | undefined,
  onFailed: (() => void) | undefined,
): ReadableStream<Uint8Array> {
  // `fetch` only sees the relay, so the platform's rejection of a locked or already read stream has to happen here.
  // It is a request construction failure, not a network one.
  try {
    void new Response(stream);
  } catch (error) {
    throw new BodyFailure("REQ_BUILD_FAILED", error, undefined);
  }
  const reader = stream.getReader();
  let cleanedUp = false;
  let loaded = 0;
  const onAbort = () => cleanup(true, signal?.reason);

  function cleanup(cancel: boolean, reason?: unknown): void {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    signal?.removeEventListener("abort", onAbort);
    try {
      if (cancel) {
        void reader.cancel(reason).catch(() => undefined);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const wrapped = new ReadableStream<Uint8Array>(
    {
      cancel(reason) {
        cleanup(true, reason);
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (cleanedUp) {
            return;
          }

          if (done) {
            cleanup(false);
            controller.close();
            return;
          }

          if (onProgress) {
            loaded += value.byteLength;
            const event = { lengthComputable: total > 0, loaded, total };
            await (signal
              ? awaitWithSignal(() => onProgress(event), signal)
              : onProgress(event));
            if (cleanedUp) {
              return;
            }
          }
          controller.enqueue(value);
        } catch (error) {
          onFailed?.();
          cleanup(true, error);
          controller.error(error);
        }
      },
    },
    // Without an observer there is no reason to read ahead of the consumer.
    { highWaterMark: onProgress ? 1 : 0 },
  );

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  }

  return wrapped;
}

function cancelWrappedUploadBody(
  request: HttpRequest,
  onBodyFailed: (() => void) | undefined,
  body: unknown,
  reason: unknown,
): void {
  if (
    (request.uploadProgress || onBodyFailed) &&
    isReadableStreamBody(request.body) &&
    isReadableStreamBody(body)
  ) {
    void body.cancel(reason).catch(() => undefined);
  }
}

function cancelLateResponseBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): void {
  void body.cancel(signal.reason).catch(() => undefined);
}

const FORBIDDEN_METHODS: ReadonlySet<string> = new Set([
  "CONNECT",
  "TRACE",
  "TRACK",
]);

const METHOD_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * The Request constructor throws a TypeError, before any network activity, for a method that is not a token or is forbidden,
 * a GET/HEAD body, and a URL with credentials (Fetch, "new Request"); `fetch()` rejects with that exception as is. Checking
 * here keeps these apart from a network failure. Bun's Request accepts all of them, so the answer does not depend on the runtime.
 */
function assertRequestShape(request: HttpRequest, url: URL): void {
  const method = request.method.toUpperCase();
  let reason: string | undefined;
  if (!METHOD_TOKEN.test(request.method)) {
    reason = `${JSON.stringify(request.method)} is not a valid method`;
  } else if (FORBIDDEN_METHODS.has(method)) {
    reason = `${request.method} is a forbidden method`;
  } else if (
    (method === "GET" || method === "HEAD") &&
    request.body !== undefined
  ) {
    reason = "GET/HEAD requests cannot have a body";
  } else if (url.username !== "" || url.password !== "") {
    reason = "The URL must not include credentials";
  }
  if (reason !== undefined) {
    throw new BodyFailure("REQ_BUILD_FAILED", new TypeError(reason), undefined);
  }
}

/**
 * `bodyContentType` is a public field an interceptor can assign, and the platform rejects an invalid header value
 * (CR, LF, NUL, or a code point above U+00FF) when it is written. That is an invalid request, found before it is sent,
 * like an interceptor that rewrites `endpoint` to an invalid URL.
 */
function applyBodyContentType(request: HttpRequest, headers: Headers): void {
  try {
    applyRequestContentType(request, headers);
  } catch (error) {
    throw new BodyFailure("REQ_BUILD_FAILED", error, undefined);
  }
}

export function createFetchRequestInit(
  request: HttpRequest,
  onBodyFailed?: () => void,
): RequestInit & { duplex?: "half" } {
  const headers = new Headers(request.headers);
  const uploadProgress = request.uploadProgress;
  applyBodyContentType(request, headers);
  if (request.finalizeHeaders) {
    try {
      request.finalizeHeaders(request, headers, resolveRequestUrl(request));
    } catch (error) {
      throw isAbortCause(error) || isTimeoutCause(error)
        ? error
        : new BodyFailure("EXT_HOOK_FAILED", error, undefined);
    }
  }

  return createFetchInitBase(request, {
    defaultAccept: "application/json, text/plain, */*",
    headers,
    signal: request.signal,
    wrapReadableStreamBody:
      uploadProgress || onBodyFailed
        ? (body) =>
            wrapUploadStream(
              body,
              uploadProgress,
              getContentLength(headers),
              request.signal,
              onBodyFailed,
            )
        : undefined,
  });
}

export function createFetchRequest(
  request: HttpRequest,
  onBodyFailed?: () => void,
): Request {
  const url = resolveRequestUrl(request);
  assertRequestShape(request, url);
  const init = createFetchRequestInit(request, onBodyFailed);

  try {
    return new Request(url, init);
  } catch (error) {
    cancelWrappedUploadBody(request, onBodyFailed, init.body, error);
    throw error;
  }
}

/** Release a body we will not read, ignoring a cancellation the provider refuses. */
function discardBody(body: ReadableStream<Uint8Array>): void {
  void body.cancel().catch(() => undefined);
}

/**
 * Reads a whole body in one call. Only for a response that the platform fetch returned for `signal`: the fetch spec binds that
 * body to the signal, so an abort errors the stream and frees the connection, and the race only makes this call settle promptly.
 */
async function readWholeBody(
  response: Response,
  signal: AbortSignal | undefined,
  meta: HttpMeta,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(
      await (signal
        ? awaitWithSignal(() => response.arrayBuffer(), signal)
        : response.arrayBuffer()),
    );
  } catch (error) {
    // Cancellation outranks body classification, and `fetchHandler` turns it into an abort result.
    if (signal?.aborted) {
      throw error;
    }
    throw new BodyFailure("NET_BODY_INCOMPLETE", error, meta);
  }
}

/** @param platform - `response` came straight from the platform fetch called with the request signal. */
async function parseFetchResponse(
  httpRequest: HttpRequest,
  response: Response,
  fallbackUrl: string,
  platform: boolean,
): Promise<HttpResponse<unknown>> {
  const downloadProgress = httpRequest.downloadProgress;
  const { headers, status, statusText } = response;
  const url = response.url || fallbackUrl;
  // 2xx uses responseType; every other status uses errorResponseType.
  // Either one being unset means that side was not declared, so the body is cancelled unread.
  const responseType =
    status >= 200 && status < 300
      ? httpRequest.responseType
      : httpRequest.errorResponseType;

  if (response.body && responseType === undefined) {
    discardBody(response.body);
    return makeResponse({ status, statusText, headers, url });
  }

  // The platform defines these responses as having no body, so they are never read, whether the
  // runtime exposes null or an empty stream. The decoder still checks the declared media type
  // against the absent body. Names are not normalized on `HttpRequest`, and fetch normalizes `head`.
  const noContent =
    httpRequest.method.toUpperCase() === "HEAD" ||
    NULL_BODY_STATUSES.has(status);
  const stream = noContent ? null : response.body;
  if (noContent && response.body) {
    discardBody(response.body);
  }

  const contentEncoding = headers.get("Content-Encoding")?.trim().toLowerCase();
  let contentLength =
    contentEncoding !== undefined && contentEncoding !== "identity"
      ? 0
      : getContentLength(headers);
  const contentType = getContentType(headers);
  const meta: HttpMeta = {
    headers,
    ok: status >= 200 && status < 300,
    status,
    statusText,
    url,
  };
  // No stream, or a response the platform defines as having no body, is an absent body.
  // A parsed JSON null stays null.
  let body: unknown = undefined;

  // Philosophy 3: the declared representation is part of the assertion. Checking it before the
  // body is read turns "I asked for JSON and got HTML" into one precise fault, and skips the
  // read, the parse, and the struct entirely.
  if (stream && responseType === "json" && !isJsonMediaType(contentType)) {
    discardBody(stream);
    throw new BodyFailure(
      "RES_MEDIA_TYPE_INVALID",
      jsonMediaTypeError(contentType),
      meta,
    );
  }

  // Progress needs the chunks, so only an unobserved read takes the bulk path.
  if (stream && platform && !downloadProgress) {
    const bytes = await readWholeBody(response, httpRequest.signal, meta);
    try {
      body = parseBytesBody(responseType, bytes, contentType);
    } catch (error) {
      throw new BodyFailure("RES_DECODE_FAILED", error, meta);
    }
  } else if (stream) {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    const signal = httpRequest.signal;
    // One listener covers every read: cancelling settles a pending read as done, and the loop then
    // reports the abort. Racing each read would add a listener and three promises per chunk.
    const cancelRead = () =>
      void reader.cancel(signal?.reason).catch(() => undefined);
    signal?.addEventListener("abort", cancelRead, { once: true });
    let receivedLength = 0;

    try {
      while (true) {
        signal?.throwIfAborted();
        const result = await reader.read();
        signal?.throwIfAborted();
        if (result.done) {
          break;
        }

        chunks.push(result.value);
        receivedLength += result.value.byteLength;
        if (receivedLength > contentLength) {
          contentLength = 0;
        }

        if (downloadProgress) {
          const event = {
            lengthComputable: contentLength > 0,
            loaded: receivedLength,
            total: contentLength,
          };
          try {
            await (signal
              ? awaitWithSignal(() => downloadProgress(event), signal)
              : downloadProgress(event));
          } catch (error) {
            throw new BodyFailure("EXT_OBSERVER_FAILED", error, meta);
          }
        }
      }
    } catch (error) {
      // The stream is cancelled with the original reason; the tag is ours, not its concern.
      void reader
        .cancel(isBodyFailure(error) ? error.cause : error)
        .catch(() => undefined);
      // Cancellation outranks body classification, and `fetchHandler` turns it into an abort result.
      if (signal?.aborted) {
        throw error;
      }
      throw isBodyFailure(error)
        ? error
        : new BodyFailure("NET_BODY_INCOMPLETE", error, meta);
    } finally {
      signal?.removeEventListener("abort", cancelRead);
      reader.releaseLock();
    }

    try {
      body = parseBytesBody(
        responseType,
        concatChunks(chunks, receivedLength),
        contentType,
      );
    } catch (error) {
      throw new BodyFailure("RES_DECODE_FAILED", error, meta);
    }
  }

  return makeResponse({
    status,
    statusText,
    headers,
    url,
    body,
  });
}

/**
 * Default HTTP transport: perform `httpRequest` with `fetch` and return an `HttpResponse`.
 *
 * The client always uses it; `withHTTPHandle` only supplies the `fetchImpl` it
 * calls. Also usable in tests and custom handlers. `fetchImpl` defaults to the
 * global `fetch` resolved at send time. It rejects, rather than resolving with
 * a synthetic response, when no response reached the client.
 *
 * @param httpRequest - Normalized request (URL, headers, body, signal, progress hooks).
 * @param fetchImpl - Fetch implementation; defaults to global `fetch`. The library default handle is called as
 *   `(url, init)` while the global is untouched, and its body is read in one piece unless download progress is observed. Any other handle receives a
 *   `Request` and its body is read chunk by chunk.
 * @returns Parsed `HttpResponse`. Rejects when no response reached the client, when reading the body
 *   failed, when an upload observer threw (`EXT_OBSERVER_FAILED`), or when `finalizeHeaders` threw (`EXT_HOOK_FAILED`).
 *   A request that is invalid before it is sent rejects with `REQ_BUILD_FAILED`: a method that is not a token or is
 *   forbidden, a GET or HEAD body, a URL with credentials, a `bodyContentType` the platform refuses as a header value,
 *   or, when `uploadProgress` is set, a stream body that is already locked or read. Cancellation still wins.
 *   The `body` of a `HEAD` response, or of a `204`, `205`, or `304` response, is absent whether or not the engine exposes a body stream.
 * @group http
 */
export async function fetchHandler(
  httpRequest: HttpRequest,
  fetchImpl: FetchHandle = resolveGlobalFetch(),
): Promise<HttpResponse<unknown>> {
  return fetchHandlerWithLifecycle(httpRequest, fetchImpl);
}

type FetchLifecycle = {
  /** `streamedBody` is true when `fetch` is handed a caller-supplied `ReadableStream`. */
  start: (streamedBody: boolean) => void;
  response: (response: Response) => void;
  /** The request body stopped for good: its source errored or its observer failed. */
  bodyFailed: () => void;
};

/** Internal raw Fetch boundary used for per-attempt timing. */
export async function fetchHandlerWithLifecycle(
  httpRequest: HttpRequest,
  fetchImpl: FetchHandle,
  lifecycle?: FetchLifecycle,
): Promise<HttpResponse<unknown>> {
  if (fetchImpl === DEFAULT_FETCH) {
    fetchImpl = resolveGlobalFetch();
  }
  const uploadProgress = httpRequest.uploadProgress;
  if (!uploadProgress) {
    return sendFetchRequest(httpRequest, fetchImpl, lifecycle);
  }

  let observerFailure: BodyFailure<"EXT_OBSERVER_FAILED"> | undefined;
  const observed: HttpRequest = {
    ...httpRequest,
    uploadProgress: async (event) => {
      try {
        await uploadProgress(event);
      } catch (error) {
        observerFailure ??= new BodyFailure(
          "EXT_OBSERVER_FAILED",
          error,
          undefined,
        );
        throw error;
      }
    },
  };

  let response: HttpResponse<unknown>;
  try {
    response = await sendFetchRequest(observed, fetchImpl, lifecycle);
  } catch (error) {
    // sendFetchRequest already turned cancellation into the abort cause, and cancellation outranks the observer.
    throw observerFailure !== undefined && !httpRequest.signal?.aborted
      ? observerFailure
      : error;
  }
  // A handle can swallow the errored upload body and still answer, or the observer can fail while the response is read.
  if (observerFailure !== undefined) {
    throw observerFailure;
  }
  return response;
}

async function sendFetchRequest(
  httpRequest: HttpRequest,
  fetchImpl: FetchHandle,
  lifecycle?: FetchLifecycle,
): Promise<HttpResponse<unknown>> {
  const abortSignal = httpRequest.signal;
  const platform = fetchImpl === PLATFORM_FETCH_HANDLE;
  let request: Request | undefined;
  let platformBody: RequestInit["body"];
  let fallbackUrl: string;
  let response: Response;

  try {
    const streamedBody = isReadableStreamBody(httpRequest.body);
    if (platform) {
      // fetch(url, init) builds the Request itself, so building one here would only do that work twice.
      const url = resolveRequestUrl(httpRequest);
      assertRequestShape(httpRequest, url);
      const init = createFetchRequestInit(httpRequest, lifecycle?.bodyFailed);
      platformBody = init.body;
      fallbackUrl = url.href;
      response = await fetchWithSignal(
        () => {
          lifecycle?.start(streamedBody);
          return fetchImpl(url, init);
        },
        abortSignal,
        cancelLateResponseBody,
      );
    } else {
      const built = createFetchRequest(httpRequest, lifecycle?.bodyFailed);
      request = built;
      fallbackUrl = built.url;
      response = await fetchWithSignal(
        () => {
          lifecycle?.start(streamedBody);
          return fetchImpl(built);
        },
        abortSignal,
        cancelLateResponseBody,
      );
    }
  } catch (error) {
    cancelWrappedUploadBody(
      httpRequest,
      lifecycle?.bodyFailed,
      request?.body ?? platformBody,
      error,
    );
    throw (abortSignal && resolveAbortCause(abortSignal)) ?? error;
  }

  lifecycle?.response(response);
  try {
    return await parseFetchResponse(
      httpRequest,
      response,
      fallbackUrl,
      platform,
    );
  } catch (error) {
    throw (abortSignal && resolveAbortCause(abortSignal)) ?? error;
  }
}
