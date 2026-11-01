import { describe, expect, test, vi } from "vitest";
import { makeResponse } from "../internal/http_response";
import { createHttpInterceptor } from "../interceptor";
import { struct } from "../struct";
import { defineEventStream } from "../sse";
import { defineRequest } from "../http";
import { defineWebSocket } from "../web_socket";
import { CLIENT, createClient, type RequestOptions } from "./client";
import {
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
  withWebSocketHandle,
} from "./option";

const json = (body: unknown) => Response.json(body);

describe("client factory and client values", () => {
  test("the factory is a function and returns fresh plain client values", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const first = base();
    const second = base();

    expect(typeof base).toBe("function");
    expect(typeof first).toBe("object");
    expect(first).not.toBe(base);
    expect(first).not.toBe(second);
    expect(base[CLIENT].options).toEqual({});
    expect(first[CLIENT].options).toEqual({});
    expect(first[CLIENT].config).toBe(base[CLIENT].config);
  });

  test("calling a derived client value throws a TypeError", () => {
    const derived = createClient(withEndpoint("https://example.test"))();

    expect(() => (derived as unknown as () => void)()).toThrow(TypeError);
  });

  test("client(), client(undefined), and client({}) carry no request options", () => {
    const base = createClient(withEndpoint("https://example.test"));

    for (const client of [base(), base(undefined), base({})]) {
      expect(client[CLIENT].options).toEqual({});
      expect(client[CLIENT].options).not.toBe(base[CLIENT].options);
    }
  });

  test("copies all seven known fields and ignores unknown fields", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const known = {
      signal: new AbortController().signal,
      onUploadProgress: () => undefined,
      onDownloadProgress: () => undefined,
      beforeConnect: () => undefined,
      protocols: ["chat.v1"],
      heartbeat: { intervalMs: 1_000, message: () => "ping" },
      reconnect: { attempts: 1, delayMs: 10 },
    } as const satisfies RequestOptions;
    const patch = { ...known, timeout: 100, abort: known.signal };

    const derived = base(patch);

    expect(derived[CLIENT].options).toEqual(known);
    expect(Object.keys(derived[CLIENT].options).sort()).toEqual(
      Object.keys(known).sort(),
    );
    expect(derived[CLIENT].options).not.toBe(patch);
  });

  test("omits fields whose value is undefined", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const derived = base({
      signal: undefined,
      onDownloadProgress: undefined,
      protocols: undefined,
    });

    expect(Object.keys(derived[CLIENT].options)).toEqual([]);
  });

  test("keeps nested heartbeat, protocols, and reconnect by reference", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const heartbeat = { intervalMs: 1_000 };
    const protocols = ["chat.v1"];
    const reconnect = { attempts: 1, delayMs: 10 };
    const derived = base({ heartbeat, protocols, reconnect });

    expect(derived[CLIENT].options.heartbeat).toBe(heartbeat);
    expect(derived[CLIENT].options.protocols).toBe(protocols);
    expect(derived[CLIENT].options.reconnect).toBe(reconnect);

    heartbeat.intervalMs = 2_000;
    protocols.push("chat.v2");
    reconnect.attempts = 5;

    expect(derived[CLIENT].options.heartbeat?.intervalMs).toBe(2_000);
    expect(derived[CLIENT].options.protocols).toEqual(["chat.v1", "chat.v2"]);
    expect(derived[CLIENT].options.reconnect?.attempts).toBe(5);
  });

  test("does not perform I/O or listen for abort while deriving", () => {
    const handle = vi.fn(async () => json({ ok: true }));
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, "addEventListener");
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );

    const derived = client({ signal, protocols: ["chat.v1"] });

    expect(derived).not.toBe(client);
    expect(handle).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  test("keeps an already aborted signal aborted", async () => {
    const handle = vi.fn(async () => json({ ok: true }));
    const controller = new AbortController();
    controller.abort();
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
      withInterceptors(
        createHttpInterceptor(async () => {
          throw new Error("transport must not run");
        }),
      ),
    );
    const read = defineRequest({
      method: "GET",
      path: "/health",
      output: struct.object({ ok: struct.boolean() }),
    });

    const [error, data] = await read(client({ signal: controller.signal }));

    expect(error?.code).toBe("NET_ABORTED");
    expect(data).toBeUndefined();
    expect(handle).not.toHaveBeenCalled();
  });

  test("parallel derived clients do not share abort signals", async () => {
    let release: ((response: Response) => void) | undefined;
    const handle = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );
    const read = defineRequest({ method: "GET", path: "/hang" });
    const first = new AbortController();
    const second = new AbortController();
    const pendingFirst = read(client({ signal: first.signal }));
    const pendingSecond = read(client({ signal: second.signal }));

    first.abort();
    const [firstError] = await pendingFirst;
    let secondSettled = false;
    void pendingSecond.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();

    expect(firstError?.code).toBe("NET_ABORTED");
    expect(secondSettled).toBe(false);
    second.abort();
    const [secondError] = await pendingSecond;
    expect(secondError?.code).toBe("NET_ABORTED");
    release?.(new Response(null, { status: 204 }));
  });

  test("reads each known patch key once at derivation", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const firstSignal = new AbortController().signal;
    const onDownloadProgress = () => undefined;
    const reads: string[] = [];
    const patch = {} as RequestOptions;
    const values = {
      signal: firstSignal,
      beforeConnect: () => undefined,
      heartbeat: { intervalMs: 1_000 },
      onDownloadProgress,
      onUploadProgress: () => undefined,
      protocols: ["chat.v1"],
      reconnect: { attempts: 1 },
    } as const;
    for (const key of [
      "signal",
      "onUploadProgress",
      "onDownloadProgress",
      "beforeConnect",
      "protocols",
      "heartbeat",
      "reconnect",
    ] as const) {
      Object.defineProperty(patch, key, {
        configurable: true,
        enumerable: true,
        get() {
          reads.push(key);
          return values[key];
        },
      });
    }

    const derived = base(patch);
    const fixed = derived[CLIENT].options;

    expect(reads).toEqual([
      "signal",
      "onUploadProgress",
      "onDownloadProgress",
      "beforeConnect",
      "protocols",
      "heartbeat",
      "reconnect",
    ]);
    expect(derived[CLIENT].options).toBe(fixed);
    expect(fixed).toEqual(values);
    expect(reads).toHaveLength(7);
    expect(fixed.heartbeat).toBe(values.heartbeat);
    expect(fixed.protocols).toBe(values.protocols);
    expect(fixed.reconnect).toBe(values.reconnect);
  });

  test("ignores a later replace, delete, and add on the derived patch", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const firstSignal = new AbortController().signal;
    const secondSignal = new AbortController().signal;
    const onDownloadProgress = () => undefined;
    const patch: RequestOptions = { signal: firstSignal };
    const derived = base(patch);

    patch.signal = secondSignal;
    expect(derived[CLIENT].options).toEqual({ signal: firstSignal });
    delete patch.signal;
    expect(derived[CLIENT].options).toEqual({ signal: firstSignal });
    patch.onDownloadProgress = onDownloadProgress;
    expect(derived[CLIENT].options).toEqual({ signal: firstSignal });
    expect(derived[CLIENT].options.onDownloadProgress).toBeUndefined();
  });

  test("keeps the factory and other client values fixed when the patch changes", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const firstSignal = new AbortController().signal;
    const secondSignal = new AbortController().signal;
    const patch: RequestOptions = { signal: firstSignal };
    const first = base(patch);
    const sibling = base({ signal: secondSignal });

    patch.signal = secondSignal;
    delete patch.signal;
    patch.onDownloadProgress = () => undefined;

    expect(base[CLIENT].options).toEqual({});
    expect(first[CLIENT].options).toEqual({ signal: firstSignal });
    expect(sibling[CLIENT].options).toEqual({ signal: secondSignal });
    expect(first[CLIENT].options).not.toBe(patch);
    expect(first[CLIENT].config).toBe(base[CLIENT].config);
  });

  test("does not read unknown getters", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const read = vi.fn(() => 1);
    const patch = Object.defineProperty({} as RequestOptions, "extra", {
      enumerable: true,
      get: read,
    });

    expect(base(patch)[CLIENT].options).toEqual({});
    expect(read).not.toHaveBeenCalled();
  });

  test("stores options separately from the parent state and the patch object", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const signal = new AbortController().signal;
    const patch: RequestOptions = { signal };
    const derived = base(patch);
    const first = derived[CLIENT].options;
    const second = derived[CLIENT].options;

    expect(first).not.toBe(base[CLIENT].options);
    expect(first).not.toBe(patch);
    expect(second).toBe(first);
    expect(second).toEqual({ signal });
  });

  test("throws from client(patch) when a patch getter throws and leaves the factory usable", async () => {
    const handle = vi.fn(async () => json({ ok: true }));
    const parent = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );
    const boom = new Error("signal getter failed");
    const patch = Object.defineProperty({} as RequestOptions, "signal", {
      configurable: true,
      enumerable: true,
      get() {
        throw boom;
      },
    });
    const read = defineRequest({
      method: "GET",
      output: struct.object({ ok: struct.boolean() }),
      path: "/health",
    });

    expect(() => parent(patch)).toThrow(boom);
    const [error, data] = await read(parent);

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(handle).toHaveBeenCalledOnce();
  });
});

