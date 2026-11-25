import type { FetchHandle } from "../../client/config";
import type { PortClientOptions } from "../types";
import type { PortMux } from "./mux";
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CREDIT_WINDOW,
  MAX_CHUNK_SIZE,
  NULL_BODY_STATUSES,
  decodeWirePayload,
  encodeWirePayload,
  reconstructError,
  resolveWireMode,
  sliceChunks,
  toHeaders,
  validatePositiveInt,
} from "./protocol";

export function normalizeClientOptions(options?: PortClientOptions): {
  readonly mode: PortClientOptions["mode"];
  readonly chunkSize: number;
  readonly creditWindow: number;
} {
  return {
    mode: options?.mode,
    chunkSize: validatePositiveInt(
      "chunkSize",
      options?.chunkSize ?? DEFAULT_CHUNK_SIZE,
      MAX_CHUNK_SIZE,
    ),
    creditWindow: validatePositiveInt(
      "creditWindow",
      options?.creditWindow ?? DEFAULT_CREDIT_WINDOW,
    ),
  };
}

export function createPortFetch(
  mux: PortMux,
  options?: PortClientOptions,
): FetchHandle {
  const {
    mode: optionMode,
    chunkSize,
    creditWindow,
  } = normalizeClientOptions(options);
  const mode = resolveWireMode(optionMode, mux.defaultMode);

  return async (input, init) => {
    const request =
      input instanceof Request && init === undefined
        ? input
        : new Request(input, init);
    const { signal } = request;
    if (signal.aborted) {
      throw signal.reason;
    }

    // Read body upfront only when Request.prototype.body is absent (Firefox).
    let fallbackBytes: Uint8Array | undefined;
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.body === undefined
    ) {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (signal.aborted) {
        throw signal.reason;
      }
      if (bytes.byteLength > 0) {
        fallbackBytes = bytes;
      }
    }

    const headResolvers = Promise.withResolvers<Response>();
    let settled = false;
    let streamController:
      ReadableStreamDefaultController<Uint8Array> | undefined;
    let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let unreplenished = 0;

    const cleanup = (notifyHost: boolean): void => {
      settled = true;
      signal.removeEventListener("abort", onAbort);
      mux.deleteChannel(channelId);
      if (bodyReader !== undefined) {
        void bodyReader.cancel(signal.reason).catch(() => undefined);
      }
      if (notifyHost) {
        mux.trySend({ v: 1, id: channelId, kind: "http.abort" });
      }
    };

    const failStreamOrHead = (error: unknown, notifyHost: boolean): void => {
      if (settled) {
        return;
      }
      const controller = streamController;
      cleanup(notifyHost);
      if (controller !== undefined) {
        controller.error(error);
      } else {
        headResolvers.reject(error);
      }
    };

    const onAbort = (): void => {
      failStreamOrHead(signal.reason, true);
    };

    let channelId = 0;
    try {
      channelId = mux.openChannel({
        onDisconnect(reason) {
          failStreamOrHead(new Error(reason), false);
        },
        onFrame(frame) {
          switch (frame.kind) {
            case "http.head": {
              let headers: Headers;
              try {
                headers = toHeaders(frame.headers);
              } catch (error) {
                failStreamOrHead(error, true);
                return;
              }
              const noBody =
                !frame.hasBody ||
                NULL_BODY_STATUSES.has(frame.status) ||
                request.method.toUpperCase() === "HEAD";
              if (noBody) {
                cleanup(false);
                const response = new Response(null, {
                  status: frame.status,
                  statusText: frame.statusText,
                  headers,
                });
                Object.defineProperty(response, "url", {
                  value: frame.url,
                  configurable: true,
                });
                headResolvers.resolve(response);
                return;
              }

              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  streamController = controller;
                },
                pull() {
                  if (settled || unreplenished <= 0) {
                    return;
                  }
                  const credits = unreplenished;
                  unreplenished = 0;
                  mux.trySend({
                    v: 1,
                    id: channelId,
                    kind: "http.pull",
                    credits,
                  });
                },
                cancel() {
                  cleanup(true);
                },
              });
              const response = new Response(stream, {
                status: frame.status,
                statusText: frame.statusText,
                headers,
              });
              Object.defineProperty(response, "url", {
                value: frame.url,
                configurable: true,
              });
              headResolvers.resolve(response);
              return;
            }
            case "http.chunk": {
              const controller = streamController;
              if (controller === undefined) {
                return;
              }
              const bytes = decodeWirePayload(frame.chunk);
              if (bytes === undefined) {
                failStreamOrHead(
                  new Error("Invalid HTTP chunk payload received from port"),
                  true,
                );
                return;
              }
              unreplenished += 1;
              controller.enqueue(bytes);
              return;
            }
            case "http.end": {
              const controller = streamController;
              cleanup(false);
              controller?.close();
              return;
            }
            case "http.error": {
              failStreamOrHead(
                reconstructError(frame.message, frame.name),
                false,
              );
              return;
            }
            default:
              return;
          }
        },
      });
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      failStreamOrHead(signal.reason, false);
      return headResolvers.promise;
    }

    const sendBodyBytes = (bytes: Uint8Array): void => {
      for (const piece of sliceChunks(bytes, chunkSize)) {
        const encoded = encodeWirePayload(piece, mode);
        mux.send(
          {
            v: 1,
            id: channelId,
            kind: "http.body",
            chunk: encoded.payload,
            done: false,
          },
          encoded.transfer,
        );
      }
    };

    const sendBodyDone = (): void => {
      mux.send({
        v: 1,
        id: channelId,
        kind: "http.body",
        done: true,
      });
    };

    const requestBody = request.body;
    const hasBody = Boolean(requestBody) || fallbackBytes !== undefined;
    try {
      mux.send({
        v: 1,
        id: channelId,
        kind: "http.open",
        url: request.url,
        method: request.method,
        headers: [...request.headers.entries()],
        credentials: request.credentials,
        hasBody,
        credits: creditWindow,
      });
    } catch (error) {
      cleanup(false);
      throw error;
    }

    if (requestBody) {
      void pumpRequestBody(
        requestBody,
        (reader) => {
          bodyReader = reader;
        },
        () => settled,
        sendBodyBytes,
        sendBodyDone,
        (error) => {
          failStreamOrHead(error, true);
        },
      );
    } else if (fallbackBytes !== undefined) {
      try {
        sendBodyBytes(fallbackBytes);
        sendBodyDone();
      } catch (error) {
        cleanup(true);
        throw error;
      }
    }

    return headResolvers.promise;
  };
}

async function pumpRequestBody(
  body: ReadableStream<Uint8Array>,
  setReader: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
  isSettled: () => boolean,
  sendChunk: (bytes: Uint8Array) => void,
  sendDone: () => void,
  onError: (error: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  setReader(reader);
  try {
    while (!isSettled()) {
      const { done, value } = await reader.read();
      if (isSettled()) {
        return;
      }
      if (done) {
        sendDone();
        return;
      }
      if (value.byteLength > 0) {
        sendChunk(value);
      }
    }
  } catch (error) {
    onError(error);
  } finally {
    reader.releaseLock();
  }
}
