import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
} from "@defjs/core";
import { diag, SpanStatusCode } from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { afterEach, describe, expect, inject, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { withOpenTelemetryServer } from "./src/option";
import type { MockSpan } from "./src/test-utils";
import { createMockLogger, createMockTracer } from "./src/test-utils";

interface EchoHeadersResponse {
  headers: { [key: string]: string };
}

function createPropagator() {
  return new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
}

function isEchoHeadersResponse(value: unknown): value is EchoHeadersResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const headers: unknown = Reflect.get(value, "headers");
  if (typeof headers !== "object" || headers === null) {
    return false;
  }

  return Object.values(headers).every((item) => typeof item === "string");
}

function onlySpan(spans: readonly MockSpan[]): MockSpan {
  expect(spans).toHaveLength(1);

  const span = spans[0];
  if (!span) {
    throw new Error("Expected one span");
  }

  return span;
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const TRACE_PARENT_REGEX = /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/;

describe("client.execute diagnostic boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([false, true])(
    "preserves the network fault when logger throws=%s",
    async (throws) => {
      const { logger, records } = createMockLogger();
      if (throws)
        logger.emit.mockImplementation(() => {
          throw new Error("logger failed");
        });
      vi.spyOn(diag, "error").mockImplementation(() => undefined);
      const cause = new TypeError("local transport unavailable");
      const client = createClient(
        withEndpoint("https://example.invalid"),
        withHTTPHandle(async () => {
          throw cause;
        }),
        withOpenTelemetryServer({ logger }),
      );
      const request = defineRequest({ method: "GET", path: "/inventory" });
      const [fault, data, response] = await client.execute(request());
      expect(fault).toMatchObject({ code: "NET_UNREACHABLE", cause });
      expect(fault?.cause).toBe(cause);
      expect(data).toBeUndefined();
      expect(response).toBeUndefined();
      expect(logger.emit).toHaveBeenCalledTimes(1);
      if (!throws)
        expect(records[0]).toMatchObject({
          severityNumber: 13,
          eventName: "http.client.request.exception",
        });
    },
  );

  test("does not log input validation faults that never reach an interceptor", async () => {
    const { logger, records } = createMockLogger();
    const handle = vi.fn(async () => new Response());
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(handle),
      withOpenTelemetryServer({ logger }),
    );
    const request = defineRequest({
      method: "POST",
      path: "/inventory",
      input: struct.object({ count: struct.number() }),
      builder: (input) => ({ body: input }),
    });
    const [fault] = await client.execute(
      request({ count: "invalid" } as never),
    );
    expect(fault?.code).toBe("REQ_INPUT_INVALID");
    expect(handle).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  test.each([
    { status: 500, body: "{}", code: "HTTP_STATUS", logCount: 0 },
    { status: 200, body: "{invalid", code: "RES_DECODE_FAILED", logCount: 1 },
    {
      status: 200,
      body: '{"count":"invalid"}',
      code: "RES_STRUCT_MISMATCH",
      logCount: 0,
    },
  ])(
    "only logs $code when the failure occurs inside the HTTP interceptor",
    async ({ status, body, code, logCount }) => {
      const { logger, records } = createMockLogger();
      const client = createClient(
        withEndpoint("https://example.invalid"),
        withHTTPHandle(
          async () =>
            new Response(body, {
              status,
              headers: { "content-type": "application/json" },
            }),
        ),
        withOpenTelemetryServer({ logger }),
      );
      const request = defineRequest({
        method: "GET",
        path: "/inventory",
        output: struct.object({ count: struct.number() }),
      });
      const [fault] = await client.execute(request());
      expect(fault?.code).toBe(code);
      expect(records).toHaveLength(logCount);
      if (logCount > 0) {
        expect(records[0]).toMatchObject({
          severityNumber: 13,
          attributes: { "exception.type": "BodyFailure" },
        });
      }
    },
  );

  test.each([
    {
      status: 500,
      body: '{"message":"down"}',
      contentType: "application/json",
      code: "HTTP_STATUS",
      logCount: 0,
    },
    {
      status: 500,
      body: '{"message":1}',
      contentType: "application/json",
      code: "RES_STRUCT_MISMATCH",
      logCount: 0,
    },
    {
      status: 500,
      body: "{invalid",
      contentType: "application/json",
      code: "RES_DECODE_FAILED",
      logCount: 1,
    },
    {
      status: 502,
      body: "<html></html>",
      contentType: "text/html",
      code: "RES_MEDIA_TYPE_INVALID",
      logCount: 1,
    },
    {
      status: 200,
      body: "<html></html>",
      contentType: "text/html",
      code: "RES_MEDIA_TYPE_INVALID",
      logCount: 1,
    },
    {
      status: 204,
      body: null,
      contentType: "application/json",
      code: "RES_DECODE_FAILED",
      logCount: 0,
    },
  ])(
    "declared bodies: $status $contentType yields $code with $logCount log(s)",
    async ({ status, body, contentType, code, logCount }) => {
      const { logger, records } = createMockLogger();
      const client = createClient(
        withEndpoint("https://example.invalid"),
        withHTTPHandle(
          async () =>
            new Response(body, {
              status,
              headers: { "content-type": contentType },
            }),
        ),
        withOpenTelemetryServer({ logger }),
      );
      const request = defineRequest({
        method: "GET",
        path: "/inventory",
        output: struct.object({ count: struct.number() }),
        error: struct.object({ message: struct.string() }),
      });
      const [fault] = await client.execute(request());
      expect(fault?.code).toBe(code);
      expect(records).toHaveLength(logCount);
      if (logCount > 0) {
        expect(records[0]).toMatchObject({
          eventName: "http.client.request.exception",
          severityNumber: 13,
          attributes: {
            "defjs.phase": "request",
            "exception.type": "BodyFailure",
          },
        });
      }
    },
  );

  test("SSE non-2xx handshake logs one connect failure before core converts it to HTTP_STATUS", async () => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withOpenTelemetryServer({ logger }),
    );
    const [fault] = await client.execute(
      defineEventStream({
        events: { message: struct.string() },
        maxBufferSize: 1024,
        maxQueueSize: 4,
        path: "/sse/500",
      })(),
    );
    expect(fault?.code).toBe("HTTP_STATUS");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventName: "defjs.client.sse.exception",
      severityNumber: 13,
      attributes: {
        "defjs.phase": "connect",
        "exception.type": "EventStreamFatalError",
      },
    });
  });

  test("SSE network failure logs one connect failure", async () => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withSSEHandle(async () => {
        throw new TypeError("local transport unavailable");
      }),
      withOpenTelemetryServer({ logger }),
    );
    const [fault] = await client.execute(
      defineEventStream({
        events: { message: struct.string() },
        maxBufferSize: 1024,
        maxQueueSize: 4,
        path: "/stream",
      })(),
    );
    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventName: "defjs.client.sse.exception",
      attributes: { "defjs.phase": "connect", "exception.type": "TypeError" },
    });
  });

  test("SSE caller abort during the handshake does not log", async () => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withSSEHandle(() => new Promise<Response>(() => undefined)),
      withOpenTelemetryServer({ logger }),
    );
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 10);
    const [fault] = await client.execute(
      defineEventStream({
        events: { message: struct.string() },
        maxBufferSize: 1024,
        maxQueueSize: 4,
        path: "/stream",
      })(),
      { abort: abort.signal },
    );
    expect(fault?.code).toBe("NET_ABORTED");
    expect(records).toEqual([]);
  });

  test("SSE end of stream does not log", async () => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withOpenTelemetryServer({ logger }),
    );
    const [fault, stream] = await client.execute(
      defineEventStream({
        events: { traceparent: struct.string() },
        maxBufferSize: 64 * 1024,
        maxQueueSize: 16,
        path: "/sse",
      })(),
    );
    expect(fault).toBeNull();
    for await (const event of stream ?? []) void event;
    await expect(stream?.closed).resolves.toMatchObject({ kind: "eof" });
    expect(records).toEqual([]);
  });

  test.each([
    { name: "refused handshake", path: "/ws/missing", wrongPort: false },
    { name: "unreachable host", path: "/ws", wrongPort: true },
  ])(
    "WebSocket $name logs one connect failure",
    async ({ path, wrongPort }) => {
      const { logger, records } = createMockLogger();
      const host = wrongPort
        ? `ws://127.0.0.1:${await closedPort()}`
        : inject("testServerHost").replace(/^http:/, "ws:");
      const client = createClient(
        withEndpoint(host),
        withOpenTelemetryServer({ logger }),
      );
      const [fault] = await client.execute(
        defineWebSocket({
          maxIncomingQueueSize: 4,
          incoming: struct.unknown(),
          path,
        })(),
      );
      expect(fault?.code).toBe("NET_UNREACHABLE");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        eventName: "defjs.client.websocket.exception",
        severityNumber: 13,
        attributes: {
          "defjs.phase": "connect",
          "exception.type": "DefjsFault",
        },
      });
    },
  );

  test("WebSocket caller abort after open does not log", async () => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint(inject("testServerHost").replace(/^http:/, "ws:")),
      withOpenTelemetryServer({ logger }),
    );
    const abort = new AbortController();
    const [fault, socket] = await client.execute(
      defineWebSocket({
        maxIncomingQueueSize: 4,
        incoming: struct.unknown(),
        path: "/ws",
      })(),
      {
        abort: abort.signal,
      },
    );
    expect(fault).toBeNull();
    abort.abort();
    await expect(socket?.closed).resolves.toMatchObject({ kind: "aborted" });
    expect(records).toEqual([]);
  });

  test.each([
    { path: "/ws", code: 1000 },
    { path: "/ws/1011", code: 1011 },
  ])("WebSocket server close $code does not log", async ({ path, code }) => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint(inject("testServerHost").replace(/^http:/, "ws:")),
      withOpenTelemetryServer({ logger }),
    );
    const [fault, socket] = await client.execute(
      defineWebSocket({
        maxIncomingQueueSize: 4,
        incoming: struct.unknown(),
        path,
      })(),
    );
    expect(fault).toBeNull();
    await expect(socket?.closed).resolves.toMatchObject({
      kind: "closed",
      code,
    });
    expect(records).toEqual([]);
  });

  // An abrupt drop (1006) has no close frame. Whether the platform WebSocket fires `error` before `close` depends on the
  // runtime (Node/undici does, Bun does not), and the session ends in `error` and logs once only when it does.
  test("WebSocket abrupt drop 1006 logs once only when the runtime reports an error first", async () => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    wss.on("connection", (socket) => setTimeout(() => socket.terminate(), 20));
    await new Promise((resolve) => wss.once("listening", resolve));
    try {
      const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
      const reportsErrorFirst = await new Promise<boolean>((resolve) => {
        const events: string[] = [];
        const probe = new WebSocket(url);
        probe.addEventListener("error", () => events.push("error"));
        probe.addEventListener("close", () =>
          resolve(events.includes("error")),
        );
      });

      const { logger, records } = createMockLogger();
      const client = createClient(
        withEndpoint(url),
        withOpenTelemetryServer({ logger }),
      );
      const [fault, socket] = await client.execute(
        defineWebSocket({
          maxIncomingQueueSize: 4,
          incoming: struct.unknown(),
          path: "/",
        })(),
      );
      expect(fault).toBeNull();
      await expect(socket?.closed).resolves.toMatchObject({
        kind: reportsErrorFirst ? "error" : "closed",
        code: 1006,
        wasClean: false,
      });
      expect(records.map((record) => record.attributes)).toEqual(
        reportsErrorFirst
          ? [
              expect.objectContaining({
                "defjs.phase": "connection",
                "websocket.close.code": 1006,
              }),
            ]
          : [],
      );
    } finally {
      wss.close();
    }
  });
});

