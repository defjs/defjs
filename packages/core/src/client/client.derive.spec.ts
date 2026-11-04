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
    expect(base[CLIENT].options).toBeUndefined();
    expect(first[CLIENT].options).toBeUndefined();
    expect(first[CLIENT].config).toBe(base[CLIENT].config);
  });

  test("calling a derived client value throws a TypeError", () => {
    const derived = createClient(withEndpoint("https://example.test"))();

    expect(() => {
      // @ts-expect-error a derived client value is not callable
      derived();
    }).toThrow(TypeError);
  });

  test("client() and client(undefined) store no request options", () => {
    const base = createClient(withEndpoint("https://example.test"));

    expect(base()[CLIENT].options).toBeUndefined();
    expect(base(undefined)[CLIENT].options).toBeUndefined();
  });

  test("client({}) keeps an empty options snapshot", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const empty = {};
    const derived = base(empty);

    expect(derived[CLIENT].options).toEqual({
      beforeConnect: undefined,
      heartbeat: undefined,
      onDownloadProgress: undefined,
      onUploadProgress: undefined,
      protocols: undefined,
      reconnect: undefined,
      signal: undefined,
    });
    expect(derived[CLIENT].options).not.toBe(empty);
    expect(base[CLIENT].options).toBeUndefined();
  });

  test("assigns each request field onto a new options object", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const signal = new AbortController().signal;
    const onUploadProgress = () => undefined;
    const onDownloadProgress = () => undefined;
    const beforeConnect = () => undefined;
    const protocols = ["chat.v1"];
    const heartbeat = { intervalMs: 1_000, message: () => "ping" };
    const reconnect = { attempts: 1, delayMs: 10 };
    const options = {
      signal,
      onUploadProgress,
      onDownloadProgress,
      beforeConnect,
      protocols,
      heartbeat,
      reconnect,
    } satisfies RequestOptions;

    const derived = base(options);
    const stored = derived[CLIENT].options;
    if (!stored) throw new Error("Expected captured options");

    expect(stored).not.toBe(options);
    expect(stored.signal).toBe(signal);
    expect(stored.onUploadProgress).toBe(onUploadProgress);
    expect(stored.onDownloadProgress).toBe(onDownloadProgress);
    expect(stored.beforeConnect).toBe(beforeConnect);
    expect(stored.protocols).toEqual(["chat.v1"]);
    expect(stored.protocols).not.toBe(protocols);
    expect(stored.heartbeat).toEqual({
      intervalMs: 1_000,
      isAck: undefined,
      message: heartbeat.message,
      timeoutMs: undefined,
    });
    expect(stored.heartbeat).not.toBe(heartbeat);
    expect(stored.heartbeat?.message).toBe(heartbeat.message);
    expect(stored.reconnect).toEqual({
      attempts: 1,
      delayMs: 10,
      factor: undefined,
      jitter: undefined,
      maxDelayMs: undefined,
      shouldReconnect: undefined,
    });
    expect(stored.reconnect).not.toBe(reconnect);
  });

  test("keeps nested heartbeat, protocols, and reconnect independent of later edits", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const heartbeat = { intervalMs: 1_000 };
    const protocols = ["chat.v1"];
    const reconnect = { attempts: 1, delayMs: 10 };
    const derived = base({ heartbeat, protocols, reconnect });
    const stored = derived[CLIENT].options;
    if (!stored) throw new Error("Expected captured options");

    heartbeat.intervalMs = 2_000;
    protocols.push("chat.v2");
    protocols[0] = "changed";
    reconnect.attempts = 5;

    expect(stored.heartbeat?.intervalMs).toBe(1_000);
    expect(stored.protocols).toEqual(["chat.v1"]);
    expect(stored.reconnect?.attempts).toBe(1);
  });

  test("does not perform I/O or listen for abort while deriving", () => {
    const handle = vi.fn(() => Promise.resolve(json({ ok: true })));
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
    const handle = vi.fn(() => Promise.resolve(json({ ok: true })));
    const controller = new AbortController();
    controller.abort();
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
      withInterceptors(
        // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
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

  test("reads option getters while deriving and keeps the values", () => {
    const base = createClient(withEndpoint("https://example.test"));
    const signal = new AbortController().signal;
    const heartbeat = { intervalMs: 1_000 };
    let signalReads = 0;
    let heartbeatReads = 0;
    const options: RequestOptions = {
      get signal() {
        signalReads += 1;
        return signal;
      },
      get heartbeat() {
        heartbeatReads += 1;
        return heartbeat;
      },
    };

    const derived = base(options);
    const stored = derived[CLIENT].options;
    if (!stored) throw new Error("Expected captured options");

    expect(signalReads).toBe(1);
    expect(heartbeatReads).toBe(1);
    expect(stored.signal).toBe(signal);
    expect(stored.heartbeat).not.toBe(heartbeat);
    expect(stored.heartbeat?.intervalMs).toBe(1_000);
    expect(signalReads).toBe(1);
    expect(heartbeatReads).toBe(1);
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
    expect(derived[CLIENT].options?.onDownloadProgress).toBeUndefined();
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

    expect(base[CLIENT].options).toBeUndefined();
    expect(first[CLIENT].options).toEqual({ signal: firstSignal });
    expect(sibling[CLIENT].options).toEqual({ signal: secondSignal });
    expect(first[CLIENT].options).not.toBe(patch);
    expect(first[CLIENT].config).toBe(base[CLIENT].config);
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
    const handle = vi.fn(() => Promise.resolve(json({ ok: true })));
    const parent = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );
    const boom = new Error("signal getter failed");
    const patch: RequestOptions = {
      get signal(): AbortSignal {
        throw boom;
      },
    };
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
      withHTTPHandle(() => Promise.resolve(json({ ok: true }))),
      withInterceptors(
        createHttpInterceptor((request) => {
          seen.push(request.method);
          return Promise.resolve(
            makeResponse({
              body: { ok: true },
              headers: new Headers({ "content-type": "application/json" }),
              status: 200,
            }),
          );
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
      withSSEHandle(() => {
        return Promise.resolve(
          new Response("data: hi\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }),
    );
    const stream = defineEventStream({
      path: "/events",
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
          static readonly OPEN = 1;
          readonly bufferedAmount = 0;
          readonly extensions = "";
          readonly protocol = "";
          readonly readyState = 0;
          readonly url: string;
          constructor(url: string) {
            super();
            this.url = url;
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
        },
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
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the value under test is thrown or rejected unchanged
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
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the value under test is thrown or rejected unchanged
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const stream = defineEventStream({
      path: "/events",
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
          static readonly OPEN = 1;
          readonly bufferedAmount = 0;
          readonly extensions = "";
          readonly protocol = "";
          readonly readyState = 0;
          readonly url = "";
          constructor(_url: string) {
            super();
          }
          close() {
            return undefined;
          }
          send() {
            return undefined;
          }
        },
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
