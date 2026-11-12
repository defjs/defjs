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
import {
  afterEach,
  describe,
  expect,
  inject,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { createFixtureClient } from "../core/test/fixture/client.ts";
import { withOpenTelemetryServer } from "./src/option";
import type { MockSpan } from "./test/mocks";
import { createMockLogger, createMockTracer } from "./test/mocks";

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

const TRACE_PARENT_REGEX = /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/;

describe("operation diagnostic boundary", () => {
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
        withHTTPHandle(() => Promise.reject(cause)),
        withOpenTelemetryServer({ logger }),
      );
      const request = defineRequest({ method: "GET", path: "/inventory" });
      const [fault, data, response] = await request(client);
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
    const handle = vi.fn(() => Promise.resolve(new Response()));
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
    const [fault] = await request(client, {
      count: NaN,
    });
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
        withHTTPHandle(() =>
          Promise.resolve(
            new Response(body, {
              status,
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
        withOpenTelemetryServer({ logger }),
      );
      const request = defineRequest({
        method: "GET",
        path: "/inventory",
        output: struct.object({ count: struct.number() }),
      });
      const [fault] = await request(client);
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
        withHTTPHandle(() =>
          Promise.resolve(
            new Response(body, {
              status,
              headers: { "content-type": contentType },
            }),
          ),
        ),
        withOpenTelemetryServer({ logger }),
      );
      const request = defineRequest({
        method: "GET",
        path: "/inventory",
        output: struct.object({ count: struct.number() }),
        error: struct.object({ message: struct.string() }),
      });
      const [fault] = await request(client);
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

  test("SSE non-2xx handshake logs one connect failure as the HTTP_STATUS fault", async () => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withOpenTelemetryServer({ logger }),
    );
    const [fault] = await defineEventStream({
      events: { message: struct.string() },
      path: "/sse/500",
    })(client);
    expect(fault?.code).toBe("HTTP_STATUS");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventName: "defjs.client.sse.exception",
      severityNumber: 13,
      attributes: {
        "defjs.phase": "connect",
        "exception.type": "DefjsFault",
      },
    });
  });

  test("SSE network failure logs one connect failure", async () => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withSSEHandle(() =>
        Promise.reject(new TypeError("local transport unavailable")),
      ),
      withOpenTelemetryServer({ logger }),
    );
    const [fault] = await defineEventStream({
      events: { message: struct.string() },
      path: "/stream",
    })(client);
    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventName: "defjs.client.sse.exception",
      attributes: { "defjs.phase": "connect", "exception.type": "TypeError" },
    });
  });

  test("SSE caller abort during the handshake does not log", async () => {
    const { logger, records } = createMockLogger();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withSSEHandle(() => {
        markStarted();
        return new Promise<Response>(() => undefined);
      }),
      withOpenTelemetryServer({ logger }),
    );
    const abort = new AbortController();
    const openStream = defineEventStream({
      events: { message: struct.string() },
      path: "/stream",
    });
    const pending = openStream(client({ signal: abort.signal }));
    await started;
    abort.abort();
    const [fault] = await pending;
    expect(fault?.code).toBe("NET_ABORTED");
    expect(records).toEqual([]);
  });

  test("SSE end of stream does not log", async () => {
    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withOpenTelemetryServer({ logger }),
    );
    const [fault, stream] = await defineEventStream({
      events: { traceparent: struct.string() },
      path: "/sse",
    })(client);
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
        ? inject("refusedOrigin").replace(/^http:/, "ws:")
        : inject("testServerHost").replace(/^http:/, "ws:");
      const client = createClient(
        withEndpoint(host),
        withOpenTelemetryServer({ logger }),
      );
      const [fault] = await defineWebSocket({
        incoming: struct.unknown(),
        path,
      })(client);
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
    const [fault, socket] = await defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws",
    })(client({ signal: abort.signal }));
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
    const [fault, socket] = await defineWebSocket({
      incoming: struct.unknown(),
      path,
    })(client);
    expect(fault).toBeNull();
    await expect(socket?.closed).resolves.toMatchObject({
      kind: "closed",
      code,
    });
    expect(records).toEqual([]);
  });

  // An abrupt drop (1006) has no close frame. The session ends in `error` and logs once, whether or not the platform
  // WebSocket fires `error` before `close`.
  test("WebSocket abrupt drop 1006 ends in error and logs once on every runtime", async () => {
    const f = createFixtureClient(
      inject("testServerHost"),
      inject("fixtureToken"),
    );
    onTestFinished(() => f.delete());
    const url = (await f.endpoint("abrupt", "ws", { send: [] })).replace(
      /^http:/,
      "ws:",
    );

    const { logger, records } = createMockLogger();
    const client = createClient(
      withEndpoint(url),
      withOpenTelemetryServer({ logger }),
    );
    const [fault, socket] = await defineWebSocket({
      incoming: struct.unknown(),
      path: "/",
    })(client);
    expect(fault).toBeNull();
    await f.act("abrupt", "terminate", { request: 0 });
    await expect(socket?.closed).resolves.toMatchObject({
      kind: "error",
      code: 1006,
      wasClean: false,
    });
    expect(records.map((record) => record.attributes)).toEqual([
      expect.objectContaining({
        "defjs.phase": "connection",
        "websocket.close.code": 1006,
      }),
    ]);
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

    const [error, result] = await useEchoHeaders(client, {});

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

    const [error] = await useFail(client);

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

    const [error, result, response] = await useUnavailable(client);

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

  test("a URL with credentials is rejected before it is sent and leaves no credentials or query values in the span", async () => {
    const { tracer, spans } = createMockTracer();
    const host = inject("testServerHost");
    const client = createClient(
      withEndpoint(host.replace("http://", "http://svc-user:S3cretPassw0rd@")),
      withOpenTelemetryServer({ tracer, propagator: createPropagator() }),
    );
    const useEcho = defineRequest({
      method: "GET",
      path: "/echo-headers",
      input: struct.object({ token: struct.string() }),
      builder: (input) => ({ query: { token: input.token } }),
    });

    const [error] = await useEcho(client, { token: "SECRET-QUERY-TOKEN" });

    expect(error).toMatchObject({ code: "REQ_BUILD_FAILED" });
    const span = onlySpan(spans);
    expect(span.attributes["url.full"]).toBe(
      `${host.replace("http://", "http://REDACTED:REDACTED@")}/echo-headers`,
    );
    // An Error keeps `message` and `stack` non-enumerable, so serialising it would hide a leak:
    // the recorded exception must be a plain `{ name }` object instead.
    const exceptions: unknown[] = [];
    for (const [exception] of span.recordException.mock.calls) {
      exceptions.push(exception);
    }
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).not.toBeInstanceOf(Error);
    expect(Object.getOwnPropertyNames(exceptions[0])).toEqual(["name"]);
    // The interceptor sees the platform's TypeError, not a library class.
    expect(exceptions[0]).toEqual({ name: "TypeError" });
    expect(span.attributes["error.type"]).toBe("TypeError");
    const recorded = JSON.stringify({
      attributes: span.attributes,
      events: span.addEvent.mock.calls,
      exceptions,
    });
    expect(recorded).not.toContain("S3cretPassw0rd");
    expect(recorded).not.toContain("svc-user");
    expect(recorded).not.toContain("SECRET-QUERY-TOKEN");
  });

  test("a response body that fails JSON decoding is not copied into the span exception", async () => {
    const { tracer, spans } = createMockTracer();
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(() =>
        Promise.resolve(
          new Response("secret-api-key-ABCDEF123456 is the value", {
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
      withOpenTelemetryServer({ tracer, propagator: createPropagator() }),
    );
    const useJson = defineRequest({
      method: "GET",
      path: "/json",
      output: struct.object({ ok: struct.boolean() }),
    });

    const [error] = await useJson(client);

    expect(error).toMatchObject({ code: "RES_DECODE_FAILED" });
    const span = onlySpan(spans);
    expect(span.recordException.mock.calls).toEqual([
      [{ name: "BodyFailure" }],
    ]);
    expect(JSON.stringify(span.recordException.mock.calls)).not.toContain(
      "secret",
    );
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
      path: "/sse",
    });

    const [error, stream, open] = await useStream(client);

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
      path: "/sse/500",
    });

    const [error] = await useStream(client);

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
      incoming: struct.object({
        type: struct.literal("traceparent"),
        value: struct.string(),
      }),
      path: "/ws",
    });

    const [error, socket, connection] = await useSocket(client);

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
      incoming: struct.object({
        type: struct.literal("traceparent"),
        value: struct.string(),
      }),
      input: struct.object({ traceparent: struct.string() }),
      path: "/ws",
    });
    const staleTraceparent =
      "00-11111111111111111111111111111111-2222222222222222-01";

    const [error, socket, connection] = await useSocket(client, {
      traceparent: staleTraceparent,
    });

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
      incoming: struct.object({
        type: struct.literal("traceparent"),
        value: struct.string(),
      }),
      path: "/ws",
    });

    const [error, socket, connection] = await useSocket(client);

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