describe("request options ignored by other protocols", () => {
  test("HTTP ignores WebSocket fields", async () => {
    const seen: string[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(async () => json({ ok: true })),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          seen.push(request.method);
          return makeResponse({
            body: { ok: true },
            headers: new Headers({ "content-type": "application/json" }),
            status: 200,
          });
        }),
      ),
    );
    const read = defineRequest({
      method: "GET",
      path: "/health",
      output: struct.object({ ok: struct.boolean() }),
    });

    const [error, data] = await read(
      client({
        protocols: ["chat.v1"],
        heartbeat: { intervalMs: 1_000 },
        beforeConnect: () => {
          seen.push("before");
        },
        reconnect: { attempts: 2 },
      }),
    );

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(seen).toEqual(["GET"]);
  });

  test("SSE ignores HTTP progress and WebSocket fields", async () => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(async () => {
        return new Response("data: hi\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    const stream = defineEventStream({
      path: "/events",
      maxBufferSize: 1024,
      maxQueueSize: 4,
      events: { message: struct.string() },
    });

    const [error, events] = await stream(
      client({
        onUploadProgress: () => undefined,
        onDownloadProgress: () => undefined,
        protocols: ["chat.v1"],
      }),
    );

    expect(error).toBeNull();
    events?.close();
    await events?.closed;
  });

  test("WebSocket ignores HTTP progress fields", async () => {
    const constructed: string[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(
        class extends EventTarget {
          constructor(url: string) {
            super();
            constructed.push(url);
            queueMicrotask(() => {
              this.dispatchEvent(new Event("open"));
            });
          }
          close() {
            this.dispatchEvent(new CloseEvent("close"));
          }
          send() {
            return undefined;
          }
        } as unknown as typeof WebSocket,
      ),
    );
    const socket = defineWebSocket({
      path: "/room",
      incoming: struct.object({ ok: struct.boolean() }),
      maxIncomingQueueSize: 4,
    });

    const [error, session] = await socket(
      client({
        onUploadProgress: () => undefined,
        onDownloadProgress: () => undefined,
      }),
    );

    expect(error).toBeNull();
    expect(constructed).toEqual(["wss://example.test/room"]);
    await session?.[Symbol.asyncDispose]();
  });
});

