import {
  createNetworkFault,
  ERR_ABORTED,
  ERR_TIMEOUT,
  type HttpRequest,
} from "@defjs/core";
import type {
  Context,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
} from "@opentelemetry/api";
import {
  context,
  diag,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createMockMetrics,
  createMockLogger,
  createMockTracer,
  makeDeferredWsSession,
  makeWsRequest,
  makeWsSession,
  waitForSettledPromises,
} from "../../test/mocks";
import { createOpenTelemetryWebSocketInterceptor } from "./web_socket";
import { method } from "../../test/method";

function createMockWsPropagator(): TextMapPropagator {
  return {
    inject: vi.fn(
      (_ctx: Context, carrier: unknown, setter: TextMapSetter<unknown>) => {
        setter.set(carrier, "traceparent", "mock-trace-id");
        setter.set(carrier, "tracestate", "vendor=value");
        setter.set(carrier, "baggage", "tenant=acme");
      },
    ),
    extract: vi.fn(
      (ctx: Context, _carrier?: unknown, _getter?: TextMapGetter<unknown>) =>
        ctx,
    ),
    fields: vi.fn(() => ["traceparent", "tracestate", "baggage"]),
  };
}

let mockPropagator: ReturnType<typeof createMockWsPropagator>;

describe("WebSocket client diagnostic logs", () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([
    { cause: new Error("offline"), count: 1 },
    { cause: ERR_TIMEOUT, count: 1 },
    { cause: ERR_ABORTED, count: 0 },
    { cause: createNetworkFault(ERR_ABORTED), count: 0 },
  ])(
    "classifies startup failure $cause with $count diagnostics",
    async ({ cause, count }) => {
      const { logger, records } = createMockLogger();
      const interceptor = createOpenTelemetryWebSocketInterceptor({
        logger,
        propagator: createMockWsPropagator(),
      });
      await expect(
        interceptor.fn(makeWsRequest(), () => Promise.reject(cause)),
      ).rejects.toBe(cause);
      expect(records).toHaveLength(count);
      if (count)
        expect(records[0]).toMatchObject({
          eventName: "defjs.client.websocket.exception",
          severityNumber: 13,
          attributes: { "defjs.phase": "connect" },
        });
    },
  );

  test.each([
    { tracing: false, rejected: false },
    { tracing: true, rejected: false },
    { tracing: false, rejected: true },
    { tracing: true, rejected: true },
  ])(
    "retains the opening context after close, tracer=$tracing rejected=$rejected",
    async ({ tracing, rejected }) => {
      const { logger, records } = createMockLogger();
      const { tracer, spans } = createMockTracer();
      const metrics = createMockMetrics();
      const parent = trace.setSpanContext(ROOT_CONTEXT, {
        traceId: "11111111111111111111111111111111",
        spanId: "2222222222222222",
        traceFlags: 0,
      });
      const active = vi.spyOn(context, "active").mockReturnValue(parent);
      const session = makeDeferredWsSession();
      const interceptor = createOpenTelemetryWebSocketInterceptor({
        logger,
        tracer: tracing ? tracer : undefined,
        metrics,
        propagator: createMockWsPropagator(),
      });
      await expect(
        interceptor.fn(makeWsRequest(), () => Promise.resolve(session.session)),
      ).resolves.toBe(session.session);
      expect(records).toEqual([]);
      active.mockReturnValue(ROOT_CONTEXT);
      const cause = new TypeError("private failure");
      if (rejected) session.reject(cause);
      else
        session.close({
          kind: "error",
          cause,
          code: 1006,
          reason: "private close reason",
        });
      await waitForSettledPromises();
      session.close({ kind: "error", cause });
      await waitForSettledPromises();
      expect(records).toHaveLength(1);
      const record = records[0];
      if (!record?.context)
        throw new Error("Expected a log record with explicit context");
      expect(record).toMatchObject({
        severityNumber: 13,
        attributes: {
          "defjs.phase": "connection",
          "exception.type": "TypeError",
        },
      });
      expect(record.attributes?.["websocket.close.code"]).toBe(
        rejected ? undefined : 1006,
      );
      expect(JSON.stringify(records)).not.toContain("private");
      if (tracing) expect(trace.getSpan(record.context)).toBe(spans[0]);
      else expect(record.context).toBe(parent);
      expect(
        metrics.active.add.mock.calls.map((call) => {
          const value: unknown = call[0];
          return value;
        }),
      ).toEqual([1, -1]);
      expect(metrics.connectionDuration.record).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["closed", "aborted"] as const)(
    "does not log %s even with an error cause",
    async (kind) => {
      const { logger, records } = createMockLogger();
      const session = makeDeferredWsSession();
      const interceptor = createOpenTelemetryWebSocketInterceptor({
        logger,
        propagator: createMockWsPropagator(),
      });
      await interceptor.fn(makeWsRequest(), () =>
        Promise.resolve(session.session),
      );
      session.close({ kind, cause: new Error("user decided to stop") });
      await waitForSettledPromises();
      expect(records).toEqual([]);
    },
  );

  test.each(["emit", "rejected"] as const)(
    "preserves termination when logging fails in %s",
    async (failure) => {
      const { logger } = createMockLogger();
      logger.emit.mockImplementation(() => {
        throw new Error("logger failed");
      });
      const report = vi
        .spyOn(diag, "error")
        .mockImplementation(() => undefined);
      const { tracer, spans } = createMockTracer();
      const metrics = createMockMetrics();
      const session = makeDeferredWsSession();
      const interceptor = createOpenTelemetryWebSocketInterceptor({
        logger,
        tracer,
        metrics,
        propagator: createMockWsPropagator(),
      });
      await expect(
        interceptor.fn(makeWsRequest(), () => Promise.resolve(session.session)),
      ).resolves.toBe(session.session);
      const cause = new Error("original");
      if (failure === "rejected") {
        session.reject(cause);
        await expect(session.session.closed).rejects.toBe(cause);
      } else {
        session.close({ kind: "error", cause });
        await expect(session.session.closed).resolves.toMatchObject({
          kind: "error",
          cause,
        });
      }
      await waitForSettledPromises();
      expect(report).toHaveBeenCalledTimes(1);
      expect(spans[0]?.ended).toBe(true);
      expect(
        metrics.active.add.mock.calls.map((call) => {
          const value: unknown = call[0];
          return value;
        }),
      ).toEqual([1, -1]);
    },
  );
});

