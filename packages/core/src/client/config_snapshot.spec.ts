import { describe, expect, test, vi } from "vitest";
import { defineRequest } from "../http";
import { createHttpRequest } from "../http/request";
import type { HttpRequest } from "../internal/http_request";
import { makeResponse } from "../internal/http_response";
import {
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
} from "../interceptor";
import type { SSEInterceptorFn, WebSocketInterceptorFn } from "../interceptor";
import { struct, type AnyStruct } from "../struct";
import { defineEventStream } from "../sse";
import {
  createControllableSocketClass,
  openControllableSocket,
} from "../../test/regression/controllable_socket";
import { defineWebSocket } from "../web_socket";
import { CLIENT, createClient } from "./client";
import {
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
  withSSEHandle,
  withWebSocketHandle,
  withWebSocketHeartbeat,
  withWebSocketProtocols,
} from "./option";

function isEventDictionary(value: unknown): value is { tick?: AnyStruct } {
  return typeof value === "object" && value !== null;
}

const textEncoder = new TextEncoder();

function sseHandle(text: string) {
  return withSSEHandle(() => {
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(textEncoder.encode(text));
            controller.close();
          },
        }),
        {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        },
      ),
    );
  });
}

function recordingSocket() {
  const { Socket, latest } = createControllableSocketClass();
  const instances: NonNullable<ReturnType<typeof latest>>[] = [];
  const protocols: Array<string | string[] | undefined> = [];
  class RecordingSocket extends Socket {
    constructor(url: string, list?: string | string[]) {
      super(url, list);
      instances.push(this);
      protocols.push(list === undefined ? undefined : [...list]);
    }
  }
  const handle: Parameters<typeof withWebSocketHandle>[0] = RecordingSocket;
  return { Socket: handle, instances, latest, protocols };
}

async function openRecordedSocket<T>(
  pending: Promise<T>,
  opened: ReturnType<typeof recordingSocket>,
  before: number,
): Promise<T> {
  await vi.waitFor(() =>
    expect(opened.instances.length).toBeGreaterThan(before),
  );
  opened.instances[opened.instances.length - 1]?.triggerOpen();
  return pending;
}

describe("optional request options", () => {
  test("stores no options object on the factory or on client() and client(undefined)", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const empty = {};

    expect(base[CLIENT].options).toBeUndefined();
    expect(base()[CLIENT].options).toBeUndefined();
    expect(base(undefined)[CLIENT].options).toBeUndefined();
    expect(base(empty)[CLIENT].options).toEqual({
      beforeConnect: undefined,
      heartbeat: undefined,
      onDownloadProgress: undefined,
      onUploadProgress: undefined,
      protocols: undefined,
      retry: undefined,
      signal: undefined,
    });
    expect(base(empty)[CLIENT].options).not.toBe(empty);
    expect(base()[CLIENT].config).toBe(base[CLIENT].config);
  });

  test("runs HTTP, SSE, and WebSocket when request options are absent", async () => {
    const opened = recordingSocket();
    const { Socket } = opened;
    const base = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => Promise.resolve(Response.json({ ok: true }))),
      sseHandle("data: hi\n\n"),
      withWebSocketHandle(Socket),
    );
    const read = defineRequest({
      method: "GET",
      output: struct.object({ ok: struct.boolean() }),
      path: "/health",
    });
    const stream = defineEventStream({
      events: { message: struct.string() },
      path: "/events",
    });
    const socket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/room",
    });
    const clients = [base, base(), base(undefined), base({})];

    for (const client of clients) {
      const [httpError, data] = await read(client);
      expect(httpError).toBeNull();
      expect(data).toEqual({ ok: true });

      const [sseError, events] = await stream(client);
      expect(sseError).toBeNull();
      expect(await Array.fromAsync(events ?? [])).toEqual([
        { data: "hi", event: "message", id: undefined },
      ]);

      const before = opened.instances.length;
      const [wsError, session] = await openRecordedSocket(
        socket(client),
        opened,
        before,
      );
      expect(wsError).toBeNull();
      session?.close(1000, "done");
      opened.latest()?.triggerClose({
        code: 1000,
        reason: "done",
        wasClean: true,
      });
      await session?.closed;
    }
  });
});

