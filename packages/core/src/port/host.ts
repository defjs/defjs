import type { FetchHandle, WebSocketHandle } from "../client/config";
import { normalizePort } from "./internal/endpoint";
import { createRequestPolicy } from "./internal/policy";
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  MAX_CHUNK_SIZE,
  NULL_BODY_STATUSES,
  concatChunks,
  decodeWirePayload,
  encodeWirePayload,
  parseFrame,
  resolveWireMode,
  sliceChunks,
  toHeaders,
  validatePositiveInt,
} from "./internal/protocol";
import type { PortFrame } from "./internal/protocol";
import type { PortHostHandle, PortHostOptions, PortLike } from "./types";

interface HostHttpChannel {
  aborted: boolean;
  bodyDone: boolean;
  credits: number;
  readonly controller: AbortController;
  readonly bodyChunks: Uint8Array[];
  bodyBytes: number;
  readonly bodyPromise?: Promise<Uint8Array<ArrayBuffer>>;
  resolveBody?: (bytes: Uint8Array<ArrayBuffer>) => void;
  rejectBody?: (error: Error) => void;
  notifyCredits?: () => void;
}

interface HostWsChannel {
  closed: boolean;
  socket?: WebSocketHandle;
  outgoingChunks: Uint8Array[];
  incomingChain: Promise<void>;
}

function sendErrorFrame(
  send: (frame: PortFrame, transfer?: Transferable[]) => void,
  id: number,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : undefined;
  send({ v: 1, id, kind: "http.error", message, name });
}

function waitForCredits(channel: HostHttpChannel): Promise<void> {
  return new Promise<void>((resolve) => {
    channel.notifyCredits = resolve;
  });
}

function wakeCredits(channel: HostHttpChannel): void {
  const notify = channel.notifyCredits;
  if (notify !== undefined) {
    channel.notifyCredits = undefined;
    notify();
  }
}

function ignoreError(): void {}

/**
 * Attaches the network-capable host side of a multiplexed `@defjs/core/port` channel.
 *
 * Evaluates target scheme, embedded credential, `allowedOrigins`, and `allowRequest` policies before executing HTTP, SSE, or WebSocket operations.
 * Hosts fail closed and throw a `RangeError` unless `allowedOrigins`, `allowRequest`, or `allowAnyOrigin: true` is supplied.
 *
 * @param port - Native `MessagePort` or custom `PortEndpoint`.
 * @param options - Origin allowlist, per-request policy callback, transport overrides, and framing limits.
 * @returns A handle whose `close()` or `[Symbol.dispose]()` tears down active channels and detaches port listeners.
 * @group port
 */