describe("createOpenTelemetryWebSocketInterceptor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPropagator = createMockWsPropagator();
  });

  test.each([
    { close: "closed", result: "success", extras: {} },
    { close: "aborted", result: "aborted", extras: {} },
    { close: "error", result: "error", extras: { "error.type": "TypeError" } },
    {
      close: "rejected",
      result: "error",
      extras: { "error.type": "TypeError" },
    },
  ] as const)(
    "records WebSocket $close lifecycle without a tracer",
    async ({ close, result, extras }) => {
      const metrics = createMockMetrics();
      const ws = makeDeferredWsSession();
      const interceptor = createOpenTelemetryWebSocketInterceptor({
        propagator: mockPropagator,
        metrics,
        requireParentSpan: true,
      });
      await expect(
        interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session)),
      ).resolves.toBe(ws.session);
      expect(metrics.connectDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "server.address": "api.example.com",
          "server.port": 443,
          "defjs.result": "success",
        },
      );
      expect(metrics.active.add.mock.calls).toEqual([
        [1, { "server.address": "api.example.com", "server.port": 443 }],
      ]);
      expect(metrics.connectionDuration.record).not.toHaveBeenCalled();

      if (close === "rejected") ws.reject(new TypeError("connection lost"));
      else if (close === "error")
        ws.close({ kind: "error", cause: new TypeError("connection lost") });
      else ws.close({ kind: close });
      await waitForSettledPromises();

      expect(metrics.active.add.mock.calls).toEqual([
        [1, { "server.address": "api.example.com", "server.port": 443 }],
        [-1, { "server.address": "api.example.com", "server.port": 443 }],
      ]);
      expect(metrics.connectionDuration.record).toHaveBeenCalledTimes(1);
      expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "server.address": "api.example.com",
          "server.port": 443,
          "defjs.result": result,
          ...extras,
        },
      );
    },
  );

  test("records WebSocket startup failure without a tracer without incrementing active connections", async () => {
    const metrics = createMockMetrics();
    const error = new TypeError("connect failed");
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      propagator: mockPropagator,
      metrics,
    });
    await expect(
      interceptor.fn(makeWsRequest(), () => Promise.reject(error)),
    ).rejects.toBe(error);
    expect(metrics.connectDuration.record).toHaveBeenCalledTimes(1);
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        "server.address": "api.example.com",
        "server.port": 443,
        "defjs.result": "error",
        "error.type": "TypeError",
      },
    );
    expect(metrics.active.add).not.toHaveBeenCalled();
    expect(metrics.connectionDuration.record).not.toHaveBeenCalled();
  });

  test("should extract trace context from headers via propagator", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = makeWsRequest(
      undefined,
      new Headers({ traceparent: "upstream-trace-id" }),
    );
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));

    await interceptor.fn(req, next);

    expect(method(mockPropagator, "extract")).toHaveBeenCalled();
  });

  test("should inject propagation fields into query params when explicitly enabled", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      queryPropagation: true,
    });

    const req = makeWsRequest();
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));

    await interceptor.fn(req, next);

    expect(method(mockPropagator, "inject")).toHaveBeenCalled();
    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].query?.get("traceparent")).toBe("mock-trace-id");
    expect(calls[0]?.[0].query?.get("tracestate")).toBe("vendor=value");
    expect(calls[0]?.[0].query?.get("baggage")).toBe("tenant=acme");
    expect(calls[0]?.[0].query?.toString()).toBe(
      "traceparent=mock-trace-id&tracestate=vendor%3Dvalue&baggage=tenant%3Dacme",
    );
  });

  test("should preserve existing query params when injecting traceparent", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      queryPropagation: true,
    });

    const req = makeWsRequest(new URLSearchParams({ room: "alpha" }));
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].query?.get("room")).toBe("alpha");
    expect(calls[0]?.[0].query?.get("traceparent")).toBe("mock-trace-id");
  });

  test("should append propagation params after the existing query without changing the request's own", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      queryPropagation: true,
    });

    const req = makeWsRequest(
      new URLSearchParams([
        ["space", "hello world"],
        ["room", "alpha"],
      ]),
    );
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].query?.toString()).toBe(
      "space=hello+world&room=alpha&traceparent=mock-trace-id&tracestate=vendor%3Dvalue&baggage=tenant%3Dacme",
    );
    expect(req.query?.get("traceparent")).toBeNull();
  });

  test("should create span with correct name", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("WebSocket");
  });

  test("should set url.full attribute", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(spans[0]?.attributes["url.full"]).toBe("wss://api.example.com/ws");
  });

  test.each([
    [
      "https://api.example.com",
      "wss://api.example.com/ws",
      "api.example.com",
      443,
    ],
    ["http://localhost:8080", "ws://localhost:8080/ws", "localhost", 8080],
    ["http://localhost", "ws://localhost/ws", "localhost", 80],
    [
      "wss://api.example.com:8443",
      "wss://api.example.com:8443/ws",
      "api.example.com",
      8443,
    ],
  ])(
    "should use the ws scheme and server attributes on the WebSocket span when it is created, base %s",
    async (baseEndpoint, url, address, port) => {
      const { tracer } = createMockTracer();
      const interceptor = createOpenTelemetryWebSocketInterceptor({
        tracer,
        propagator: mockPropagator,
      });

      await interceptor.fn({ ...makeWsRequest(), baseEndpoint }, () =>
        Promise.resolve(makeWsSession()),
      );

      expect(
        vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
      ).toMatchObject({
        "url.full": url,
        "server.address": address,
        "server.port": port,
      });
    },
  );

  test("should put http.request.method GET on the WebSocket span when it is created", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toMatchObject({ "http.request.method": "GET" });
  });

  test("should let startSpanHook override http.request.method on the WebSocket span", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => ({ "http.request.method": "POST" }),
    });

    await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toMatchObject({ "http.request.method": "POST" });
  });

  test("should not write server attributes on the WebSocket span without a base endpoint", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn({ ...makeWsRequest(), baseEndpoint: undefined }, () =>
      Promise.resolve(makeWsSession()),
    );

    const attributes = vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]
      ?.attributes;
    expect(attributes).not.toHaveProperty("server.address");
    expect(attributes).not.toHaveProperty("server.port");
  });

  test("should let startSpanHook override the built-in WebSocket server attributes", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => ({
        "server.address": "tenant.example.com",
        "server.port": 9443,
      }),
    });

    await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toMatchObject({
      "server.address": "tenant.example.com",
      "server.port": 9443,
    });
  });

  test("should replace endpoint userinfo in url.full", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(
      {
        ...makeWsRequest(),
        baseEndpoint: "wss://svc-user:S3cretPassw0rd@api.example.com",
      },
      () => Promise.resolve(makeWsSession()),
    );

    expect(spans[0]?.attributes["url.full"]).toBe(
      "wss://REDACTED:REDACTED@api.example.com/ws",
    );
  });

  test("should merge startSpanHook attributes last into initial WebSocket span options", async () => {
    const { tracer } = createMockTracer();
    const req = makeWsRequest();
    const startSpanHook = vi.fn(() => ({
      "app.tenant": "acme",
      "url.full": "wss://tenant.example.com/socket",
    }));
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook,
    });

    await interceptor.fn(req, () => Promise.resolve(makeWsSession()));

    expect(startSpanHook).toHaveBeenCalledWith(req);
    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "app.tenant": "acme",
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
      "url.full": "wss://tenant.example.com/socket",
    });
  });

  test("should keep the resolved WebSocket URL in initial span options when startSpanHook is absent", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
      "url.full": "wss://api.example.com/ws",
    });
  });

  test("should continue WebSocket and record a hook error when startSpanHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const next = vi.fn(() => Promise.resolve(makeWsSession()));
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => {
        throw new Error("start hook failed");
      },
    });

    await interceptor.fn(makeWsRequest(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
      "url.full": "wss://api.example.com/ws",
    });
    expect(spans[0]?.addEvent).toHaveBeenCalledWith("defjs.otel.hook.error", {
      "error.type": "Error",
      "hook.name": "startSpanHook",
    });
  });

  test("should add websocket.connected event on success", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("websocket.connected");
  });

  test("should keep span open until session.closed settles", async () => {
    const { tracer, spans } = createMockTracer();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session));

    expect(spans[0]?.ended).toBe(false);

    ws.close();
    await waitForSettledPromises();

    expect(spans[0]?.ended).toBe(true);
  });

  test("should record websocket.closed and end span when session closes normally", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session));
    ws.close();
    await waitForSettledPromises();

    expect(spans[0]?.addEvent).toHaveBeenCalledWith(
      "websocket.closed",
      undefined,
    );
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "success",
        "server.address": "api.example.com",
        "server.port": 443,
      }),
    );
  });

  test("should record error when session.closed rejects", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session));
    ws.reject(new TypeError("connection lost"));
    await waitForSettledPromises();

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("websocket.error", {
      "error.type": "TypeError",
    });
    expect(spans[0]?.recordException).toHaveBeenCalled();
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "TypeError",
      }),
    );
  });

  test("should record error when session.closed resolves with a close cause", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session));
    ws.close({
      code: 1006,
      cause: new TypeError("connection lost"),
      kind: "error",
      reason: "abnormal",
      wasClean: false,
    });
    await waitForSettledPromises();

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("websocket.error", {
      "error.type": "TypeError",
    });
    expect(spans[0]?.recordException).toHaveBeenCalled();
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "TypeError",
      }),
    );
  });

  test.each([
    { close: "aborted", cause: undefined },
    { close: "aborted", cause: new DOMException("cancelled", "AbortError") },
    { close: "rejected", cause: ERR_ABORTED },
  ] as const)(
    "should record websocket.aborted without marking span as error: $close $cause",
    async ({ close, cause }) => {
      const { tracer, spans } = createMockTracer();
      const metrics = createMockMetrics();
      const ws = makeDeferredWsSession();
      const interceptor = createOpenTelemetryWebSocketInterceptor({
        tracer,
        propagator: mockPropagator,
        metrics,
      });

      await interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session));
      if (close === "rejected") ws.reject(cause);
      else ws.close({ kind: close, cause });
      await waitForSettledPromises();

      expect(spans[0]?.addEvent).toHaveBeenCalledWith(
        "websocket.aborted",
        undefined,
      );
      expect(spans[0]?.recordException).not.toHaveBeenCalled();
      expect(spans[0]?.status).toBeUndefined();
      expect(spans[0]?.attributes["error.type"]).toBeUndefined();
      expect(spans[0]?.ended).toBe(true);
      expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "server.address": "api.example.com",
          "server.port": 443,
          "defjs.result": "aborted",
        },
      );
    },
  );

  test("should record a timed-out session as an error with error.type timeout", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session));
    ws.close({ kind: "error", cause: ERR_TIMEOUT });
    await waitForSettledPromises();

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("websocket.error", {
      "error.type": "timeout",
    });
    expect(spans[0]?.status?.code).toBe(2);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "timeout",
      }),
    );
  });

  test("should record a startup timeout fault as an error with error.type timeout", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });
    const fault = createNetworkFault(ERR_TIMEOUT);

    await expect(
      interceptor.fn(makeWsRequest(), () => Promise.reject(fault)),
    ).rejects.toBe(fault);

    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.attributes["error.type"]).toBe("timeout");
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "timeout",
      }),
    );
  });

  test("should record a cancelled startup as websocket.aborted without marking span as error", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await expect(
      interceptor.fn(makeWsRequest(), () => Promise.reject(ERR_ABORTED)),
    ).rejects.toBe(ERR_ABORTED);

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("websocket.aborted");
    expect(spans[0]?.recordException).not.toHaveBeenCalled();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        "server.address": "api.example.com",
        "server.port": 443,
        "defjs.result": "aborted",
      },
    );
  });

  test("should record error on next() exception", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await expect(
      interceptor.fn(makeWsRequest(), () =>
        Promise.reject(new TypeError("connect failed")),
      ),
    ).rejects.toThrow("connect failed");

    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.status?.code).toBe(2); // ERROR
    expect(spans[0]?.recordException).toHaveBeenCalled();
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "TypeError",
      }),
    );
    expect(metrics.active.add).not.toHaveBeenCalled();
  });

  test("should skip span creation when requireParentSpan and no active span", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      requireParentSpan: true,
    });

    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));
    await interceptor.fn(makeWsRequest(), next);

    expect(spans).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("should leave existing query state unchanged when queryPropagation is omitted", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = makeWsRequest(new URLSearchParams({ room: "alpha" }));
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));

    await interceptor.fn(req, next);

    expect(method(mockPropagator, "inject")).not.toHaveBeenCalled();
    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].query?.get("traceparent")).toBeNull();
    expect(calls[0]?.[0].query).toBe(req.query);
  });

  test("should keep the query unchanged when propagator injects nothing", async () => {
    const { tracer } = createMockTracer();
    const noOpPropagator: TextMapPropagator = {
      inject: vi.fn(),
      extract: vi.fn((ctx: Context) => ctx),
      fields: vi.fn(() => []),
    };
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: noOpPropagator,
      queryPropagation: true,
    });

    const req = makeWsRequest(new URLSearchParams({ room: "alpha" }));
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].query?.toString()).toBe("room=alpha");
  });

  test("should fall back to an empty query when missing and nothing injected", async () => {
    const { tracer } = createMockTracer();
    const noOpPropagator: TextMapPropagator = {
      inject: vi.fn(),
      extract: vi.fn((ctx: Context) => ctx),
      fields: vi.fn(() => []),
    };
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: noOpPropagator,
      queryPropagation: true,
    });

    const req = { ...makeWsRequest(), query: undefined };
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].query?.toString()).toBe("");
  });

  test("should call requestHook before request", async () => {
    const { tracer, spans } = createMockTracer();
    const requestHook = vi.fn();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    });

    const req = makeWsRequest();
    await interceptor.fn(req, () => Promise.resolve(makeWsSession()));

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(requestHook).toHaveBeenCalledWith(spans[0], req);
  });

  test("should call responseHook after session returned", async () => {
    const { tracer, spans } = createMockTracer();
    const responseHook = vi.fn();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      responseHook,
    });

    const session = makeWsSession();
    const req = makeWsRequest();
    await interceptor.fn(req, () => Promise.resolve(session));

    expect(responseHook).toHaveBeenCalledTimes(1);
    expect(responseHook).toHaveBeenCalledWith(spans[0], session, req);
  });

  test("should keep session open when requestHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const ws = makeDeferredWsSession();
    const requestHook = vi.fn(() => {
      throw new Error("hook failed");
    });
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    });

    const result = await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(ws.session),
    );

    expect(result).toBe(ws.session);
    expect(spans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      expect.objectContaining({ "hook.name": "requestHook" }),
    );
    expect(spans[0]?.recordException).toHaveBeenCalled();

    ws.close();
    await waitForSettledPromises();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
  });

  test("should keep session open when responseHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const responseHook = vi.fn(() => {
      throw new Error("hook failed");
    });
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
      responseHook,
    });

    const result = await interceptor.fn(makeWsRequest(), () =>
      Promise.resolve(ws.session),
    );

    expect(result).toBe(ws.session);
    expect(spans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      expect.objectContaining({ "hook.name": "responseHook" }),
    );
    expect(metrics.connectDuration.record).toHaveBeenCalled();

    ws.close();
    await waitForSettledPromises();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
  });

  test("should record connect duration and active connections on success", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session));

    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "success",
        "server.address": "api.example.com",
        "server.port": 443,
      }),
    );
    expect(metrics.active.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
  });

  test("should decrement active connections exactly once when session closes", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), () => Promise.resolve(ws.session));
    ws.close();
    await waitForSettledPromises();
    ws.close();
    await waitForSettledPromises();

    expect(metrics.active.add).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(metrics.active.add).toHaveBeenNthCalledWith(
      2,
      -1,
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(metrics.active.add).toHaveBeenCalledTimes(2);
  });

  test("should keep metric attributes low-cardinality", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(
      makeWsRequest(new URLSearchParams({ room: "alpha" })),
      () => Promise.resolve(ws.session),
    );

    const call = vi.mocked(metrics.connectDuration.record).mock.calls[0];
    const attributes: unknown = call?.[1];

    expect(attributes).toEqual(
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(attributes).not.toHaveProperty("url.full");
    expect(attributes).not.toHaveProperty("traceparent");
    expect(attributes).not.toHaveProperty("queryString");
  });

  test("should fall back to endpoint on invalid baseEndpoint", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = { ...makeWsRequest(), baseEndpoint: "not-a-url" };
    await interceptor.fn(req, () => Promise.resolve(makeWsSession()));

    expect(spans[0]?.attributes["url.full"]).toBe("/ws");
  });

  test("should extract from empty Headers when req.headers is undefined", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = { ...makeWsRequest(), headers: undefined };
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));

    await interceptor.fn(req, next);

    expect(method(mockPropagator, "extract")).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Headers),
      expect.anything(),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("WebSocket query propagation with W3C propagators", () => {
  const propagator = new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
  const staleTraceparent =
    "00-11111111111111111111111111111111-2222222222222222-01";
  const currentTraceparent =
    "00-aabbccddeeff00112233445566778899-aabbccddeeff0011-01";

  afterEach(() => vi.restoreAllMocks());

  async function intercept(
    req: HttpRequest,
    baggage?: string,
  ): Promise<HttpRequest> {
    const { tracer } = createMockTracer();
    if (baggage) {
      vi.spyOn(context, "active").mockReturnValue(
        propagation.setBaggage(
          ROOT_CONTEXT,
          propagation.createBaggage({ tenant: { value: baggage } }),
        ),
      );
    }
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));
    await createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator,
      queryPropagation: true,
    }).fn(req, next);
    const sent = next.mock.calls[0]?.[0];
    if (!sent) throw new Error("Expected next to be called");
    return sent;
  }

  const pairsOf = (params: URLSearchParams | undefined) =>
    Array.from(params ?? []);

  const queryOf = (query: string) => makeWsRequest(new URLSearchParams(query));

  test("replaces same-name propagation parameters instead of appending after them", async () => {
    const sent = await intercept(
      queryOf(
        `room=alpha&traceparent=${staleTraceparent}&baggage=tenant%3Dold`,
      ),
      "new",
    );

    expect(pairsOf(sent.query)).toEqual([
      ["room", "alpha"],
      ["traceparent", currentTraceparent],
      ["baggage", "tenant=new"],
    ]);
  });

  test("drops every earlier pair of the same name", async () => {
    const sent = await intercept(
      queryOf(`traceparent=first&room=alpha&traceparent=${staleTraceparent}`),
    );

    expect(pairsOf(sent.query)).toEqual([
      ["room", "alpha"],
      ["traceparent", currentTraceparent],
    ]);
  });

  test("keeps every other parameter, in order", async () => {
    const sent = await intercept(
      queryOf(
        `space=hello%20world&traceparent=${staleTraceparent}&path=a%2Fb&tag=x&tag=y`,
      ),
    );

    expect(pairsOf(sent.query)).toEqual([
      ["space", "hello world"],
      ["path", "a/b"],
      ["tag", "x"],
      ["tag", "y"],
      ["traceparent", currentTraceparent],
    ]);
  });

  test("matches percent-encoded names the way the receiver decodes them", async () => {
    const sent = await intercept(
      queryOf(`room=alpha&trace%70arent=${staleTraceparent}`),
    );

    expect(pairsOf(sent.query)).toEqual([
      ["room", "alpha"],
      ["traceparent", currentTraceparent],
    ]);
  });

  test("keeps a pair whose name only resembles an injected one", async () => {
    const sent = await intercept(
      makeWsRequest(
        new URLSearchParams([
          ["?traceparent", "application-data"],
          ["traceparent", "stale"],
        ]),
      ),
    );

    expect(pairsOf(sent.query)).toEqual([
      ["?traceparent", "application-data"],
      ["traceparent", currentTraceparent],
    ]);
  });

  test("keeps a propagation parameter the propagator has nothing to inject for", async () => {
    const sent = await intercept(queryOf("baggage=tenant%3Dkept&room=alpha"));

    expect(pairsOf(sent.query)).toEqual([
      ["baggage", "tenant=kept"],
      ["room", "alpha"],
      ["traceparent", currentTraceparent],
    ]);
  });
});