describe("AbortSignal.timeout classification", () => {
  test("HTTP reports NET_TIMEOUT for AbortSignal.timeout and NET_ABORTED for a manual abort", async () => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const read = defineRequest({ method: "GET", path: "/hang" });
    const manual = new AbortController();
    const timed = read(client({ signal: AbortSignal.timeout(20) }));
    const aborted = read(client({ signal: manual.signal }));
    manual.abort();

    const [timeoutError] = await timed;
    const [abortError] = await aborted;
    expect(timeoutError?.code).toBe("NET_TIMEOUT");
    expect(abortError?.code).toBe("NET_ABORTED");
  });

  test("SSE open reports NET_TIMEOUT for AbortSignal.timeout and NET_ABORTED for a manual abort", async () => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const stream = defineEventStream({
      path: "/events",
      maxBufferSize: 1024,
      maxQueueSize: 4,
      events: { message: struct.string() },
    });
    const manual = new AbortController();
    const timed = stream(client({ signal: AbortSignal.timeout(20) }));
    const aborted = stream(client({ signal: manual.signal }));
    manual.abort();

    const [timeoutError, timeoutStream] = await timed;
    const [abortError, abortStream] = await aborted;
    expect(timeoutError?.code).toBe("NET_TIMEOUT");
    expect(abortError?.code).toBe("NET_ABORTED");
    expect(timeoutStream).toBeUndefined();
    expect(abortStream).toBeUndefined();
  });

  test("WebSocket open reports NET_TIMEOUT for AbortSignal.timeout and NET_ABORTED for a manual abort", async () => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(
        class extends EventTarget {
          constructor(_url: string) {
            super();
          }
          close() {
            return undefined;
          }
          send() {
            return undefined;
          }
        } as unknown as typeof WebSocket,
      ),
    );
    const socket = defineWebSocket({
      path: "/room",
      incoming: struct.unknown(),
      maxIncomingQueueSize: 4,
    });
    const manual = new AbortController();
    const timed = socket(client({ signal: AbortSignal.timeout(20) }));
    const aborted = socket(client({ signal: manual.signal }));
    manual.abort();

    const [timeoutError, timeoutSession] = await timed;
    const [abortError, abortSession] = await aborted;
    expect(timeoutError?.code).toBe("NET_TIMEOUT");
    expect(abortError?.code).toBe("NET_ABORTED");
    expect(timeoutSession).toBeUndefined();
    expect(abortSession).toBeUndefined();
  });
});