describe("request option snapshots", () => {
  test("keeps captured heartbeat, retry, and protocols after the source changes", async () => {
    vi.useFakeTimers();
    const opened = recordingSocket();
    const message = () => ({ type: "ping" as const });
    const isAck = () => false;
    const shouldRetry = () => false;
    const signal = new AbortController().signal;
    const beforeConnect = () => undefined;
    const heartbeat: {
      intervalMs: number;
      isAck: () => boolean;
      message: () => { type: "ping" };
      timeoutMs?: number;
    } = {
      intervalMs: 10,
      isAck,
      message,
      timeoutMs: 30,
    };
    const protocols = ["v1"];
    const retry = { maxRetries: 1, delayMs: 0, shouldRetry };
    const base = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
    );
    const derived = base({
      beforeConnect,
      heartbeat,
      protocols,
      retry,
      signal,
    });
    const stored = derived[CLIENT].options;
    if (!stored?.heartbeat || !stored.retry || !stored.protocols) {
      throw new Error("Expected captured nested options");
    }

    expect(stored.signal).toBe(signal);
    expect(stored.beforeConnect).toBe(beforeConnect);
    expect(stored.heartbeat.message).toBe(message);
    expect(stored.heartbeat.isAck).toBe(isAck);
    expect(stored.retry.shouldRetry).toBe(shouldRetry);
    expect(stored.heartbeat).not.toBe(heartbeat);
    expect(stored.retry).not.toBe(retry);
    expect(stored.protocols).not.toBe(protocols);

    heartbeat.intervalMs = 100_000;
    delete heartbeat.timeoutMs;
    protocols[0] = "changed";
    protocols.push("v2");
    retry.maxRetries = 0;
    retry.shouldRetry = () => true;

    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/room",
    });
    try {
      const [error, session] = await openControllableSocket(
        endpoint(derived),
        opened.latest,
      );
      expect(error).toBeNull();
      if (!session) throw new Error("Expected session");
      const native = opened.latest();
      if (!native) throw new Error("Expected socket");

      expect(opened.protocols).toEqual([["v1"]]);
      await vi.advanceTimersByTimeAsync(10);
      expect(JSON.parse(native.sent[0] ?? "")).toEqual({ type: "ping" });
      await vi.advanceTimersByTimeAsync(30);
      const closed = await session.closed;
      expect(closed.kind).toBe("error");
      if (closed.kind !== "error") throw new Error("expected an error close");
      expect(closed.cause).toEqual(
        expect.objectContaining({ message: "WebSocket heartbeat timeout" }),
      );
      expect(opened.protocols).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("uses the captured retry count after the source policy changes", async () => {
    const opened = recordingSocket();
    const retry = { maxRetries: 1, delayMs: 0 };
    const derived = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
    )({ retry });
    retry.maxRetries = 0;
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      path: "/room",
    });

    const [error, session] = await openControllableSocket(
      endpoint(derived),
      opened.latest,
    );
    expect(error).toBeNull();
    if (!session) throw new Error("Expected session");
    const first = opened.latest();
    first?.triggerClose({ code: 1012, reason: "restart", wasClean: true });
    await vi.waitFor(() => expect(opened.protocols).toHaveLength(2));
    session.close(1000, "done");
    opened.latest()?.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await session.closed;
  });

  test("leaves missing nested blocks unset", () => {
    const signal = new AbortController().signal;
    const stored = createClient(withEndpoint("https://example.test"))({
      signal,
    })[CLIENT].options;

    expect(stored?.signal).toBe(signal);
    expect(stored?.heartbeat).toBeUndefined();
    expect(stored?.protocols).toBeUndefined();
    expect(stored?.retry).toBeUndefined();
  });

  test("throws a nested getter from client(options) before transport or abort listeners", async () => {
    const handle = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, "addEventListener");
    const boom = new Error("heartbeat getter failed");
    const base = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );
    const read = defineRequest({
      method: "GET",
      output: struct.object({ ok: struct.boolean() }),
      path: "/health",
    });

    expect(() =>
      base({
        heartbeat: {
          get intervalMs(): number {
            throw boom;
          },
          message: () => "ping",
        },
        signal,
      }),
    ).toThrow(boom);
    const [error, data] = await read(base);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(handle).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
  });
});

