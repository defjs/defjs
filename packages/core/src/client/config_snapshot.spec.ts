import { describe, expect, test, vi } from "vitest";
import { defineRequest } from "../http";
import { createHttpRequest } from "../http/request";
import { makeResponse } from "../internal/http_response";
import {
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
} from "../interceptor";
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
  withSSEHandle,
  withSSEReconnect,
  withWebSocketHandle,
  withWebSocketHeartbeat,
  withWebSocketProtocols,
  withWebSocketReconnect,
  withXSRF,
} from "./option";

const textEncoder = new TextEncoder();

function sseHandle(text: string) {
  return withSSEHandle(async () => {
    return new Response(
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
  return {
    // Type boundary: ControllableSocket listeners are not the DOM EventTarget
    // signatures on WebSocketHandle. The two construct signatures do not overlap,
    // so a direct assertion is rejected and unknown is required.
    Socket: RecordingSocket as unknown as Parameters<
      typeof withWebSocketHandle
    >[0],
    instances,
    latest,
    protocols,
  };
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
      reconnect: undefined,
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
      withHTTPHandle(async () => Response.json({ ok: true })),
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
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: "/events",
    });
    const socket = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
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
  test("keeps captured heartbeat, reconnect, and protocols after the source changes", async () => {
    vi.useFakeTimers();
    const opened = recordingSocket();
    const message = () => ({ type: "ping" as const });
    const isAck = () => false;
    const shouldReconnect = () => false;
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
    const reconnect = { attempts: 1, delayMs: 0, shouldReconnect };
    const base = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
    );
    const derived = base({
      beforeConnect,
      heartbeat,
      protocols,
      reconnect,
      signal,
    });
    const stored = derived[CLIENT].options;
    if (!stored?.heartbeat || !stored.reconnect || !stored.protocols) {
      throw new Error("Expected captured nested options");
    }

    expect(stored.signal).toBe(signal);
    expect(stored.beforeConnect).toBe(beforeConnect);
    expect(stored.heartbeat.message).toBe(message);
    expect(stored.heartbeat.isAck).toBe(isAck);
    expect(stored.reconnect.shouldReconnect).toBe(shouldReconnect);
    expect(stored.heartbeat).not.toBe(heartbeat);
    expect(stored.reconnect).not.toBe(reconnect);
    expect(stored.protocols).not.toBe(protocols);

    heartbeat.intervalMs = 100_000;
    delete heartbeat.timeoutMs;
    protocols[0] = "changed";
    protocols.push("v2");
    reconnect.attempts = 0;
    reconnect.shouldReconnect = () => true;

    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
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
      await expect(session.closed).resolves.toMatchObject({
        cause: expect.objectContaining({
          message: "WebSocket heartbeat timeout",
        }),
        kind: "error",
      });
      expect(opened.protocols).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("uses captured reconnect attempts after the source policy changes", async () => {
    const opened = recordingSocket();
    const reconnect = { attempts: 1, delayMs: 0 };
    const derived = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
    )({ reconnect });
    reconnect.attempts = 0;
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
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
    expect(stored?.reconnect).toBeUndefined();
  });

  test("keeps falsy heartbeat and reconnect values", () => {
    const base = createClient(withEndpoint("https://example.test"));
    for (const value of [false, 0, Number.NaN, "", null]) {
      const stored = base({
        heartbeat: value as never,
        reconnect: value as never,
      })[CLIENT].options;
      expect(stored?.heartbeat).toBe(value);
      expect(stored?.reconnect).toBe(value);
    }
  });

  test("passes a non-array protocols value through to execution validation", async () => {
    const opened = recordingSocket();
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: "/room",
    });
    const derived = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
    )({ protocols: {} as never });

    expect(derived[CLIENT].options?.protocols).toEqual({});
    const [error, session] = await endpoint(derived);

    expect(session).toBeUndefined();
    expect(error?.code).toBe("REQ_OPTIONS_INVALID");
    expect(opened.protocols).toEqual([]);
  });

  test("throws a nested getter from client(options) before transport or abort listeners", async () => {
    const handle = vi.fn(async () => Response.json({ ok: true }));
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

  test("keeps an invalid numeric reconnect policy until the operation runs", async () => {
    const opened = recordingSocket();
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: "/room",
    });
    const derived = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
    )({ reconnect: { attempts: -1 } });

    expect(derived[CLIENT].options?.reconnect).toEqual({ attempts: -1 });
    const [error, session] = await endpoint(derived);

    expect(session).toBeUndefined();
    expect(error?.code).toBe("REQ_OPTIONS_INVALID");
    expect(opened.protocols).toEqual([]);
  });
});

