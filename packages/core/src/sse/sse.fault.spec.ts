import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withInterceptors,
  withSSEHandle,
  withRetry,
} from "../client";
import {
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  __resetStreamingRequestBodySupportForTests,
} from "../http/transport/fetch_init";
import { simulateUnsupportedStreaming } from "../../test/streaming-support";
import type { Client } from "../client";
import { createSSEInterceptor } from "../interceptor";
import { struct } from "../struct";
import { defineEventStream } from "./index";

/**
 * Locks SSE onto the one fault-code namespace shared with HTTP.
 *
 * The two `EXT_*` splits live in `transport/event_stream.advanced.spec.ts`: the retry hook and
 * `transformMessage` are `fetchEventStream` options, not client-level surface.
 *
 * SSE used to carry a parallel `EventStreamErrorCode` set with no `kind` and no mapping to the
 * request error model, and it reported two different kinds of caller code — the lifecycle hooks
 * and the message transform — under a single `EXT_OBSERVER_FAILED`.
 */

const SSE_HEADERS = { "content-type": "text/event-stream" };

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function clientReturning(
  response: () => Response | Promise<Response>,
  ...options: Parameters<typeof createClient>
): Client {
  return createClient(
    withEndpoint("https://api.example.test"),
    withSSEHandle(() => Promise.resolve(response())),
    ...options,
  );
}

const useStream = defineEventStream({
  events: { message: struct.string() },
  path: "/events",
});