describe("e2e: opentelemetry-server with real test server", () => {
  test("HTTP request carries traceparent header", async () => {
    const { tracer, spans } = createMockTracer();
    const propagator = createPropagator();
    const host = inject("testServerHost");

    const client = createClient(
      withEndpoint(host),
      withOpenTelemetryServer({ tracer, propagator }),
    );

    const useEchoHeaders = defineRequest({
      builder: () => ({}),
      method: "POST",
      path: "/echo-headers",
      input: struct.object({}),
      output: struct.object({ headers: struct.record(struct.string()) }),
    });

    const [error, result] = await client.execute(useEchoHeaders({}));

    expect(error).toBeNull();
    expect(result).toBeDefined();
    if (!isEchoHeadersResponse(result)) {
      throw new Error("Expected echo headers response");
    }
    expect(result.headers["traceparent"]).toMatch(TRACE_PARENT_REGEX);

    const span = onlySpan(spans);
    expect(span.name).toBe("POST");
    expect(span.attributes["http.request.method"]).toBe("POST");
    expect(span.attributes["url.full"]).toMatch(/\/echo-headers$/);
    expect(span.ended).toBe(true);
    expect(span.status).toBeUndefined();
  });

  test("HTTP error records span with ERROR status", async () => {
    const { tracer, spans } = createMockTracer();
    const propagator = createPropagator();
    const host = inject("testServerHost");

    const client = createClient(
      withEndpoint(host),
      withOpenTelemetryServer({ tracer, propagator }),
    );

    const useFail = defineRequest({
      method: "GET",
      path: "/500",
    });

    const [error] = await client.execute(useFail());

    expect(error).not.toBeNull();
    const span = onlySpan(spans);
    expect(span.name).toBe("GET");
    expect(span.attributes["error.type"]).toBe("500");
    expect(span.status?.code).toBe(SpanStatusCode.ERROR);
    expect(span.ended).toBe(true);
  });

  test("HTTP transport rejection returns NET_UNREACHABLE and records the exception class on the span", async () => {
    const { tracer, spans } = createMockTracer();
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(() => Promise.reject(new TypeError("fetch failed"))),
      withOpenTelemetryServer({ tracer, propagator: createPropagator() }),
    );
    const useUnavailable = defineRequest({
      method: "GET",
      path: "/unavailable",
    });

    const [error, result, response] = await client.execute(useUnavailable());

    expect(error).toMatchObject({ code: "NET_UNREACHABLE" });
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();

    const span = onlySpan(spans);
    expect(span.name).toBe("GET");
    expect(span.attributes["http.response.status_code"]).toBeUndefined();
    // An in-chain observer sees the raw rejection; fault classification happens outside the
    // chain, so the span carries the exception class per OTel convention.
    expect(span.attributes["error.type"]).toBe("TypeError");
    expect(span.status?.code).toBe(SpanStatusCode.ERROR);
    expect(span.ended).toBe(true);
  });

  test("SSE request carries traceparent header", async () => {
    const { tracer, spans } = createMockTracer();
    const propagator = createPropagator();
    const host = inject("testServerHost");

    const client = createClient(
      withEndpoint(host),
      withOpenTelemetryServer({ tracer, propagator }),
    );

    const useStream = defineEventStream({
      events: {
        traceparent: struct.string(),
      },
      maxBufferSize: 64 * 1024,
      maxQueueSize: 16,
      path: "/sse",
    });

    const [error, stream, open] = await client.execute(useStream());

    expect(error).toBeNull();
    expect(open?.response?.ok).toBe(true);

    if (!stream) {
      throw new Error("Expected stream");
    }

    const messages: Array<{ data: string; event: string; id?: string }> = [];
    for await (const event of stream) {
      messages.push(event);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]?.data).toMatch(TRACE_PARENT_REGEX);
    await stream.closed;

    const span = onlySpan(spans);
    expect(span.name).toBe("SSE");
    expect(span.ended).toBe(true);
  });

  test("SSE error records span with ERROR status", async () => {
    const { tracer, spans } = createMockTracer();
    const propagator = createPropagator();
    const host = inject("testServerHost");

    const client = createClient(
      withEndpoint(host),
      withOpenTelemetryServer({ tracer, propagator }),
    );

    const useStream = defineEventStream({
      events: {
        traceparent: struct.string(),
      },
      maxBufferSize: 64 * 1024,
      maxQueueSize: 16,
      path: "/sse/500",
    });

    const [error] = await client.execute(useStream());

    expect(error).not.toBeNull();
    const span = onlySpan(spans);
    expect(span.name).toBe("SSE");
    expect(span.status?.code).toBe(2); // ERROR
    expect(span.ended).toBe(true);
  });

  test("WebSocket explicit query propagation carries traceparent in query params", async () => {
    const { tracer, spans } = createMockTracer();
    const propagator = createPropagator();
    const host = inject("testServerHost");

    // Replace http:// with ws:// for WebSocket endpoint
    const wsHost = host.replace(/^http:/, "ws:");

    const client = createClient(
      withEndpoint(wsHost),
      withOpenTelemetryServer({
        tracer,
        propagator,
        webSocket: { queryPropagation: true },
      }),
    );

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({
        type: struct.literal("traceparent"),
        value: struct.string(),
      }),
      path: "/ws",
    });

    const [error, socket, connection] = await client.execute(useSocket());

    expect(error).toBeNull();
    expect(socket).toBeDefined();

    if (!socket) {
      throw new Error("Expected socket");
    }

    const messages: Array<{ type: string; value: string }> = [];
    for await (const msg of socket.receive) {
      messages.push(msg);
    }

    await socket.closed;

    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe("traceparent");
    expect(messages[0]?.value).toMatch(TRACE_PARENT_REGEX);

    const span = onlySpan(spans);
    expect(span.name).toBe("WebSocket");
    expect(span.ended).toBe(true);

    // Verify URL contains traceparent
    const url = new URL(connection?.url ?? "");
    expect(url.searchParams.get("traceparent")).toMatch(TRACE_PARENT_REGEX);
  });

  test("WebSocket query propagation replaces a traceparent already in the query", async () => {
    const { tracer, spans } = createMockTracer();
    const wsHost = inject("testServerHost").replace(/^http:/, "ws:");
    const client = createClient(
      withEndpoint(wsHost),
      withOpenTelemetryServer({
        tracer,
        propagator: createPropagator(),
        webSocket: { queryPropagation: true },
      }),
    );
    const useSocket = defineWebSocket({
      builder: (input) => ({ query: input }),
      maxIncomingQueueSize: 16,
      incoming: struct.object({
        type: struct.literal("traceparent"),
        value: struct.string(),
      }),
      input: struct.object({ traceparent: struct.string() }),
      path: "/ws",
    });
    const staleTraceparent =
      "00-11111111111111111111111111111111-2222222222222222-01";

    const [error, socket, connection] = await client.execute(
      useSocket({ traceparent: staleTraceparent }),
    );

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket");
    }
    const messages: Array<{ type: string; value: string }> = [];
    for await (const msg of socket.receive) {
      messages.push(msg);
    }
    await socket.closed;

    const { traceId, spanId } = onlySpan(spans).spanContext();
    expect(messages[0]?.value).toBe(`00-${traceId}-${spanId}-01`);
    expect(
      new URL(connection?.url ?? "").searchParams.getAll("traceparent"),
    ).toEqual([`00-${traceId}-${spanId}-01`]);
  });

  test("WebSocket omitted query propagation leaves the URL unchanged", async () => {
    const { tracer, spans } = createMockTracer();
    const propagator = createPropagator();
    const host = inject("testServerHost");
    const wsHost = host.replace(/^http:/, "ws:");

    const client = createClient(
      withEndpoint(wsHost),
      withOpenTelemetryServer({
        tracer,
        propagator,
      }),
    );

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({
        type: struct.literal("traceparent"),
        value: struct.string(),
      }),
      path: "/ws",
    });

    const [error, socket, connection] = await client.execute(useSocket());

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket");
    }

    const messages: Array<{ type: string; value: string }> = [];
    for await (const msg of socket.receive) {
      messages.push(msg);
    }

    await socket.closed;

    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe("traceparent");
    expect(messages[0]?.value).toBe("missing");

    const span = onlySpan(spans);
    expect(span.name).toBe("WebSocket");
    expect(span.ended).toBe(true);

    const url = new URL(connection?.url ?? "");
    expect(url.searchParams.get("traceparent")).toBeNull();
    expect(connection?.url).toBe(`${wsHost}/ws`);
  });
});
