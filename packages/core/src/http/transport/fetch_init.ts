import type { HttpRequest } from "../../internal/http_request";
import { isReadableStream } from "../../internal/type_guards";
import { serializeHttpBody } from "./body";

// Shared by HTTP and SSE. `fetchHandler` rejects with it as is; the HTTP and SSE clients report it as `ENV_UNSUPPORTED`.
export const ERR_STREAMING_REQUEST_UNSUPPORTED = new Error(
  "ERR_STREAMING_REQUEST_UNSUPPORTED",
);

export function isReadableStreamBody(
  body: unknown,
): body is ReadableStream<Uint8Array> {
  return isReadableStream(body);
}

let streamingRequestBodySupport: boolean | undefined;

/**
 * Whether a ReadableStream can be a Request body: a non-null body and no Content-Type.
 * A runtime without stream bodies stringifies the stream and adds a text/plain Content-Type (Firefox).
 * The `duplex` getter is not used: Bun streams request bodies without reading it.
 * This does not predict whether the connection takes the stream (Chromium and WebKit stream only over HTTP/2+).
 * A caller-supplied ReadableStream is the only request body that reports upload progress; every other body is sent as built.
 */
export function supportsStreamingRequestBody(): boolean {
  if (streamingRequestBodySupport !== undefined) {
    return streamingRequestBodySupport;
  }

  if (typeof Request !== "function" || typeof ReadableStream === "undefined") {
    streamingRequestBodySupport = false;
    return streamingRequestBodySupport;
  }

  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const init: RequestInit & { duplex?: "half" } = {
      body: stream,
      duplex: "half",
      method: "POST",
    };
    const request = new Request("https://example.com", init);

    streamingRequestBodySupport =
      request.body !== null && !request.headers.has("Content-Type");
    return streamingRequestBodySupport;
  } catch {
    streamingRequestBodySupport = false;
    return streamingRequestBodySupport;
  }
}

export function __resetStreamingRequestBodySupportForTests(): void {
  streamingRequestBodySupport = undefined;
}

export function createFetchInitBase(
  request: HttpRequest,
  options: {
    defaultAccept: string;
    headers: Headers;
    signal?: AbortSignal;
    wrapReadableStreamBody?: (
      body: ReadableStream<Uint8Array>,
    ) => ReadableStream<Uint8Array>;
  },
): RequestInit & { duplex?: "half" } {
  const { headers } = options;
  if (!headers.has("Accept")) {
    headers.set("Accept", options.defaultAccept);
  }

  const credentials: RequestCredentials | undefined = request.withCredentials
    ? "include"
    : undefined;
  let body = serializeHttpBody(request.body);
  const init: RequestInit & { duplex?: "half" } = {
    body,
    credentials,
    headers,
    method: request.method,
    signal: options.signal,
  };

  if (isReadableStreamBody(body)) {
    if (!supportsStreamingRequestBody()) {
      throw ERR_STREAMING_REQUEST_UNSUPPORTED;
    }

    body = options.wrapReadableStreamBody?.(body) ?? body;
    init.body = body;
    init.duplex = "half";
  }

  return init;
}