describe("sse startup faults", () => {
  test("should accept an unbounded positive infinite retry cap", async () => {
    const client = clientReturning(
      () =>
        Promise.resolve(new Response("data: ok\n\n", { headers: SSE_HEADERS })),
      withRetry({ maxDelayMs: Infinity }),
    );

    const [fault, stream] = await useStream(client);

    expect(fault).toBeNull();
    if (!stream) throw new Error("Expected an event stream");
    expect(await Array.fromAsync(stream)).toEqual([
      { event: "message", data: "ok", id: undefined },
    ]);
    expect(await stream.closed).toMatchObject({ kind: "eof" });
  });

  test("should use the retry values resolved before the interceptor runs", async () => {
    const reads = { delayMs: 0, maxDelayMs: 0 };
    const client = clientReturning(
      () =>
        Promise.resolve(new Response("data: ok\n\n", { headers: SSE_HEADERS })),
      (config) => {
        // Bypass public option capture to exercise the policy that execution resolves.
        config.retry = {
          get delayMs() {
            reads.delayMs += 1;
            return reads.delayMs === 1 ? 0 : NaN;
          },
          get maxDelayMs() {
            reads.maxDelayMs += 1;
            return reads.maxDelayMs === 1 ? 1000 : NaN;
          },
        };
      },
      withInterceptors(
        createSSEInterceptor((request, next) => {
          expect(reads).toEqual({ delayMs: 1, maxDelayMs: 1 });
          return next(request);
        }),
      ),
    );

    expect(reads).toEqual({ delayMs: 0, maxDelayMs: 0 });
    const [fault, stream] = await useStream(client);

    expect(fault).toBeNull();
    if (!stream) throw new Error("Expected an event stream");
    expect(await Array.fromAsync(stream)).toEqual([
      { event: "message", data: "ok", id: undefined },
    ]);
    expect(reads).toEqual({ delayMs: 1, maxDelayMs: 1 });
    expect(await stream.closed).toMatchObject({ kind: "eof" });
  });

  test("should preserve the disabled retry snapshot if an interceptor adds options", async () => {
    const client = clientReturning(
      () =>
        Promise.resolve(new Response("data: ok\n\n", { headers: SSE_HEADERS })),
      (config) => {
        config.interceptors = [
          createSSEInterceptor((request, next) => {
            config.retry = { delayMs: NaN };
            return next(request);
          }),
        ];
      },
    );

    const [fault, stream] = await useStream(client);

    expect(fault).toBeNull();
    if (!stream) throw new Error("Expected an event stream");
    expect(await Array.fromAsync(stream)).toEqual([
      { event: "message", data: "ok", id: undefined },
    ]);
    expect(await stream.closed).toMatchObject({ kind: "eof" });
  });

  test("should report a non-2xx handshake as HTTP_STATUS with the declared error body", async () => {
    const useDeclared = defineEventStream({
      error: struct.object({ reason: struct.string() }),
      events: { message: struct.string() },
      path: "/events",
    });
    const client = clientReturning(() =>
      Promise.resolve(
        new Response('{"reason":"forbidden"}', {
          headers: { "content-type": "application/json" },
          status: 403,
        }),
      ),
    );

    const [fault] = await useDeclared(client);

    expect(fault?.code).toBe("HTTP_STATUS");
    if (fault?.code !== "HTTP_STATUS")
      throw new Error("Expected an http status fault");
    expect(fault.status).toBe(403);
    expect(fault.data).toEqual({ reason: "forbidden" });
  });

  test("should report a wrong handshake media type as RES_MEDIA_TYPE_INVALID", async () => {
    const client = clientReturning(() =>
      Promise.resolve(
        new Response("not a stream", {
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    const [fault] = await useStream(client);

    expect(fault?.code).toBe("RES_MEDIA_TYPE_INVALID");
  });

  test.each([200, 204, 205])(
    "should end a %i event-stream handshake without a body as an empty stream",
    async (status) => {
      const client = clientReturning(() =>
        Promise.resolve(new Response(null, { status, headers: SSE_HEADERS })),
      );

      const [fault, stream] = await useStream(client);

      expect(fault).toBeNull();
      const events: unknown[] = [];
      for await (const event of stream ?? []) events.push(event);
      expect(events).toEqual([]);
      await expect(stream?.closed).resolves.toEqual({ kind: "eof" });
    },
  );

  test("should still reject a 204 handshake without a body that is not an event stream", async () => {
    const client = clientReturning(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );

    const [fault] = await useStream(client);

    expect(fault?.code).toBe("RES_MEDIA_TYPE_INVALID");
  });

  test("should report an unreachable transport as NET_UNREACHABLE", async () => {
    const cause = new TypeError("fetch failed");
    const client = clientReturning(() => Promise.reject(cause));

    const [fault] = await useStream(client);

    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(fault?.cause).toBe(cause);
  });

  test("should report a transport that rejects with a string as NET_UNREACHABLE", async () => {
    const client = clientReturning(() =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the transport under test rejects with a string primitive
      Promise.reject("offline"),
    );

    const [fault] = await useStream(client);

    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(fault?.cause).toBe("offline");
  });

  test("should report an interceptor that throws a string as EXT_INTERCEPTOR_FAILED", async () => {
    const client = clientReturning(
      () =>
        Promise.resolve(
          new Response(streamOf("data: hi\n\n"), { headers: SSE_HEADERS }),
        ),
      withInterceptors(
        createSSEInterceptor(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- the interceptor under test throws a string primitive
          throw "interceptor exploded";
        }),
      ),
    );

    const [fault] = await useStream(client);

    expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(fault?.cause).toBe("interceptor exploded");
  });

  test("should report an interceptor throw as EXT_INTERCEPTOR_FAILED", async () => {
    const cause = new Error("interceptor exploded");
    const client = clientReturning(
      () =>
        Promise.resolve(
          new Response(streamOf("data: hi\n\n"), { headers: SSE_HEADERS }),
        ),
      withInterceptors(createSSEInterceptor(() => Promise.reject(cause))),
    );

    const [fault] = await useStream(client);

    expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(fault?.cause).toBe(cause);
  });
});

describe("sse runtime faults", () => {
  test("should report a buffer limit as CAP_BUFFER_EXCEEDED", async () => {
    const useTiny = defineEventStream({
      events: { message: struct.string() },
      maxBufferSize: 4,
      path: "/events",
    });
    const client = clientReturning(() =>
      Promise.resolve(
        new Response(streamOf(`data: ${"x".repeat(64)}\n\n`), {
          headers: SSE_HEADERS,
        }),
      ),
    );

    const [fault, stream] = await useTiny(client);

    expect(fault).toBeNull();
    if (fault) throw new Error("Expected the stream to open");
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow();
    await expect(stream.closed).resolves.toMatchObject({
      code: "CAP_BUFFER_EXCEEDED",
      kind: "error",
    });
  });

  test("should deliver a burst larger than the queue size", async () => {
    const burst = 3000;
    const client = clientReturning(() =>
      Promise.resolve(
        new Response(
          streamOf(
            Array.from({ length: burst }, (_, i) => `data: ${i}\n\n`).join(""),
          ),
          { headers: SSE_HEADERS },
        ),
      ),
    );

    const [fault, stream] = await useStream(client);

    expect(fault).toBeNull();
    if (fault) throw new Error("Expected the stream to open");
    let received = 0;
    for await (const event of stream) {
      expect(event.data).toBe(String(received));
      received += 1;
    }
    expect(received).toBe(burst);
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test("should deliver the events received before a network error", async () => {
    let sent = false;
    const reset = new TypeError("connection reset");
    const client = clientReturning(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                if (sent) {
                  controller.error(reset);
                  return;
                }
                sent = true;
                controller.enqueue(
                  new TextEncoder().encode(
                    "id: 1\ndata: a\n\nid: 2\ndata: b\n\nid: 3\ndata: c\n\n",
                  ),
                );
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: SSE_HEADERS },
        ),
      ),
    );

    const [fault, stream] = await useStream(client);

    expect(fault).toBeNull();
    if (fault) throw new Error("Expected the stream to open");
    await expect(stream.closed).resolves.toMatchObject({
      code: "NET_UNREACHABLE",
      kind: "error",
    });
    const received: string[] = [];
    const rejection = await (async () => {
      try {
        for await (const event of stream) {
          received.push(event.data);
        }
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(received).toEqual(["a", "b", "c"]);
    expect(rejection).toBeDefined();
  });

  test("should report a clean end of stream with kind eof and no code", async () => {
    const client = clientReturning(() =>
      Promise.resolve(
        new Response(streamOf("data: hi\n\n"), { headers: SSE_HEADERS }),
      ),
    );

    const [fault, stream] = await useStream(client);

    expect(fault).toBeNull();
    if (fault) throw new Error("Expected the stream to open");
    for await (const event of stream) {
      expect(event.data).toBe("hi");
    }
    const closed = await stream.closed;
    expect(closed.kind).toBe("eof");
    expect(closed).not.toHaveProperty("code");
  });

  test("should keep the runtime idle-timeout error chain on a NET_UNREACHABLE fault", async () => {
    // Mirrors what Node's built-in fetch (undici) does to a body that stays silent past its
    // `bodyTimeout`; the guides document this exact `cause` chain.
    const bodyTimeout = Object.assign(new Error("Body Timeout Error"), {
      code: "UND_ERR_BODY_TIMEOUT",
      name: "BodyTimeoutError",
    });
    const terminated = new TypeError("terminated", { cause: bodyTimeout });
    const client = clientReturning(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: first\n\n"));
            },
            pull(controller) {
              controller.error(terminated);
            },
          }),
          { headers: SSE_HEADERS },
        ),
    );

    const [fault, stream] = await useStream(client);

    expect(fault).toBeNull();
    if (fault) throw new Error("Expected the stream to open");
    // The iterator rejects with the runtime's own error; `closed` carries the fault code.
    await expect(
      (async () => {
        for await (const event of stream) void event;
      })(),
    ).rejects.toBe(terminated);
    await expect(stream.closed).resolves.toMatchObject({
      cause: terminated,
      code: "NET_UNREACHABLE",
      kind: "error",
    });
  });

  test("should report a handle that rejects with a coded error as a network failure", async () => {
    const rejection = Object.assign(new Error("not a fault"), {
      code: "REQ_BUILD_FAILED",
    });
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withSSEHandle(() => Promise.reject(rejection)),
    );

    const [fault, stream] = await useStream(client);

    expect(stream).toBeUndefined();
    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(fault?.cause).toBe(rejection);
  });
});