describe("client option snapshots", () => {
  test("captures protocols, heartbeat, and retry when the option is applied", async () => {
    const heartbeat = {
      intervalMs: 10,
      message: () => ({ type: "ping" }),
    };
    const protocols = ["one"];
    const retry = {
      maxRetries: 1,
      delayMs: 0,
      shouldRetry: () => true,
    };
    const wsHeartbeat = withWebSocketHeartbeat(heartbeat);
    const wsProtocols = withWebSocketProtocols(protocols);
    const retryOption = withRetry(retry);
    const opened = recordingSocket();
    const first = createClient(wsHeartbeat, wsProtocols, retryOption);
    const second = createClient(wsHeartbeat, wsProtocols, retryOption);
    const live = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
      wsProtocols,
      retryOption,
    );

    heartbeat.intervalMs = 99;
    protocols.push("two");
    protocols[0] = "changed";
    retry.maxRetries = 9;
    retry.delayMs = 1;

    expect(first[CLIENT].config.webSocket.heartbeat?.intervalMs).toBe(10);
    expect(second[CLIENT].config.webSocket.heartbeat?.intervalMs).toBe(10);
    expect(first[CLIENT].config.webSocket.heartbeat).not.toBe(
      second[CLIENT].config.webSocket.heartbeat,
    );
    expect(first[CLIENT].config.webSocket.heartbeat?.message).toBe(
      heartbeat.message,
    );
    expect(first[CLIENT].config.webSocket.protocols).toEqual(["one"]);
    expect(second[CLIENT].config.webSocket.protocols).toEqual(["one"]);
    expect(first[CLIENT].config.webSocket.protocols).not.toBe(
      second[CLIENT].config.webSocket.protocols,
    );
    expect(first[CLIENT].config.retry?.maxRetries).toBe(1);
    expect(second[CLIENT].config.retry?.delayMs).toBe(0);
    expect(first[CLIENT].config.retry?.shouldRetry).toBe(retry.shouldRetry);
    expect(first[CLIENT].config).not.toBe(second[CLIENT].config);

    protocols.splice(0, protocols.length, "later");
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      path: "/room",
    });
    const [error, session] = await openControllableSocket(
      endpoint(live),
      opened.latest,
    );
    expect(error).toBeNull();
    opened.latest()?.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
    await vi.waitFor(() => expect(opened.protocols).toHaveLength(2));
    expect(opened.protocols[0]).toEqual(["one"]);
    expect(opened.protocols[1]).toEqual(["one"]);
    session?.close(1000, "done");
    opened.latest()?.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await session?.closed;
  });

  test("clears optional nested settings with undefined and lets a later option replace an earlier one", () => {
    const client = createClient(
      withWebSocketHeartbeat({ intervalMs: 5, message: () => "ping" }),
      withRetry({ maxRetries: 1 }),
      withWebSocketHeartbeat(undefined),
      withRetry({ maxRetries: 4 }),
    );

    expect(client[CLIENT].config.webSocket.heartbeat).toBeUndefined();
    expect(client[CLIENT].config.retry?.maxRetries).toBe(4);
  });

  test("reads a retry getter once when the option is applied", () => {
    let reads = 0;
    const boom = new Error("retry getter failed");
    const option = withRetry({
      get maxRetries(): number {
        reads += 1;
        if (reads > 1) throw boom;
        return 1;
      },
    });

    const client = createClient(option);
    expect(reads).toBe(1);
    expect(client[CLIENT].config.retry?.maxRetries).toBe(1);
    expect(() => createClient(option)).toThrow(boom);
    expect(reads).toBe(2);
  });

  test("snapshots unknown interceptor kinds in the original getter order", () => {
    const reads: string[] = [];
    const fn = createHttpInterceptor(() =>
      Promise.resolve(makeResponse({ status: 204 })),
    ).fn;
    const interceptor = {
      get kind() {
        reads.push("kind");
        return "unknown-kind";
      },
      get fn() {
        reads.push("fn");
        return fn;
      },
    };
    // @ts-expect-error Invalid runtime kinds must retain the original snapshot behavior.
    const option = withInterceptors(interceptor);
    const client = createClient(option);

    expect(reads).toEqual(["kind", "fn"]);
    expect(client[CLIENT].config.interceptors[0]).toEqual({
      kind: "unknown-kind",
      fn,
    });
    expect(client[CLIENT].config.interceptors[0]).not.toBe(interceptor);
  });

  test("copies interceptor records without copying their functions", async () => {
    let token = "first";
    const seenTokens: string[] = [];
    const httpFn = vi.fn(() => {
      seenTokens.push(token);
      return Promise.resolve(makeResponse({ status: 204 }));
    });
    // INTENT: preserve promise adoption microtask timing for next(request)
    const sseFn = vi.fn<SSEInterceptorFn>(async (request, next) =>
      next(request),
    );
    // INTENT: preserve promise adoption microtask timing for next(request)
    const socketFn = vi.fn<WebSocketInterceptorFn>(async (request, next) =>
      next(request),
    );
    const http = createHttpInterceptor(httpFn);
    const sse = createSSEInterceptor(sseFn);
    const socket = createWebSocketInterceptor(socketFn);
    const option = withInterceptors(http, sse, socket);
    const client = createClient(withEndpoint("https://example.test"), option);
    const again = createClient(withEndpoint("https://example.test"), option);
    http.fn = () => Promise.resolve(makeResponse({ status: 503 }));
    // @ts-expect-error kind is fixed; mutating it proves the snapshot copied it
    http.kind = "sse";

    const [error] = await defineRequest({
      method: "GET",
      path: "/health",
    })(client);
    token = "second";
    const [nextError] = await defineRequest({
      method: "GET",
      path: "/health",
    })(client);

    expect(error).toBeNull();
    expect(nextError).toBeNull();
    expect(seenTokens).toEqual(["first", "second"]);
    expect(httpFn).toHaveBeenCalledTimes(2);
    expect(client[CLIENT].config.interceptors[0]).toEqual({
      fn: httpFn,
      kind: "http",
    });
    expect(client[CLIENT].config.interceptors[0]).not.toBe(http);
    expect(client[CLIENT].config.interceptors[1]?.fn).toBe(sseFn);
    expect(client[CLIENT].config.interceptors[2]?.fn).toBe(socketFn);
    expect(again[CLIENT].config.interceptors[0]).not.toBe(
      client[CLIENT].config.interceptors[0],
    );
    expect(again[CLIENT].config.interceptors[0]?.fn).toBe(httpFn);
    expect(again[CLIENT].config.interceptors.map((item) => item.kind)).toEqual([
      "http",
      "sse",
      "web-socket",
    ]);
  });
});