export function attachPortHost(
  port: PortLike,
  options: PortHostOptions,
): PortHostHandle {
  const chunkSize = validatePositiveInt(
    "chunkSize",
    options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    MAX_CHUNK_SIZE,
  );
  const maxRequestBodyBytes = validatePositiveInt(
    "maxRequestBodyBytes",
    options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES,
  );
  const policy = createRequestPolicy(options);
  const endpoint = normalizePort(port);
  const mode = resolveWireMode(options.mode, endpoint.mode);
  const customFetch = options.fetch;
  const customWebSocket = options.WebSocket;

  const httpChannels = new Map<number, HostHttpChannel>();
  const wsChannels = new Map<number, HostWsChannel>();
  let hostClosed = false;

  const trySend = (frame: PortFrame, transfer?: Transferable[]): void => {
    try {
      endpoint.postMessage(frame, transfer);
    } catch {
      // Peer port may already be disconnected; active channels still finish cleanup.
    }
  };

  const cleanupHttp = (id: number): void => {
    const channel = httpChannels.get(id);
    if (channel === undefined || channel.aborted) {
      return;
    }
    channel.aborted = true;
    httpChannels.delete(id);
    channel.controller.abort();
    wakeCredits(channel);
    channel.rejectBody?.(new Error("HTTP channel aborted"));
  };

  const tearDownChannels = (): void => {
    for (const id of [...httpChannels.keys()]) {
      cleanupHttp(id);
    }
    for (const [id, channel] of [...wsChannels.entries()]) {
      channel.closed = true;
      wsChannels.delete(id);
      try {
        channel.socket?.close(1000, "Host closed");
      } catch {
        // Socket might already be closing/closed or reject non-open close.
      }
    }
  };

  const handleHttpOpen = async (
    frame: Extract<PortFrame, { kind: "http.open" }>,
  ): Promise<void> => {
    if (httpChannels.has(frame.id)) {
      return;
    }
    const controller = new AbortController();
    let resolveBody: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined;
    let rejectBody: ((error: Error) => void) | undefined;
    let bodyPromise: Promise<Uint8Array<ArrayBuffer>> | undefined;
    if (frame.hasBody) {
      const deferred = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
      // Pre-attach rejection observer so early abort during async policy.check cannot trigger unhandledRejection.
      void deferred.promise.catch(ignoreError);
      bodyPromise = deferred.promise;
      resolveBody = deferred.resolve;
      rejectBody = deferred.reject;
    }
    const channel: HostHttpChannel = {
      aborted: false,
      bodyDone: false,
      credits: frame.credits,
      controller,
      bodyChunks: [],
      bodyBytes: 0,
      bodyPromise,
      resolveBody,
      rejectBody,
    };
    httpChannels.set(frame.id, channel);

    let requestHeaders: Headers;
    try {
      requestHeaders = toHeaders(frame.headers);
    } catch (error) {
      cleanupHttp(frame.id);
      sendErrorFrame(trySend, frame.id, error);
      return;
    }
    const decision = await policy.check(
      "http",
      frame.url,
      frame.method,
      requestHeaders,
    );
    if (channel.aborted) {
      return;
    }
    if (!decision.ok) {
      cleanupHttp(frame.id);
      sendErrorFrame(trySend, frame.id, new Error(decision.reason));
      return;
    }

    const fetchImpl: FetchHandle | undefined = customFetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      cleanupHttp(frame.id);
      sendErrorFrame(
        trySend,
        frame.id,
        new Error("fetch is not supported in current runtime"),
      );
      return;
    }

    let requestBody: Uint8Array<ArrayBuffer> | undefined;
    if (channel.bodyPromise !== undefined) {
      try {
        requestBody = await channel.bodyPromise;
      } catch (error) {
        if (!channel.aborted) {
          cleanupHttp(frame.id);
          sendErrorFrame(trySend, frame.id, error);
        }
        return;
      }
    }
    if (channel.aborted) {
      return;
    }

    let response: Response;
    try {
      const init: RequestInit = {
        method: frame.method,
        headers: requestHeaders,
        signal: controller.signal,
      };
      if (frame.credentials !== undefined) {
        init.credentials = frame.credentials;
      }
      if (requestBody !== undefined) {
        init.body = requestBody;
      }
      response = await fetchImpl(decision.url, init);
    } catch (error) {
      if (!channel.aborted) {
        cleanupHttp(frame.id);
        sendErrorFrame(trySend, frame.id, error);
      }
      return;
    }

    if (channel.aborted) {
      void response.body?.cancel().catch(ignoreError);
      return;
    }

    const responseBody = response.body;
    const sendHead = (hasBody: boolean): void => {
      trySend({
        v: 1,
        id: frame.id,
        kind: "http.head",
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        url: response.url || decision.url.href,
        hasBody,
      });
    };

    if (
      !responseBody ||
      NULL_BODY_STATUSES.has(response.status) ||
      frame.method.toUpperCase() === "HEAD"
    ) {
      sendHead(false);
      void responseBody?.cancel().catch(ignoreError);
      httpChannels.delete(frame.id);
      channel.aborted = true;
      return;
    }

    sendHead(true);

    const reader = responseBody.getReader();
    try {
      while (!channel.aborted) {
        const { done, value } = await reader.read();
        if (channel.aborted) {
          break;
        }
        if (done) {
          trySend({ v: 1, id: frame.id, kind: "http.end" });
          break;
        }
        for (const piece of sliceChunks(value, chunkSize)) {
          while (channel.credits <= 0 && !channel.aborted) {
            await waitForCredits(channel);
          }
          if (channel.aborted) {
            break;
          }
          channel.credits -= 1;
          const encoded = encodeWirePayload(piece, mode);
          trySend(
            {
              v: 1,
              id: frame.id,
              kind: "http.chunk",
              chunk: encoded.payload,
            },
            encoded.transfer,
          );
        }
      }
    } catch (error) {
      if (!channel.aborted) {
        sendErrorFrame(trySend, frame.id, error);
      }
    } finally {
      if (channel.aborted) {
        void reader.cancel().catch(ignoreError);
      }
      reader.releaseLock();
      httpChannels.delete(frame.id);
      channel.aborted = true;
    }
  };

  const handleHttpBody = (
    frame: Extract<PortFrame, { kind: "http.body" }>,
  ): void => {
    const channel = httpChannels.get(frame.id);
    if (channel === undefined || channel.aborted || channel.bodyDone) {
      return;
    }
    if (frame.chunk !== undefined) {
      const bytes = decodeWirePayload(frame.chunk);
      if (bytes === undefined) {
        channel.bodyDone = true;
        channel.rejectBody?.(new Error("Invalid HTTP request body chunk"));
        return;
      }
      channel.bodyBytes += bytes.byteLength;
      if (channel.bodyBytes > maxRequestBodyBytes) {
        channel.bodyDone = true;
        channel.rejectBody?.(
          new Error(
            `Request body exceeded maxRequestBodyBytes (${maxRequestBodyBytes})`,
          ),
        );
        return;
      }
      channel.bodyChunks.push(bytes);
    }
    if (frame.done) {
      channel.bodyDone = true;
      channel.resolveBody?.(concatChunks(channel.bodyChunks));
      channel.bodyChunks.length = 0;
    }
  };

  const handleWsOpen = async (
    frame: Extract<PortFrame, { kind: "ws.open" }>,
  ): Promise<void> => {
    if (wsChannels.has(frame.id)) {
      return;
    }
    const channel: HostWsChannel = {
      closed: false,
      outgoingChunks: [],
      incomingChain: Promise.resolve(),
    };
    wsChannels.set(frame.id, channel);

    const decision = await policy.check(
      "websocket",
      frame.url,
      "GET",
      new Headers(),
    );
    if (channel.closed) {
      return;
    }
    if (!decision.ok) {
      wsChannels.delete(frame.id);
      channel.closed = true;
      trySend({ v: 1, id: frame.id, kind: "ws.error" });
      trySend({
        v: 1,
        id: frame.id,
        kind: "ws.closed",
        code: 1006,
        reason: decision.reason,
        wasClean: false,
      });
      return;
    }

    const SocketImpl = customWebSocket ?? globalThis.WebSocket;
    if (typeof SocketImpl !== "function") {
      wsChannels.delete(frame.id);
      channel.closed = true;
      trySend({ v: 1, id: frame.id, kind: "ws.error" });
      trySend({
        v: 1,
        id: frame.id,
        kind: "ws.closed",
        code: 1006,
        reason: "WebSocket is not supported in current runtime",
        wasClean: false,
      });
      return;
    }

    let socket: WebSocketHandle;
    try {
      socket =
        frame.protocols.length > 0
          ? new SocketImpl(decision.url, [...frame.protocols])
          : new SocketImpl(decision.url);
    } catch (error) {
      wsChannels.delete(frame.id);
      channel.closed = true;
      const reason = error instanceof Error ? error.message : String(error);
      trySend({ v: 1, id: frame.id, kind: "ws.error" });
      trySend({
        v: 1,
        id: frame.id,
        kind: "ws.closed",
        code: 1006,
        reason,
        wasClean: false,
      });
      return;
    }

    channel.socket = socket;

    const sendBinaryChunks = (bytes: Uint8Array): void => {
      const pieces = [...sliceChunks(bytes, chunkSize)];
      const lastIndex = pieces.length - 1;
      for (const [index, piece] of pieces.entries()) {
        const encoded = encodeWirePayload(piece, mode);
        trySend(
          {
            v: 1,
            id: frame.id,
            kind: "ws.message",
            dataType: "binary",
            data: encoded.payload,
            done: index === lastIndex,
          },
          encoded.transfer,
        );
      }
    };

    const onOpen = (): void => {
      if (channel.closed) {
        return;
      }
      trySend({
        v: 1,
        id: frame.id,
        kind: "ws.opened",
        protocol: socket.protocol,
        extensions: socket.extensions,
      });
    };

    const onMessage = (event: MessageEvent): void => {
      const payload: unknown = event.data;
      channel.incomingChain = channel.incomingChain
        .then(async () => {
          if (channel.closed) {
            return;
          }
          if (typeof payload === "string") {
            trySend({
              v: 1,
              id: frame.id,
              kind: "ws.message",
              dataType: "text",
              data: payload,
              done: true,
            });
            return;
          }
          if (payload instanceof Blob) {
            const buffer = await payload.arrayBuffer();
            if (!channel.closed) {
              sendBinaryChunks(new Uint8Array(buffer));
            }
            return;
          }
          if (ArrayBuffer.isView(payload)) {
            sendBinaryChunks(
              new Uint8Array(
                payload.buffer,
                payload.byteOffset,
                payload.byteLength,
              ),
            );
            return;
          }
          if (payload instanceof ArrayBuffer) {
            sendBinaryChunks(new Uint8Array(payload));
          }
        })
        .catch(ignoreError);
    };

    const onError = (): void => {
      if (!channel.closed) {
        trySend({ v: 1, id: frame.id, kind: "ws.error" });
      }
    };

    const onClose = (event: CloseEvent): void => {
      void channel.incomingChain.finally(() => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        if (channel.closed) {
          return;
        }
        channel.closed = true;
        wsChannels.delete(frame.id);
        trySend({
          v: 1,
          id: frame.id,
          kind: "ws.closed",
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
      });
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  };

  const handleWsSend = (
    frame: Extract<PortFrame, { kind: "ws.send" }>,
  ): void => {
    const channel = wsChannels.get(frame.id);
    if (
      channel === undefined ||
      channel.closed ||
      channel.socket === undefined
    ) {
      return;
    }
    if (frame.dataType === "text") {
      try {
        channel.socket.send(String(frame.data));
      } catch {
        // Host socket state transitions are reported through its close/error events.
      }
      return;
    }
    const chunk = decodeWirePayload(frame.data);
    if (chunk === undefined) {
      channel.outgoingChunks = [];
      return;
    }
    channel.outgoingChunks.push(chunk);
    if (!frame.done) {
      return;
    }
    const assembled = concatChunks(channel.outgoingChunks);
    channel.outgoingChunks = [];
    try {
      channel.socket.send(assembled);
    } catch {
      // Host socket state transitions are reported through its close/error events.
    }
  };

  const unsubMessage = endpoint.onMessage((raw) => {
    const frame = parseFrame(raw);
    if (frame === undefined) {
      return;
    }
    switch (frame.kind) {
      case "port.close":
        tearDownChannels();
        return;
      case "http.open":
        void handleHttpOpen(frame);
        return;
      case "http.body":
        handleHttpBody(frame);
        return;
      case "http.pull": {
        const channel = httpChannels.get(frame.id);
        if (channel !== undefined && !channel.aborted) {
          channel.credits += frame.credits;
          wakeCredits(channel);
        }
        return;
      }
      case "http.abort":
        cleanupHttp(frame.id);
        return;
      case "ws.open":
        void handleWsOpen(frame);
        return;
      case "ws.send":
        handleWsSend(frame);
        return;
      case "ws.close": {
        const channel = wsChannels.get(frame.id);
        if (channel === undefined || channel.closed) {
          return;
        }
        if (channel.socket !== undefined) {
          try {
            channel.socket.close(frame.code, frame.reason);
          } catch {
            // Host socket might already be closing or closed.
          }
          return;
        }
        channel.closed = true;
        wsChannels.delete(frame.id);
        trySend({
          v: 1,
          id: frame.id,
          kind: "ws.closed",
          code: frame.code ?? 1000,
          reason: frame.reason ?? "",
          wasClean: false,
        });
        return;
      }
      default:
        return;
    }
  });

  const unsubDisconnect = endpoint.onDisconnect?.(() => {
    tearDownChannels();
  });

  const close = (): void => {
    if (hostClosed) {
      return;
    }
    try {
      endpoint.postMessage({ v: 1, id: 0, kind: "port.close" });
    } catch {
      // Peer port might already be disconnected.
    }
    hostClosed = true;
    tearDownChannels();
    unsubMessage();
    unsubDisconnect?.();
  };

  return {
    close,
    [Symbol.dispose]: close,
  };
}