describe("unsupported streaming request body", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetStreamingRequestBodySupportForTests();
  });

  test("should report ENV_UNSUPPORTED for a ReadableStream body before calling the handle", async () => {
    simulateUnsupportedStreaming();
    const body = byteStream();
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const client = createClient(
      withEndpoint("https://example.com"),
      withSSEHandle(handle),
    );
    const useStream = defineEventStream({
      builder: () => ({ body }),
      events: { message: struct.string() },
      method: "POST",
      path: "/events",
    });

    const [error, events, open] = await useStream(client);

    expect(error?.code).toBe("ENV_UNSUPPORTED");
    expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
    expect(error?.cause instanceof Error ? error.cause.message : "").toBe(
      "ERR_STREAMING_REQUEST_UNSUPPORTED",
    );
    expect(events).toBeUndefined();
    expect(open).toBeUndefined();
    expect(handle).toHaveBeenCalledTimes(0);
    expect(body.locked).toBe(false);
  });

  test("should report ENV_UNSUPPORTED without consulting reconnect", async () => {
    simulateUnsupportedStreaming();
    const body = byteStream();
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const shouldRetry = vi.fn(() => false);
    const client = createClient(
      withEndpoint("https://example.com"),
      withSSEHandle(handle),
      withRetry({ delayMs: 60_000, shouldRetry }),
    );
    const useStream = defineEventStream({
      builder: () => ({ body }),
      events: { message: struct.string() },
      method: "POST",
      path: "/events",
    });

    const [error, events, open] = await useStream(client);

    expect(error?.code).toBe("ENV_UNSUPPORTED");
    expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
    expect(events).toBeUndefined();
    expect(open).toBeUndefined();
    expect(handle).toHaveBeenCalledTimes(0);
    expect(shouldRetry).toHaveBeenCalledTimes(0);
    expect(body.locked).toBe(false);
  });
});