describe("client option snapshots", () => {
  test("captures protocols, heartbeat, and reconnect when the option is applied", async () => {
    const heartbeat = {
      intervalMs: 10,
      message: () => ({ type: "ping" }),
    };
    const protocols = ["one"];
    const wsReconnect = { attempts: 1, delayMs: 0 };
    const sseReconnect = {
      attempts: 2,
      delayMs: 25,
      shouldReconnect: () => true,
    };
    const wsHeartbeat = withWebSocketHeartbeat(heartbeat);
    const wsProtocols = withWebSocketProtocols(protocols);
    const wsRetry = withWebSocketReconnect(wsReconnect);
    const sseRetry = withSSEReconnect(sseReconnect);
    const opened = recordingSocket();
    const first = createClient(wsHeartbeat, wsProtocols, wsRetry, sseRetry);
    const second = createClient(wsHeartbeat, wsProtocols, wsRetry, sseRetry);
    const live = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(opened.Socket),
      wsProtocols,
      wsRetry,
    );

    heartbeat.intervalMs = 99;
    protocols.push("two");
    protocols[0] = "changed";
    wsReconnect.attempts = 8;
    sseReconnect.attempts = 9;
    sseReconnect.delayMs = 1;

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
    expect(first[CLIENT].config.webSocket.reconnect?.attempts).toBe(1);
    expect(second[CLIENT].config.sse.reconnect?.attempts).toBe(2);
    expect(second[CLIENT].config.sse.reconnect?.delayMs).toBe(25);
    expect(first[CLIENT].config.sse.reconnect?.shouldReconnect).toBe(
      sseReconnect.shouldReconnect,
    );
    expect(first[CLIENT].config).not.toBe(second[CLIENT].config);

    protocols.splice(0, protocols.length, "later");
    wsReconnect.attempts = 0;
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
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
      withWebSocketHeartbeat({ intervalMs: 5 }),
      withWebSocketReconnect({ attempts: 1 }),
      withSSEReconnect({ attempts: 1 }),
      withWebSocketHeartbeat(undefined),
      withWebSocketReconnect({ attempts: 4 }),
      withSSEReconnect(undefined),
    );

    expect(client[CLIENT].config.webSocket.heartbeat).toBeUndefined();
    expect(client[CLIENT].config.webSocket.reconnect?.attempts).toBe(4);
    expect(client[CLIENT].config.sse.reconnect).toBeUndefined();
  });

  test.each([false, 0, Number.NaN, "", null])(
    "keeps falsy reconnect setting %s",
    (value) => {
      const client = createClient(
        withWebSocketReconnect({ attempts: 7 }),
        withWebSocketReconnect(value as never),
        withSSEReconnect({ attempts: 7 }),
        withSSEReconnect(value as never),
        withWebSocketHeartbeat({ intervalMs: 5 }),
        withWebSocketHeartbeat(value as never),
      );

      expect(client[CLIENT].config.webSocket.reconnect).toBe(value);
      expect(client[CLIENT].config.sse.reconnect).toBe(value);
      expect(client[CLIENT].config.webSocket.heartbeat).toBe(value);
    },
  );

  test("reads a reconnect getter once when the option is applied", () => {
    let reads = 0;
    const boom = new Error("reconnect getter failed");
    const option = withSSEReconnect({
      get attempts(): number {
        reads += 1;
        if (reads > 1) throw boom;
        return 1;
      },
    });

    const client = createClient(option);
    expect(reads).toBe(1);
    expect(client[CLIENT].config.sse.reconnect?.attempts).toBe(1);
    expect(() => createClient(option)).toThrow(boom);
    expect(reads).toBe(2);
  });

  test("copies interceptor records without copying their functions", async () => {
    let token = "first";
    const seenTokens: string[] = [];
    const httpFn = vi.fn(async () => {
      seenTokens.push(token);
      return makeResponse({ status: 204 });
    });
    const sseFn = vi.fn(async (_request, next) => next(_request));
    const socketFn = vi.fn(async (_request, next) => next(_request));
    const http = createHttpInterceptor(httpFn);
    const sse = createSSEInterceptor(sseFn);
    const socket = createWebSocketInterceptor(socketFn);
    const option = withInterceptors(http, sse, socket);
    const client = createClient(withEndpoint("https://example.test"), option);
    const again = createClient(withEndpoint("https://example.test"), option);
    http.fn = async () => makeResponse({ status: 503 });
    (http as { kind: string }).kind = "sse";

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
      withHTTPHandle(async (input) => {
        path = input instanceof Request ? new URL(input.url).pathname : "";
        return Response.json({ ok: true });
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
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: "/events",
    });
    expect(defineReads).toBe(0);

    const replaced: { message: AnyStruct } = { message: struct.string() };
    const stable = defineEventStream({
      events: replaced,
      maxBufferSize: 1024,
      maxQueueSize: 4,
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
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: "/events",
    });
    box.schema = struct.number();

    const hidden: { tick?: ReturnType<typeof struct.string> } = Object.create({
      message: struct.string(),
    });
    Object.defineProperty(hidden, "tick", {
      enumerable: false,
      value: struct.string(),
    });
    const reserved = defineEventStream({
      events: hidden,
      maxBufferSize: 1024,
      maxQueueSize: 4,
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

  test("does not throw while declaring an event stream with a missing dictionary", () => {
    expect(() =>
      defineEventStream({
        events: undefined as never,
        maxBufferSize: 1024,
        maxQueueSize: 4,
        path: "/events",
      }),
    ).not.toThrow();
  });

  test("keeps definition protocols after the input array changes", async () => {
    const opened = recordingSocket();
    const protocols = ["v1"];
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
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

  test("gives each HTTP request its own xsrf record", async () => {
    const tokenProvider = () => "token";
    const source = {
      cookieName: "csrf",
      headerName: "x-csrf",
      tokenProvider,
    };
    const seen: string[] = [];
    let first = true;
    const client = createClient(
      withEndpoint("https://example.test"),
      withXSRF(source),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          seen.push(request.xsrf?.headerName ?? "");
          if (first && request.xsrf) {
            first = false;
            request.xsrf.headerName = "changed";
            request.xsrf.tokenProvider = () => "other";
          }
          return makeResponse({ status: 204 });
        }),
      ),
    );
    source.headerName = "mutated";
    const post = defineRequest({ method: "POST", path: "/submit" });

    const [firstError] = await post(client);
    const [secondError] = await post(client);

    expect(firstError).toBeNull();
    expect(secondError).toBeNull();
    expect(seen).toEqual(["x-csrf", "x-csrf"]);
    expect(client[CLIENT].config.xsrf?.headerName).toBe("x-csrf");
    expect(client[CLIENT].config.xsrf?.tokenProvider).toBe(tokenProvider);
  });

  test("copies xsrf fields onto the request and keeps the provider", () => {
    const tokenProvider = () => "token";
    const xsrf = {
      cookieName: "csrf",
      headerName: "x-csrf",
      tokenProvider,
    };
    const request = createHttpRequest("POST", "/submit", undefined, undefined, {
      baseEndpoint: "https://example.test",
      signal: new AbortController().signal,
      xsrf,
    });
    xsrf.headerName = "changed";

    expect(request.xsrf).not.toBe(xsrf);
    expect(request.xsrf?.headerName).toBe("x-csrf");
    expect(request.xsrf?.cookieName).toBe("csrf");
    expect(request.xsrf?.tokenProvider).toBe(tokenProvider);
  });

  test("throws an xsrf getter while building the request", () => {
    const boom = new Error("xsrf getter failed");

    expect(() =>
      createHttpRequest("POST", "/submit", undefined, undefined, {
        baseEndpoint: "https://example.test",
        signal: new AbortController().signal,
        xsrf: {
          cookieName: "csrf",
          get headerName(): string {
            throw boom;
          },
        },
      }),
    ).toThrow(boom);
  });
});