describe("definition and request snapshots", () => {
  test("keeps an HTTP definition when the input object gains a throwing getter", () => {
    let reads = 0;
    const output = struct.object({ ok: struct.boolean() });
    const definition = {
      method: "GET",
      output,
      path: "/health",
      get extra(): never {
        reads += 1;
        throw new Error("definition getter must not be read");
      },
    };

    const endpoint = defineRequest(definition);
    definition.method = "POST";
    definition.path = "/moved";

    expect(reads).toBe(0);
    expect(endpoint).toEqual(expect.any(Function));
  });

  test("uses the HTTP definition captured at declaration", async () => {
    let path = "";
    const output = struct.object({ ok: struct.boolean() });
    const definition = {
      method: "GET",
      output,
      path: "/health",
    };
    const endpoint = defineRequest(definition);
    definition.path = "/moved";
    definition.method = "POST";
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle((input) => {
        path = input instanceof Request ? new URL(input.url).pathname : "";
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );

    const [error, data] = await endpoint(client);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(path).toBe("/health");
  });

  test("keeps the SSE event dictionary independent and lazy", async () => {
    const text = struct.string();
    let defineReads = 0;
    const lazy = defineEventStream({
      events: {
        get message() {
          defineReads += 1;
          return text;
        },
      },
      path: "/events",
    });
    expect(defineReads).toBe(0);

    const replaced: { message: AnyStruct } = { message: struct.string() };
    const stable = defineEventStream({
      events: replaced,
      path: "/events",
    });
    replaced.message = struct.number();

    const box: { schema: AnyStruct; readonly message: AnyStruct } = {
      schema: struct.string(),
      get message() {
        return this.schema;
      },
    };
    const endpoint = defineEventStream({
      events: box,
      path: "/events",
    });
    box.schema = struct.number();

    const created: unknown = Object.create({ message: struct.string() });
    if (!isEventDictionary(created)) {
      throw new Error("expected an event dictionary");
    }
    const hidden = created;
    Object.defineProperty(hidden, "tick", {
      enumerable: false,
      value: struct.string(),
    });
    const reserved = defineEventStream({
      events: hidden,
      path: "/events",
    });

    const [lazyError, lazyStream] = await lazy(
      createClient(
        withEndpoint("https://example.test"),
        sseHandle("data: 7\n\n"),
      ),
    );
    expect(lazyError).toBeNull();
    expect(defineReads).toBe(1);
    expect(await Array.fromAsync(lazyStream ?? [])).toEqual([
      { data: "7", event: "message", id: undefined },
    ]);

    const [stableError, stableStream] = await stable(
      createClient(
        withEndpoint("https://example.test"),
        sseHandle("data: hello\n\n"),
      ),
    );
    expect(stableError).toBeNull();
    expect(await Array.fromAsync(stableStream ?? [])).toEqual([
      { data: "hello", event: "message", id: undefined },
    ]);

    const [error, stream] = await endpoint(
      createClient(
        withEndpoint("https://example.test"),
        sseHandle("data: 7\n\n"),
      ),
    );
    expect(error).toBeNull();
    expect(await Array.fromAsync(stream ?? [])).toEqual([
      { data: 7, event: "message", id: undefined },
    ]);

    const [reservedError, reservedStream] = await reserved(
      createClient(
        withEndpoint("https://example.test"),
        sseHandle(
          "event: tick\ndata: hidden\n\nevent: message\ndata: inherited\n\n",
        ),
      ),
    );
    expect(reservedError).toBeNull();
    expect(await Array.fromAsync(reservedStream ?? [])).toEqual([
      { data: "hidden", event: "tick", id: undefined },
    ]);
  });

  test("keeps definition protocols after the input array changes", async () => {
    const opened = recordingSocket();
    const protocols = ["v1"];
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      path: "/room",
      protocols,
    });
    protocols[0] = "changed";
    protocols.push("v2");
    const [error, session] = await openControllableSocket(
      endpoint(
        createClient(
          withEndpoint("https://example.test"),
          withWebSocketHandle(opened.Socket),
        ),
      ),
      opened.latest,
    );

    expect(error).toBeNull();
    expect(opened.protocols).toEqual([["v1"]]);
    session?.close(1000, "done");
    opened.latest()?.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await session?.closed;
  });

  test("keeps finalizeHeaders identity on the client and each request", async () => {
    const finalizeHeaders: NonNullable<HttpRequest["finalizeHeaders"]> = () =>
      undefined;
    const seen: (typeof finalizeHeaders | undefined)[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      (config) => {
        config.finalizeHeaders = finalizeHeaders;
      },
      withInterceptors(
        createHttpInterceptor((request) => {
          seen.push(request.finalizeHeaders);
          return Promise.resolve(makeResponse({ status: 204 }));
        }),
      ),
    );
    const post = defineRequest({ method: "POST", path: "/submit" });

    const [firstError] = await post(client);
    const [secondError] = await post(client);

    expect(firstError).toBeNull();
    expect(secondError).toBeNull();
    expect(seen).toEqual([finalizeHeaders, finalizeHeaders]);
    expect(client[CLIENT].config.finalizeHeaders).toBe(finalizeHeaders);
  });

  test("createHttpRequest keeps the finalizeHeaders function", () => {
    const finalizeHeaders: NonNullable<HttpRequest["finalizeHeaders"]> = () =>
      undefined;
    const request = createHttpRequest("POST", "/submit", undefined, undefined, {
      baseEndpoint: "https://example.test",
      signal: new AbortController().signal,
      finalizeHeaders,
    });

    expect(request.finalizeHeaders).toBe(finalizeHeaders);
  });

  test("a throwing finalizeHeaders getter escapes createHttpRequest", () => {
    const boom = new Error("finalizeHeaders getter failed");

    expect(() =>
      createHttpRequest("POST", "/submit", undefined, undefined, {
        baseEndpoint: "https://example.test",
        signal: new AbortController().signal,
        get finalizeHeaders(): NonNullable<HttpRequest["finalizeHeaders"]> {
          throw boom;
        },
      }),
    ).toThrow(boom);
  });
});
