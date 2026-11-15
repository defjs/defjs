import { describe, expect, test, vi } from "vitest";
import { createFakeWebSocket, refusing } from "../../test/fake_web_socket";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
  withSSEHandle,
  withWebSocketHandle,
} from "../client";
import { defineRequest } from "../http";
import { defineEventStream } from "../sse";
import type { EventStreamHandle } from "../sse";
import { struct } from "../struct";
import { defineWebSocket } from "../web_socket";
import type { WebSocketSessionLike } from "./interceptor";
import type { OperationCall, OperationResult } from "./interceptor";
import {
  createHttpInterceptor,
  createOperationInterceptor,
} from "./interceptor";

const getOrder = defineRequest({
  method: "GET",
  meta: { operation: "orders.get" },
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number() }),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** An operation interceptor that records each call and the tuple it resolved with. */
function recorder() {
  const calls: OperationCall[] = [];
  const results: OperationResult[] = [];
  const interceptor = createOperationInterceptor(async (call, next) => {
    calls.push(call);
    const result = await next();
    results.push(result);
    return result;
  });
  return { calls, results, interceptor };
}

describe("operation interceptor", () => {
  test("is tagged with kind operation", () => {
    const fn = <T extends OperationResult>(
      _call: OperationCall,
      next: () => Promise<T>,
    ) => next();
    expect(createOperationInterceptor(fn)).toEqual({
      kind: "operation",
      fn,
    });
  });

  test("describes the call by its definition and sees the decoded tuple", async () => {
    const { calls, results, interceptor } = recorder();
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() => Promise.resolve(json(200, { id: 7 }))),
      withInterceptors(interceptor),
    );

    const result = await getOrder(client, { id: 7 });

    expect(calls).toEqual([
      {
        transport: "http",
        method: "GET",
        path: "/orders/:id",
        meta: { operation: "orders.get" },
      },
    ]);
    expect(results).toEqual([result]);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ id: 7 });
  });

  test("reuses one call record for every call of a definition", async () => {
    const { calls, interceptor } = recorder();
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() => Promise.resolve(json(200, { id: 1 }))),
      withInterceptors(interceptor),
    );

    await getOrder(client, { id: 1 });
    await getOrder(client, { id: 2 });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
  });

  test("sees an input that fails validation, which no transport interceptor sees", async () => {
    const { results, interceptor } = recorder();
    const transport = vi.fn<Parameters<typeof createHttpInterceptor>[0]>(
      (req, next) => next(req),
    );
    const handle = vi.fn(() => Promise.resolve(json(200, { id: 1 })));
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(handle),
      withInterceptors(interceptor, createHttpInterceptor(transport)),
    );

    const [err] = await getOrder(client, { id: Number.NaN });

    expect(err?.code).toBe("REQ_INPUT_INVALID");
    expect(results[0]?.[0]).toBe(err);
    expect(transport).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  test("sees a 2xx body that does not match the output struct", async () => {
    const { results, interceptor } = recorder();
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() => Promise.resolve(json(200, { id: "seven" }))),
      withInterceptors(interceptor),
    );

    const [err] = await getOrder(client, { id: 7 });

    expect(err?.code).toBe("RES_STRUCT_MISMATCH");
    expect(results[0]?.[0]).toBe(err);
  });

  test("wraps every attempt of a retried call once", async () => {
    const { calls, results, interceptor } = recorder();
    const handle = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValue(json(200, { id: 3 }));
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(handle),
      withRetry({ delayMs: 0, budget: false }),
      withInterceptors(interceptor),
    );

    const [err] = await getOrder(client, { id: 3 });

    expect(err).toBeNull();
    expect(handle).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(1);
  });

  test("runs in registration order, outside the transport interceptors", async () => {
    const order: string[] = [];
    const operation = (name: string) =>
      createOperationInterceptor(async (_call, next) => {
        order.push(`${name}:before`);
        const result = await next();
        order.push(`${name}:after`);
        return result;
      });
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() => Promise.resolve(json(200, { id: 1 }))),
      withInterceptors(
        createHttpInterceptor(async (req, next) => {
          order.push("http:before");
          const response = await next(req);
          order.push("http:after");
          return response;
        }),
        operation("outer"),
        operation("inner"),
      ),
    );

    await getOrder(client, { id: 1 });

    expect(order).toEqual([
      "outer:before",
      "inner:before",
      "http:before",
      "http:after",
      "inner:after",
      "outer:after",
    ]);
  });

  test("runs the call once when next() is called again", async () => {
    const handle = vi.fn(() => Promise.resolve(json(200, { id: 1 })));
    const seen: Array<Promise<OperationResult>> = [];
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(handle),
      withInterceptors(
        createOperationInterceptor(async (_call, next) => {
          const first = next();
          const second = next();
          seen.push(first, second);
          await second;
          return first;
        }),
      ),
    );

    const [err] = await getOrder(client, { id: 1 });

    expect(err).toBeNull();
    expect(seen[0]).toBe(seen[1]);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  test("a throw before next() resolves EXT_INTERCEPTOR_FAILED and runs nothing", async () => {
    const thrown = new Error("observer broke");
    const handle = vi.fn(() => Promise.resolve(json(200, { id: 1 })));
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(handle),
      withInterceptors(
        createOperationInterceptor(() => {
          throw thrown;
        }),
      ),
    );

    const [err, data, response] = await getOrder(client, { id: 1 });

    expect(err?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(err?.cause).toBe(thrown);
    expect(data).toBeUndefined();
    expect(response).toBeUndefined();
    expect(handle).not.toHaveBeenCalled();
  });

  test("a rejection after an HTTP call resolves EXT_INTERCEPTOR_FAILED", async () => {
    const thrown = new Error("observer broke");
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() => Promise.resolve(json(200, { id: 1 }))),
      withInterceptors(
        createOperationInterceptor(async (_call, next) => {
          await next();
          throw thrown;
        }),
      ),
    );

    const [err] = await getOrder(client, { id: 1 });

    expect(err?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(err?.cause).toBe(thrown);
  });

  test("describes an SSE call and closes its open stream when the interceptor rejects", async () => {
    const thrown = new Error("observer broke");
    const calls: OperationCall[] = [];
    let opened: EventStreamHandle<unknown> | undefined;
    const useEvents = defineEventStream({
      meta: { feed: "orders" },
      path: "/events",
      events: { message: struct.string() },
    });
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withSSEHandle(() =>
        Promise.resolve(
          new Response(new ReadableStream<Uint8Array>(), {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
      withInterceptors(
        createOperationInterceptor(async (call, next) => {
          calls.push(call);
          const result = await next();
          const stream: unknown = result[1];
          if (isEventStream(stream)) opened = stream;
          throw thrown;
        }),
      ),
    );

    const [err, stream] = await useEvents(client);

    expect(calls).toEqual([
      {
        transport: "sse",
        method: "GET",
        path: "/events",
        meta: { feed: "orders" },
      },
    ]);
    expect(err?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(stream).toBeUndefined();
    expect(opened).toBeDefined();
    await expect(opened?.closed).resolves.toMatchObject({
      kind: "aborted",
      cause: thrown,
    });
  });

  test("describes a WebSocket call and closes its open session when the interceptor rejects", async () => {
    const fake = createFakeWebSocket();
    const calls: OperationCall[] = [];
    let opened: WebSocketSessionLike | undefined;
    const useSocket = defineWebSocket({
      path: "/socket",
      incoming: struct.string(),
    });
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withWebSocketHandle(fake.Socket),
      withInterceptors(
        createOperationInterceptor(async (call, next) => {
          calls.push(call);
          const result = await next();
          const session: unknown = result[1];
          if (isSession(session)) opened = session;
          throw new Error("observer broke");
        }),
      ),
    );

    const [err, session] = await useSocket(client);

    expect(calls).toEqual([
      {
        transport: "websocket",
        method: "GET",
        path: "/socket",
        meta: undefined,
      },
    ]);
    expect(err?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(session).toBeUndefined();
    await expect(opened?.closed).resolves.toMatchObject({ kind: "closed" });
    expect(fake.last().closeCalls).toHaveLength(1);
  });

  test("an inner interceptor that throws resolves the outer next() with EXT_INTERCEPTOR_FAILED", async () => {
    const thrown = new Error("inner observer broke");
    const seen: OperationResult[] = [];
    let opened: EventStreamHandle<unknown> | undefined;
    const useEvents = defineEventStream({
      path: "/events",
      events: { message: struct.string() },
    });
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withSSEHandle(() =>
        Promise.resolve(
          new Response(new ReadableStream<Uint8Array>(), {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
      withInterceptors(
        createOperationInterceptor(async (_call, next) => {
          const result = await next();
          seen.push(result);
          return result;
        }),
        createOperationInterceptor(async (_call, next) => {
          const result = await next();
          const stream: unknown = result[1];
          if (isEventStream(stream)) opened = stream;
          throw thrown;
        }),
      ),
    );

    const [err] = await useEvents(client);

    expect(err?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(err?.cause).toBe(thrown);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe(err);
    await expect(opened?.closed).resolves.toMatchObject({
      kind: "aborted",
      cause: thrown,
    });
  });

  test("a rejection after a failed SSE or WebSocket call has nothing to close", async () => {
    const thrown = new Error("observer broke");
    const useEvents = defineEventStream({
      path: "/events",
      events: { message: struct.string() },
    });
    const useSocket = defineWebSocket({
      path: "/socket",
      incoming: struct.string(),
    });
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withSSEHandle(() => Promise.resolve(new Response(null, { status: 500 }))),
      withWebSocketHandle(refusing(createFakeWebSocket().Socket)),
      withInterceptors(
        createOperationInterceptor(async (_call, next) => {
          const [err] = await next();
          expect(err).not.toBeNull();
          throw thrown;
        }),
      ),
    );

    const [streamErr] = await useEvents(client);
    const [socketErr] = await useSocket(client);

    expect(streamErr?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(streamErr?.cause).toBe(thrown);
    expect(socketErr?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(socketErr?.cause).toBe(thrown);
  });
});

function isEventStream(value: unknown): value is EventStreamHandle<unknown> {
  return typeof value === "object" && value !== null && "open" in value;
}

function isSession(value: unknown): value is WebSocketSessionLike {
  return typeof value === "object" && value !== null && "receive" in value;
}
