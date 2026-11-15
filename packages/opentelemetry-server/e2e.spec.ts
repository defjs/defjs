import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withRetry,
  withSSEHandle,
} from "@defjs/core";
import { diag, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
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
import { useAsyncContext } from "./test/context";
import { method } from "./test/method";
import type { MockSpan } from "./test/mocks";
import {
  createMockLogger,
  createMockTracer,
  createRecordingMeter,
  waitForSettledPromises,
} from "./test/mocks";

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

/** The spans of one operation call: the operation span, then its transport span. */
function callSpans(spans: readonly MockSpan[]): {
  operation: MockSpan;
  transport: MockSpan;
} {
  expect(spans.map((span) => span.kind)).toEqual([
    SpanKind.INTERNAL,
    SpanKind.CLIENT,
  ]);
  const [operation, transport] = spans;
  if (!operation || !transport) {
    throw new Error("Expected an operation span and a transport span");
  }
  return { operation, transport };
}

const TRACE_PARENT_REGEX = /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/;

function json(body: string | null, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("operation telemetry", () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([false, true])(
    "logs a network failure once on the operation and keeps the fault when the logger throws=%s",
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
      const request = defineRequest({
        method: "GET",
        meta: { operation: "inventory.read" },
        path: "/inventory",
      });
      const [fault, data, response] = await request(client);
      expect(fault).toMatchObject({ code: "NET_UNREACHABLE", cause });
      expect(data).toBeUndefined();
      expect(response).toBeUndefined();
      expect(logger.emit).toHaveBeenCalledTimes(1);
      if (!throws)
        expect(records[0]).toMatchObject({
          eventName: "defjs.client.operation.exception",
          body: "Defjs operation failed",
          severityNumber: 13,
          attributes: {
            "defjs.operation.name": "GET /inventory",
            "defjs.meta.operation": "inventory.read",
            "error.type": "NET_UNREACHABLE",
            "exception.type": "DefjsFault",
          },
        });
    },
  );

  test("reports an input that fails validation, which never reaches a transport", async () => {
    const { logger, records } = createMockLogger();
    const { tracer, spans } = createMockTracer();
    const { meter, samples } = createRecordingMeter();
    const handle = vi.fn(() => Promise.resolve(new Response()));
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(handle),
      withOpenTelemetryServer({ logger, tracer, meter }),
    );
    const request = defineRequest({
      method: "POST",
      path: "/inventory",
      input: struct.object({ count: struct.number() }),
      builder: (input) => ({ body: input }),
    });
    const [fault] = await request(client, { count: NaN });
    expect(fault?.code).toBe("REQ_INPUT_INVALID");
    expect(handle).not.toHaveBeenCalled();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: "POST /inventory",
      kind: SpanKind.INTERNAL,
      ended: true,
      status: { code: SpanStatusCode.ERROR },
      attributes: {
        "defjs.operation.name": "POST /inventory",
        "error.type": "REQ_INPUT_INVALID",
      },
    });
    expect(
      samples.map(({ name, attributes }) => ({ name, attributes })),
    ).toEqual([
      {
        name: "defjs.client.operation.duration",
        attributes: {
          "defjs.operation.name": "POST /inventory",
          "error.type": "REQ_INPUT_INVALID",
        },
      },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toMatchObject({
      "error.type": "REQ_INPUT_INVALID",
    });
    expect(records[0]?.context && trace.getSpan(records[0].context)).toBe(
      spans[0],
    );
  });

  test.each([
    {
      status: 500,
      body: '{"message":"down"}',
      type: "json",
      code: "HTTP_STATUS",
    },
    {
      status: 500,
      body: '{"message":1}',
      type: "json",
      code: "RES_STRUCT_MISMATCH",
    },
    { status: 500, body: "{invalid", type: "json", code: "RES_DECODE_FAILED" },
    {
      status: 502,
      body: "<html></html>",
      type: "html",
      code: "RES_MEDIA_TYPE_INVALID",
    },
    {
      status: 200,
      body: "<html></html>",
      type: "html",
      code: "RES_MEDIA_TYPE_INVALID",
    },
    { status: 200, body: "{invalid", type: "json", code: "RES_DECODE_FAILED" },
    {
      status: 200,
      body: '{"count":"many"}',
      type: "json",
      code: "RES_STRUCT_MISMATCH",
    },
    { status: 204, body: null, type: "json", code: "RES_DECODE_FAILED" },
  ])(
    "logs a $status $type response that ends as $code once, with the fault code",
    async ({ status, body, type, code }) => {
      const { logger, records } = createMockLogger();
      const client = createClient(
        withEndpoint("https://example.invalid"),
        withHTTPHandle(() =>
          Promise.resolve(
            new Response(body, {
              status,
              headers: {
                "content-type":
                  type === "json" ? "application/json" : "text/html",
              },
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
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        eventName: "defjs.client.operation.exception",
        attributes: { "error.type": code, "exception.type": "DefjsFault" },
      });
    },
  );

  test("a 2xx body that does not match the declaration fails the operation span, not the HTTP span", async () => {
    useAsyncContext();
    const { tracer, spans } = createMockTracer();
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(() => Promise.resolve(json('{"count":"many"}'))),
      withOpenTelemetryServer({ tracer }),
    );
    const request = defineRequest({
      method: "GET",
      path: "/inventory/:id",
      input: struct.object({ id: struct.number() }),
      builder: (input) => ({ path: input }),
      output: struct.object({ count: struct.number() }),
    });

    const [fault] = await request(client, { id: 1 });

    expect(fault?.code).toBe("RES_STRUCT_MISMATCH");
    const { operation, transport } = callSpans(spans);
    expect(operation.name).toBe("GET /inventory/:id");
    expect(operation.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(operation.attributes["error.type"]).toBe("RES_STRUCT_MISMATCH");
    expect(transport.name).toBe("GET");
    expect(transport.status).toBeUndefined();
    expect(transport.attributes["http.response.status_code"]).toBe(200);
    const parent = vi.mocked(method(tracer, "startSpan")).mock.calls[1]?.[2];
    expect(parent && trace.getSpan(parent)).toBe(operation);
  });

  test("a retried call has one operation span over one HTTP span per attempt", async () => {
    useAsyncContext();
    const { logger, records } = createMockLogger();
    const { tracer, spans } = createMockTracer();
    const { meter, samples } = createRecordingMeter();
    const handle = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(json("{}", 503))
      .mockResolvedValue(json('{"count":1}'));
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(handle),
      withRetry({ delayMs: 0, budget: false }),
      withOpenTelemetryServer({ logger, tracer, meter }),
    );
    const request = defineRequest({
      method: "GET",
      path: "/inventory",
      output: struct.object({ count: struct.number() }),
    });

    const [fault] = await request(client);

    expect(fault).toBeNull();
    expect(spans.map((span) => [span.name, span.status])).toEqual([
      ["GET /inventory", undefined],
      ["GET", { code: SpanStatusCode.ERROR }],
      ["GET", undefined],
    ]);
    const parents = vi
      .mocked(method(tracer, "startSpan"))
      .mock.calls.slice(1)
      .map((call) => call[2] && trace.getSpan(call[2]));
    expect(parents).toEqual([spans[0], spans[0]]);
    expect(
      samples
        .filter((sample) => sample.name === "defjs.client.operation.duration")
        .map((sample) => sample.attributes),
    ).toEqual([{ "defjs.operation.name": "GET /inventory" }]);
    expect(records).toEqual([]);
  });

  test("a call without an active parent span starts a trace of its own", async () => {
    useAsyncContext();
    const { tracer, spans } = createMockTracer();
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      ),
      withOpenTelemetryServer({ tracer }),
    );

    const [fault] = await defineRequest({ method: "GET", path: "/inventory" })(
      client,
    );

    expect(fault).toBeNull();
    const root = vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[2];
    expect(root && trace.getSpan(root)).toBeUndefined();
    expect(callSpans(spans).operation.ended).toBe(true);
  });

  test("includeErrorDiagnostics exports the fault message and stack, never the cause's fields", async () => {
    const { logger, records } = createMockLogger();
    const { tracer, spans } = createMockTracer();
    const cause = Object.assign(
      new TypeError("ECONNREFUSED: Unable to connect"),
      { path: "https://example.invalid/inventory?sign=SECRET" },
    );
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(() => Promise.reject(cause)),
      withOpenTelemetryServer({
        logger,
        tracer,
        includeErrorDiagnostics: true,
      }),
    );

    const [fault] = await defineRequest({ method: "GET", path: "/inventory" })(
      client,
    );

    expect(fault?.message).toBe("ECONNREFUSED: Unable to connect");
    const { operation, transport } = callSpans(spans);
    expect(operation.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "ECONNREFUSED: Unable to connect",
    });
    expect(transport.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "ECONNREFUSED: Unable to connect",
    });
    expect(transport.recordException).toHaveBeenCalledWith({
      name: "TypeError",
      message: "ECONNREFUSED: Unable to connect",
      stack: cause.stack,
    });
    expect(records[0]?.attributes).toMatchObject({
      "error.type": "NET_UNREACHABLE",
      "exception.message": "ECONNREFUSED: Unable to connect",
      "exception.stacktrace": fault?.stack,
    });
    expect(JSON.stringify({ records, operation, transport })).not.toContain(
      "SECRET",
    );
  });

  test("a transport turned off has no operation telemetry either", async () => {
    const { logger, records } = createMockLogger();
    const { tracer, spans } = createMockTracer();
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(() => Promise.reject(new TypeError("offline"))),
      withOpenTelemetryServer({ logger, tracer, http: { enabled: false } }),
    );

    const [fault] = await defineRequest({ method: "GET", path: "/inventory" })(
      client,
    );

    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(spans).toEqual([]);
    expect(records).toEqual([]);
  });

  test("SSE non-2xx handshake logs once on the operation as the HTTP_STATUS fault", async () => {
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
      eventName: "defjs.client.operation.exception",
      attributes: {
        "defjs.operation.name": "SSE /sse/500",
        "error.type": "HTTP_STATUS",
        "exception.type": "DefjsFault",
      },
    });
  });

  test("SSE network failure logs once on the operation", async () => {
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
      eventName: "defjs.client.operation.exception",
      attributes: { "error.type": "NET_UNREACHABLE" },
    });
  });

  test("HTTP caller abort is not a failure", async () => {
    const { logger, records } = createMockLogger();
    const { tracer, spans } = createMockTracer();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle((_input, init) => {
        markStarted();
        return new Promise<Response>((_resolve, reject) => {
          // Fetch rejects with the signal's reason, an `AbortError` by default.
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            ),
          );
        });
      }),
      withOpenTelemetryServer({ logger, tracer }),
    );
    const abort = new AbortController();
    const pending = defineRequest({ method: "GET", path: "/inventory" })(
      client({ signal: abort.signal }),
    );
    await started;
    abort.abort();
    const [fault] = await pending;
    expect(fault?.code).toBe("NET_ABORTED");
    expect(records).toEqual([]);
    for (const span of Object.values(callSpans(spans))) {
      expect(span.addEvent).toHaveBeenCalledWith("http.aborted");
      expect(span.status).toBeUndefined();
      expect(span.recordException).not.toHaveBeenCalled();
      expect(span.attributes["error.type"]).toBeUndefined();
      expect(span.ended).toBe(true);
    }
  });

  test("SSE caller abort during the handshake is not a failure", async () => {
    const { logger, records } = createMockLogger();
    const { tracer, spans } = createMockTracer();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = createClient(
      withEndpoint("https://example.invalid"),
      withSSEHandle((_input, init) => {
        markStarted();
        return new Promise<Response>((_resolve, reject) => {
          // Fetch rejects with the signal's reason, an `AbortError` by default.
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            ),
          );
        });
      }),
      withOpenTelemetryServer({ logger, tracer }),
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
    await waitForSettledPromises();
    expect(records).toEqual([]);
    for (const span of Object.values(callSpans(spans))) {
      expect(span.addEvent).toHaveBeenCalledWith("sse.aborted");
      expect(span.status).toBeUndefined();
      expect(span.recordException).not.toHaveBeenCalled();
      expect(span.ended).toBe(true);
    }
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
    "WebSocket $name logs once on the operation",
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
        eventName: "defjs.client.operation.exception",
        severityNumber: 13,
        attributes: {
          "defjs.operation.name": `WebSocket ${path}`,
          "error.type": "NET_UNREACHABLE",
          "exception.type": "DefjsFault",
        },
      });
    },
  );

  test("WebSocket caller abort after open is not a failure", async () => {
    const { logger, records } = createMockLogger();
    const { tracer, spans } = createMockTracer();
    const client = createClient(
      withEndpoint(inject("testServerHost").replace(/^http:/, "ws:")),
      withOpenTelemetryServer({ logger, tracer }),
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
    const { operation, transport } = callSpans(spans);
    expect(operation.status).toBeUndefined();
    expect(operation.addEvent).not.toHaveBeenCalled();
    expect(transport.addEvent).toHaveBeenCalledWith(
      "websocket.aborted",
      undefined,
    );
    expect(transport.status).toBeUndefined();
    expect(transport.recordException).not.toHaveBeenCalled();
    expect(transport.attributes["error.type"]).toBeUndefined();
    expect(transport.ended).toBe(true);
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
  test("WebSocket abrupt drop 1006 ends in error and logs once on the connection, on every runtime", async () => {
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
    expect(records).toHaveLength(1);
    expect(records[0]?.eventName).toBe("defjs.client.websocket.exception");
    expect(records[0]?.attributes?.["websocket.close.code"]).toBe(1006);
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

    const span = callSpans(spans).transport;
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
    const span = callSpans(spans).transport;
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

    const span = callSpans(spans).transport;
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
    const span = callSpans(spans).transport;
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
    const span = callSpans(spans).transport;
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

    const span = callSpans(spans).transport;
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
    const span = callSpans(spans).transport;
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

    const span = callSpans(spans).transport;
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

    const { traceId, spanId } = callSpans(spans).transport.spanContext();
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

    const span = callSpans(spans).transport;
    expect(span.name).toBe("WebSocket");
    expect(span.ended).toBe(true);

    const url = new URL(connection?.url ?? "");
    expect(url.searchParams.get("traceparent")).toBeNull();
    expect(connection?.url).toBe(`${wsHost}/ws`);
  });
});
