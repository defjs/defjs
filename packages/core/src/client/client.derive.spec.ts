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

describe("callable client derivation", () => {
  test("returns a new client and leaves the original request options empty", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const first = base();
    const second = base();

    expect(typeof base).toBe("function");
    expect(first).not.toBe(base);
    expect(second).not.toBe(base);
    expect(first).not.toBe(second);
    expect(base[CLIENT].options).toEqual({});
    expect(first[CLIENT].options).toEqual({});
    expect(first[CLIENT].config).toBe(base[CLIENT].config);
  });

  test("overlays fields, lets a later call win, and treats undefined as not provided", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const firstSignal = new AbortController().signal;
    const secondSignal = new AbortController().signal;
    const onDownloadProgress = () => undefined;
    const withAbort = base({ abort: firstSignal });
    const withProgress = withAbort({ onDownloadProgress });
    const replaced = withProgress({ abort: secondSignal });
    const keptAbort = replaced({ abort: undefined });
    const keptProgress = keptAbort({ onDownloadProgress: undefined });
    const copiedEmpty = keptProgress({});
    const copiedUndefined = keptProgress(undefined);
    const copiedOmitted = keptProgress();

    expect(base[CLIENT].options).toEqual({});
    expect(withAbort[CLIENT].options).toEqual({ abort: firstSignal });
    expect(withProgress[CLIENT].options).toEqual({
      abort: firstSignal,
      onDownloadProgress,
    });
    expect(replaced[CLIENT].options).toEqual({
      abort: secondSignal,
      onDownloadProgress,
    });
    expect(replaced[CLIENT].options.abort).not.toBe(firstSignal);
    expect(keptAbort[CLIENT].options.abort).toBe(secondSignal);
    expect(keptAbort[CLIENT].options.onDownloadProgress).toBe(
      onDownloadProgress,
    );
    expect(keptProgress[CLIENT].options.abort).toBe(secondSignal);
    expect(keptProgress[CLIENT].options.onDownloadProgress).toBe(
      onDownloadProgress,
    );
    expect(copiedEmpty[CLIENT].options).toEqual(keptProgress[CLIENT].options);
    expect(copiedUndefined[CLIENT].options).toEqual(
      keptProgress[CLIENT].options,
    );
    expect(copiedOmitted[CLIENT].options).toEqual(keptProgress[CLIENT].options);
    expect(copiedEmpty[CLIENT].options).not.toBe(keptProgress[CLIENT].options);
    expect(copiedUndefined[CLIENT].options).not.toBe(
      keptProgress[CLIENT].options,
    );
    expect(copiedOmitted[CLIENT].options).not.toBe(
      keptProgress[CLIENT].options,
    );
    expect(copiedEmpty).not.toBe(copiedUndefined);
    expect(copiedEmpty).not.toBe(copiedOmitted);
  });

  test("keeps every parent field on an empty patch and overrides each field on its own", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const parentValues = {
      abort: new AbortController().signal,
      onUploadProgress: () => undefined,
      onDownloadProgress: () => undefined,
      beforeConnect: () => undefined,
      protocols: ["chat.v1"],
      heartbeat: { intervalMs: 1_000, message: () => "ping" },
      reconnect: { attempts: 1, delayMs: 10 },
    } as const satisfies RequestOptions;
    const parent = base(parentValues);
    const kept = parent({});

    expect(kept[CLIENT].options).toEqual(parentValues);
    expect(kept[CLIENT].options).not.toBe(parent[CLIENT].options);
    expect(kept[CLIENT].options.protocols).toBe(parentValues.protocols);
    expect(kept[CLIENT].options.heartbeat).toBe(parentValues.heartbeat);
    expect(kept[CLIENT].options.reconnect).toBe(parentValues.reconnect);
    expect(parent[CLIENT].options).toEqual(parentValues);

    const overrides = {
      abort: new AbortController().signal,
      onUploadProgress: () => undefined,
      onDownloadProgress: () => undefined,
      beforeConnect: () => undefined,
      protocols: ["chat.v2"],
      heartbeat: { intervalMs: 2_000 },
      reconnect: { attempts: 4, delayMs: 20 },
    } as const satisfies RequestOptions;

    expect(parent({ abort: overrides.abort })[CLIENT].options).toEqual({
      ...parentValues,
      abort: overrides.abort,
    });
    expect(
      parent({ onUploadProgress: overrides.onUploadProgress })[CLIENT].options,
    ).toEqual({
      ...parentValues,
      onUploadProgress: overrides.onUploadProgress,
    });
    expect(
      parent({ onDownloadProgress: overrides.onDownloadProgress })[CLIENT]
        .options,
    ).toEqual({
      ...parentValues,
      onDownloadProgress: overrides.onDownloadProgress,
    });
    expect(
      parent({ beforeConnect: overrides.beforeConnect })[CLIENT].options,
    ).toEqual({
      ...parentValues,
      beforeConnect: overrides.beforeConnect,
    });
    expect(parent({ protocols: overrides.protocols })[CLIENT].options).toEqual({
      ...parentValues,
      protocols: overrides.protocols,
    });
    expect(parent({ heartbeat: overrides.heartbeat })[CLIENT].options).toEqual({
      ...parentValues,
      heartbeat: overrides.heartbeat,
    });
    expect(parent({ reconnect: overrides.reconnect })[CLIENT].options).toEqual({
      ...parentValues,
      reconnect: overrides.reconnect,
    });
    expect(parent[CLIENT].options).toEqual(parentValues);
  });

  test("replaces nested request options as whole values", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const firstHeartbeat = { intervalMs: 1_000, message: () => "ping" };
    const secondHeartbeat = { intervalMs: 2_000 };
    const firstProtocols = ["chat.v1"];
    const secondProtocols = ["chat.v2"];
    const firstReconnect = { attempts: 1, delayMs: 10 };
    const secondReconnect = { attempts: 4, delayMs: 20 };
    const derived = base({
      heartbeat: firstHeartbeat,
      protocols: firstProtocols,
      reconnect: firstReconnect,
    })({
      heartbeat: secondHeartbeat,
      protocols: secondProtocols,
      reconnect: secondReconnect,
    });

    expect(derived[CLIENT].options.heartbeat).toBe(secondHeartbeat);
    expect(derived[CLIENT].options.protocols).toBe(secondProtocols);
    expect(derived[CLIENT].options.reconnect).toBe(secondReconnect);
    expect(base[CLIENT].options).toEqual({});
  });

  test("does not perform I/O or listen for abort while deriving", () => {
    const handle = vi.fn(async () => json({ ok: true }));
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, "addEventListener");
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );

    const derived = client({ abort: signal })({ protocols: ["chat.v1"] })();

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

    const [error, data] = await read(client({ abort: controller.signal }));

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
    const pendingFirst = read(client({ abort: first.signal }));
    const pendingSecond = read(client({ abort: second.signal }));

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
      abort: firstSignal,
      beforeConnect: () => undefined,
      heartbeat: { intervalMs: 1_000 },
      onDownloadProgress,
      onUploadProgress: () => undefined,
      protocols: ["chat.v1"],
      reconnect: { attempts: 1 },
    } as const;
    for (const key of [
      "abort",
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
      "abort",
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
    const patch: RequestOptions = { abort: firstSignal };
    const derived = base(patch);

    patch.abort = secondSignal;
    expect(derived[CLIENT].options).toEqual({ abort: firstSignal });
    delete patch.abort;
    expect(derived[CLIENT].options).toEqual({ abort: firstSignal });
    patch.onDownloadProgress = onDownloadProgress;
    expect(derived[CLIENT].options).toEqual({ abort: firstSignal });
    expect(derived[CLIENT].options.onDownloadProgress).toBeUndefined();
  });

  test("keeps the parent and other derived clients fixed when the patch changes", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const firstSignal = new AbortController().signal;
    const secondSignal = new AbortController().signal;
    const onDownloadProgress = () => undefined;
    const patch: RequestOptions = { abort: firstSignal };
    const parent = base(patch);
    const child = parent();
    const childFromUndefined = parent(undefined);
    const sibling = base({ abort: secondSignal });

    patch.abort = secondSignal;
    delete patch.abort;
    patch.onDownloadProgress = onDownloadProgress;

    expect(base[CLIENT].options).toEqual({});
    expect(parent[CLIENT].options).toEqual({ abort: firstSignal });
    expect(child[CLIENT].options).toEqual({ abort: firstSignal });
    expect(childFromUndefined[CLIENT].options).toEqual({ abort: firstSignal });
    expect(sibling[CLIENT].options).toEqual({ abort: secondSignal });
    expect(child[CLIENT].options).not.toBe(parent[CLIENT].options);
    expect(child[CLIENT].options).not.toBe(patch);
    expect(child).not.toBe(parent);
    expect(childFromUndefined).not.toBe(parent);
    expect(child[CLIENT].config).toBe(parent[CLIENT].config);
  });

  test("stores options separately from the parent state and the patch object", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const signal = new AbortController().signal;
    const patch: RequestOptions = { abort: signal };
    const derived = base(patch);
    const first = derived[CLIENT].options;
    const second = derived[CLIENT].options;

    expect(first).not.toBe(base[CLIENT].options);
    expect(first).not.toBe(patch);
    expect(second).toBe(first);
    expect(second).toEqual({ abort: signal });
  });

  test("throws from client(patch) when a patch getter throws and leaves the parent usable", async () => {
    const handle = vi.fn(async () => json({ ok: true }));
    const parent = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );
    const boom = new Error("abort getter failed");
    const patch = Object.defineProperty({} as RequestOptions, "abort", {
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
    const timed = read(client({ abort: AbortSignal.timeout(20) }));
    const aborted = read(client({ abort: manual.signal }));
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
    const timed = stream(client({ abort: AbortSignal.timeout(20) }));
    const aborted = stream(client({ abort: manual.signal }));
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
    const timed = socket(client({ abort: AbortSignal.timeout(20) }));
    const aborted = socket(client({ abort: manual.signal }));
    manual.abort();

    const [timeoutError, timeoutSession] = await timed;
    const [abortError, abortSession] = await aborted;
    expect(timeoutError?.code).toBe("NET_TIMEOUT");
    expect(abortError?.code).toBe("NET_ABORTED");
    expect(timeoutSession).toBeUndefined();
    expect(abortSession).toBeUndefined();
  });
});