test("should return REQ_BUILD_FAILED when the JSON body is an async iterable object", async () => {
  const handle = vi.fn(() =>
    Promise.resolve(
      new Response(streamOf("data: a\n\n"), { headers: SSE_HEADERS }),
    ),
  );
  const client = createClient(
    withEndpoint("https://example.com"),
    withSSEHandle(handle),
  );
  const useStream = defineEventStream({
    builder: () => ({
      body: {
        async *[Symbol.asyncIterator]() {
          yield await Promise.resolve(new TextEncoder().encode("chunk"));
        },
      },
    }),
    events: { message: struct.string() },
    method: "POST",
    path: "/events",
  });

  const [fault, events, open] = await useStream(client);

  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(events).toBeUndefined();
  expect(open).toBeUndefined();
  expect(fault?.cause).toBeInstanceOf(TypeError);
  expect(fault?.cause instanceof TypeError ? fault.cause.message : "").toMatch(
    /iterable object/,
  );
  expect(handle).toHaveBeenCalledTimes(0);
});

describe("ReadableStream body and reconnect", () => {
  test("should reconnect when an interceptor replaces a stream body with a blob", async () => {
    const failure = new TypeError("network down");
    const shouldRetry = vi.fn(() => true);
    let attempt = 0;
    const handle = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(failure);
      }
      return Promise.resolve(
        new Response(streamOf("data: hi\n\n"), { headers: SSE_HEADERS }),
      );
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withSSEHandle(handle),
      withRetry({ maxRetries: 2, delayMs: 0, shouldRetry }),
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          return await next({ ...request, body: new Blob(["x"]) });
        }),
      ),
    );
    const useStream = defineEventStream({
      builder: () => ({ body: byteStream() }),
      events: { message: struct.string() },
      method: "POST",
      path: "/events",
    });

    const [fault, stream] = await useStream(client);

    expect(fault).toBeNull();
    if (!stream) {
      throw new Error("Expected the stream to open");
    }
    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.data);
    }
    expect(events).toEqual(["hi"]);
    expect(handle).toHaveBeenCalledTimes(2);
  });
});

function byteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
      controller.close();
    },
  });
}
