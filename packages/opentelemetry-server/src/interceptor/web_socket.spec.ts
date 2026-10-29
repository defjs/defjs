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
  trace,
} from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  activeSpans,
  createMockMetrics,
  createMockLogger,
  createMockTracer,
  makeDeferredWsSession,
  makeWsRequest,
  makeWsSession,
  waitForSettledPromises,
} from "../test-utils";
import { createOpenTelemetryWebSocketInterceptor } from "./web_socket";
import {
  resolveTransportQuery,
  resolveRequestUrl,
} from "../../../core/src/internal/url";

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
        interceptor.fn(makeWsRequest(), async () => {
          throw cause;
        }),
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
        interceptor.fn(makeWsRequest(), async () => session.session),
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
        metrics.activeConnections.add.mock.calls.map(([value]) => value),
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
      await interceptor.fn(makeWsRequest(), async () => session.session);
      session.close({ kind, cause: new Error("user decided to stop") });
      await waitForSettledPromises();
      expect(records).toEqual([]);
    },
  );

  test("retains legacy close-cause diagnostics without manufacturing normal-close logs", async () => {
    const { logger, records } = createMockLogger();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      logger,
      propagator: createMockWsPropagator(),
    });
    for (const info of [
      undefined,
      {},
      { cause: new Error("offline"), code: 1006 },
    ]) {
      const session = makeDeferredWsSession();
      await interceptor.fn(makeWsRequest(), async () => session.session);
      session.close(info as never);
      await waitForSettledPromises();
    }
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes?.["websocket.close.code"]).toBe(1006);
  });

  test.each(["emit", "close-code", "rejected"] as const)(
    "preserves termination when logging fails in %s",
    async (failure) => {
      const { logger } = createMockLogger();
      if (failure !== "close-code")
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
        interceptor.fn(makeWsRequest(), async () => session.session),
      ).resolves.toBe(session.session);
      const cause = new Error("original");
      if (failure === "rejected") {
        session.reject(cause);
        await expect(session.session.closed).rejects.toBe(cause);
      } else {
        session.close({
          kind: "error",
          cause,
          get code(): number | undefined {
            if (failure === "close-code")
              throw new Error("private close getter");
            return undefined;
          },
        });
        await expect(session.session.closed).resolves.toMatchObject({
          kind: "error",
          cause,
        });
      }
      await waitForSettledPromises();
      expect(report).toHaveBeenCalledTimes(1);
      expect(spans[0]?.ended).toBe(true);
      expect(
        metrics.activeConnections.add.mock.calls.map(([value]) => value),
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
    { close: "aborted", result: "error", extras: { "error.type": "Error" } },
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
        interceptor.fn(makeWsRequest(), async () => ws.session),
      ).resolves.toBe(ws.session);
      expect(metrics.connectDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "server.address": "api.example.com",
          "defjs.result": "success",
        },
      );
      expect(metrics.activeConnections.add.mock.calls).toEqual([
        [1, { "server.address": "api.example.com" }],
      ]);
      expect(metrics.connectionDuration.record).not.toHaveBeenCalled();

      if (close === "rejected") ws.reject(new TypeError("connection lost"));
      else if (close === "error")
        ws.close({ kind: "error", cause: new TypeError("connection lost") });
      else ws.close({ kind: close });
      await waitForSettledPromises();

      expect(metrics.activeConnections.add.mock.calls).toEqual([
        [1, { "server.address": "api.example.com" }],
        [-1, { "server.address": "api.example.com" }],
      ]);
      expect(metrics.connectionDuration.record).toHaveBeenCalledTimes(1);
      expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "server.address": "api.example.com",
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
      interceptor.fn(makeWsRequest(), async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(metrics.connectDuration.record).toHaveBeenCalledTimes(1);
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        "server.address": "api.example.com",
        "defjs.result": "error",
        "error.type": "TypeError",
      },
    );
    expect(metrics.activeConnections.add).not.toHaveBeenCalled();
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
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());

    await interceptor.fn(req, next);

    expect(mockPropagator.extract).toHaveBeenCalled();
  });

  test("should inject propagation fields into query params when explicitly enabled", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      queryPropagation: true,
    });

    const req = makeWsRequest();
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());

    await interceptor.fn(req, next);

    expect(mockPropagator.inject).toHaveBeenCalled();
    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].queryParams?.get("traceparent")).toBe("mock-trace-id");
    expect(calls[0]?.[0].queryParams?.get("tracestate")).toBe("vendor=value");
    expect(calls[0]?.[0].queryParams?.get("baggage")).toBe("tenant=acme");
    expect(calls[0]?.[0].queryString).toBe(
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
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].queryParams?.get("room")).toBe("alpha");
    expect(calls[0]?.[0].queryParams?.get("traceparent")).toBe("mock-trace-id");
  });

  test("should append propagation params without rewriting existing queryString", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      queryPropagation: true,
    });

    const req = {
      ...makeWsRequest(
        new URLSearchParams([
          ["room", "alpha"],
          ["space", "hello world"],
        ]),
      ),
      queryString: "space=hello%20world&room=alpha",
    };
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].queryParams?.get("traceparent")).toBe("mock-trace-id");
    expect(calls[0]?.[0].queryString).toBe(
      "space=hello%20world&room=alpha&traceparent=mock-trace-id&tracestate=vendor%3Dvalue&baggage=tenant%3Dacme",
    );
  });

  test("should create span with correct name", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), async () => makeWsSession());

    expect(activeSpans).toHaveLength(1);
    expect(activeSpans[0]?.name).toBe("WebSocket");
  });

  test("should set url.full attribute", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), async () => makeWsSession());

    expect(activeSpans[0]?.attributes["url.full"]).toBe(
      "wss://api.example.com/ws",
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

    await interceptor.fn(req, async () => makeWsSession());

    expect(startSpanHook).toHaveBeenCalledWith(req);
    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      "app.tenant": "acme",
      "url.full": "wss://tenant.example.com/socket",
    });
  });

  test("should keep the resolved WebSocket URL in initial span options when startSpanHook is absent", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), async () => makeWsSession());

    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      "url.full": "wss://api.example.com/ws",
    });
  });

  test("should continue WebSocket and record a hook error when startSpanHook throws", async () => {
    const { tracer } = createMockTracer();
    const next = vi.fn(async () => makeWsSession());
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => {
        throw new Error("start hook failed");
      },
    });

    await interceptor.fn(makeWsRequest(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      "url.full": "wss://api.example.com/ws",
    });
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      {
        "error.type": "Error",
        "hook.name": "startSpanHook",
      },
    );
  });

  test("should add websocket.connected event on success", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), async () => makeWsSession());

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith(
      "websocket.connected",
    );
  });

  test("should keep span open until session.closed settles", async () => {
    const { tracer } = createMockTracer();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeWsRequest(), async () => ws.session);

    expect(activeSpans[0]?.ended).toBe(false);

    ws.close();
    await waitForSettledPromises();

    expect(activeSpans[0]?.ended).toBe(true);
  });

  test("should record websocket.closed and end span when session closes normally", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), async () => ws.session);
    ws.close();
    await waitForSettledPromises();

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith("websocket.closed");
    expect(activeSpans[0]?.status?.code).toBe(1);
    expect(activeSpans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "success",
        "server.address": "api.example.com",
      }),
    );
  });

  test("should treat a legacy close info without kind or cause as closed", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), async () => ws.session);
    ws.close({
      code: 1000,
      reason: "legacy normal close",
      wasClean: true,
    } as never);
    await waitForSettledPromises();

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith("websocket.closed");
    expect(activeSpans[0]?.recordException).not.toHaveBeenCalled();
    expect(activeSpans[0]?.status?.code).toBe(1);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ "defjs.result": "success" }),
    );
  });

  test("should treat a non-object legacy close result as closed", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), async () => ws.session);
    ws.close(null as never);
    await waitForSettledPromises();

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith("websocket.closed");
    expect(activeSpans[0]?.recordException).not.toHaveBeenCalled();
    expect(activeSpans[0]?.status?.code).toBe(1);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ "defjs.result": "success" }),
    );
  });

  test("should treat a legacy close info cause as an error", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const closeCause = new TypeError("legacy connection failure");
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), async () => ws.session);
    ws.close({ cause: closeCause, code: 1006, wasClean: false } as never);
    await waitForSettledPromises();

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith("websocket.error", {
      "error.type": "TypeError",
    });
    expect(activeSpans[0]?.recordException).toHaveBeenCalledWith(closeCause);
    expect(activeSpans[0]?.status?.code).toBe(2);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "TypeError",
      }),
    );
  });

  test("should record error when session.closed rejects", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), async () => ws.session);
    ws.reject(new TypeError("connection lost"));
    await waitForSettledPromises();

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith("websocket.error", {
      "error.type": "TypeError",
    });
    expect(activeSpans[0]?.recordException).toHaveBeenCalled();
    expect(activeSpans[0]?.status?.code).toBe(2);
    expect(activeSpans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "TypeError",
      }),
    );
  });

  test("should record error when session.closed resolves with a close cause", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), async () => ws.session);
    ws.close({
      code: 1006,
      cause: new TypeError("connection lost"),
      kind: "error",
      reason: "abnormal",
      wasClean: false,
    });
    await waitForSettledPromises();

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith("websocket.error", {
      "error.type": "TypeError",
    });
    expect(activeSpans[0]?.recordException).toHaveBeenCalled();
    expect(activeSpans[0]?.status?.code).toBe(2);
    expect(activeSpans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "TypeError",
      }),
    );
  });

  test("should record an aborted session without a cause as an error", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const ws = makeDeferredWsSession();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeWsRequest(), async () => ws.session);
    ws.close({ kind: "aborted" });
    await waitForSettledPromises();

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith("websocket.error", {
      "error.type": "Error",
    });
    expect(activeSpans[0]?.recordException).toHaveBeenCalledWith(ERR_ABORTED);
    expect(activeSpans[0]?.status?.code).toBe(2);
    expect(activeSpans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "Error",
      }),
    );
  });

  test("should record error on next() exception", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await expect(
      interceptor.fn(makeWsRequest(), async () => {
        throw new TypeError("connect failed");
      }),
    ).rejects.toThrow("connect failed");

    expect(activeSpans[0]?.ended).toBe(true);
    expect(activeSpans[0]?.status?.code).toBe(2); // ERROR
    expect(activeSpans[0]?.recordException).toHaveBeenCalled();
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "error.type": "TypeError",
      }),
    );
    expect(metrics.activeConnections.add).not.toHaveBeenCalled();
  });

  test("should skip span creation when requireParentSpan and no active span", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      requireParentSpan: true,
    });

    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());
    await interceptor.fn(makeWsRequest(), next);

    expect(activeSpans).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("should leave existing query state unchanged when queryPropagation is omitted", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = {
      ...makeWsRequest(new URLSearchParams({ room: "alpha" })),
      queryString: "room=alpha",
    };
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());

    await interceptor.fn(req, next);

    expect(mockPropagator.inject).not.toHaveBeenCalled();
    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].queryParams?.get("traceparent")).toBeNull();
    expect(calls[0]?.[0].queryParams).toBe(req.queryParams);
    expect(calls[0]?.[0].queryString).toBe("room=alpha");
  });

  test("should keep queryString unchanged when propagator injects nothing", async () => {
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
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].queryParams?.get("room")).toBe("alpha");
    expect(calls[0]?.[0].queryString).toBe("room=alpha");
  });

  test("should fall back to empty queryString when missing and nothing injected", async () => {
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

    const req = { ...makeWsRequest(), queryString: undefined };
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].queryString).toBe("");
  });

  test("should call requestHook before request", async () => {
    const { tracer } = createMockTracer();
    const requestHook = vi.fn();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    });

    const req = makeWsRequest();
    await interceptor.fn(req, async () => makeWsSession());

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(requestHook).toHaveBeenCalledWith(activeSpans[0], req);
  });

  test("should call responseHook after session returned", async () => {
    const { tracer } = createMockTracer();
    const responseHook = vi.fn();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      responseHook,
    });

    const session = makeWsSession();
    const req = makeWsRequest();
    await interceptor.fn(req, async () => session);

    expect(responseHook).toHaveBeenCalledTimes(1);
    expect(responseHook).toHaveBeenCalledWith(activeSpans[0], session, req);
  });

  test("should keep session open when requestHook throws", async () => {
    const { tracer } = createMockTracer();
    const ws = makeDeferredWsSession();
    const requestHook = vi.fn(() => {
      throw new Error("hook failed");
    });
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    });

    const result = await interceptor.fn(
      makeWsRequest(),
      async () => ws.session,
    );

    expect(result).toBe(ws.session);
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      expect.objectContaining({ "hook.name": "requestHook" }),
    );
    expect(activeSpans[0]?.recordException).toHaveBeenCalled();

    ws.close();
    await waitForSettledPromises();
    expect(activeSpans[0]?.status?.code).toBe(1);
    expect(activeSpans[0]?.ended).toBe(true);
  });

  test("should keep session open when responseHook throws", async () => {
    const { tracer } = createMockTracer();
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

    const result = await interceptor.fn(
      makeWsRequest(),
      async () => ws.session,
    );

    expect(result).toBe(ws.session);
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      expect.objectContaining({ "hook.name": "responseHook" }),
    );
    expect(metrics.connectDuration.record).toHaveBeenCalled();

    ws.close();
    await waitForSettledPromises();
    expect(activeSpans[0]?.status?.code).toBe(1);
    expect(activeSpans[0]?.ended).toBe(true);
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

    await interceptor.fn(makeWsRequest(), async () => ws.session);

    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "success",
        "server.address": "api.example.com",
      }),
    );
    expect(metrics.activeConnections.add).toHaveBeenCalledWith(
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

    await interceptor.fn(makeWsRequest(), async () => ws.session);
    ws.close();
    await waitForSettledPromises();
    ws.close();
    await waitForSettledPromises();

    expect(metrics.activeConnections.add).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(metrics.activeConnections.add).toHaveBeenNthCalledWith(
      2,
      -1,
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(metrics.activeConnections.add).toHaveBeenCalledTimes(2);
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
      async () => ws.session,
    );

    const call = vi.mocked(metrics.connectDuration.record).mock.calls[0];
    const attributes = call?.[1];

    expect(attributes).toEqual(
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(attributes).not.toHaveProperty("url.full");
    expect(attributes).not.toHaveProperty("traceparent");
    expect(attributes).not.toHaveProperty("queryString");
  });

  test("should fall back to endpoint on invalid baseEndpoint", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = { ...makeWsRequest(), baseEndpoint: "not-a-url" };
    await interceptor.fn(req, async () => makeWsSession());

    expect(activeSpans[0]?.attributes["url.full"]).toBe("/ws");
  });

  test("should extract from empty Headers when req.headers is undefined", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryWebSocketInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = { ...makeWsRequest(), headers: undefined };
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());

    await interceptor.fn(req, next);

    expect(mockPropagator.extract).toHaveBeenCalledWith(
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

  // Mirrors core: both query forms present, queryString being the serialized form that reaches the socket URL.
  function makeQueryRequest(queryString: string): HttpRequest {
    return { ...makeWsRequest(new URLSearchParams(queryString)), queryString };
  }

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
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());
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

  test("replaces same-name propagation parameters instead of appending after them", async () => {
    const sent = await intercept(
      makeQueryRequest(
        `room=alpha&traceparent=${staleTraceparent}&baggage=tenant%3Dold`,
      ),
      "new",
    );

    expect(sent.queryString).toBe(
      `room=alpha&traceparent=${currentTraceparent}&baggage=tenant%3Dnew`,
    );
    expect(pairsOf(sent.queryParams)).toEqual(
      pairsOf(new URLSearchParams(sent.queryString)),
    );
  });

  test("drops every earlier pair of the same name", async () => {
    const sent = await intercept(
      makeQueryRequest(
        `traceparent=first&room=alpha&traceparent=${staleTraceparent}`,
      ),
    );

    expect(sent.queryString).toBe(
      `room=alpha&traceparent=${currentTraceparent}`,
    );
    expect(sent.queryParams?.getAll("traceparent")).toEqual([
      currentTraceparent,
    ]);
  });

  test("keeps the serialized form of every other parameter", async () => {
    const sent = await intercept(
      makeQueryRequest(
        `space=hello%20world&traceparent=${staleTraceparent}&path=a%2Fb&tag=x&tag=y`,
      ),
    );

    expect(sent.queryString).toBe(
      `space=hello%20world&path=a%2Fb&tag=x&tag=y&traceparent=${currentTraceparent}`,
    );
    expect(pairsOf(sent.queryParams)).toEqual(
      pairsOf(new URLSearchParams(sent.queryString)),
    );
  });

  test("matches percent-encoded names the way the receiver decodes them", async () => {
    const sent = await intercept(
      makeQueryRequest(`room=alpha&trace%70arent=${staleTraceparent}`),
    );

    expect(sent.queryString).toBe(
      `room=alpha&traceparent=${currentTraceparent}`,
    );
  });

  test.each([
    [
      "room=alpha&?traceparent=application-data&traceparent=stale",
      "room=alpha&?traceparent=application-data",
    ],
    [
      "traceparent=stale&?traceparent=application-data",
      "??traceparent=application-data",
    ],
    [
      "?traceparent=stale&?traceparent=application-data",
      "??traceparent=application-data",
    ],
    [
      "??traceparent=application-data&trace%70arent=stale",
      "??traceparent=application-data",
    ],
    [
      "room=a+b&&%3Ftraceparent=application-data&traceparent=stale&tag=%2f&tag=two&",
      "room=a+b&&%3Ftraceparent=application-data&tag=%2f&tag=two&",
    ],
    [
      "&&traceparent=stale&&flag&=empty&trace%70arent=duplicate&",
      "&&&flag&=empty&",
    ],
  ])(
    "preserves querySerializer bytes and decoded key identity for %s",
    async (serialized, kept) => {
      const query = resolveTransportQuery({ room: "alpha" }, () => serialized);
      const req = { ...makeWsRequest(), ...query };
      const sent = await intercept(req);

      expect(sent.queryString).toBe(
        `${kept}&traceparent=${currentTraceparent}`,
      );
      const before = new URLSearchParams(serialized);
      const received = resolveRequestUrl(sent).searchParams;
      const unaffected = [...before].filter(([key]) => key !== "traceparent");
      expect([...received]).toEqual([
        ...unaffected,
        ["traceparent", currentTraceparent],
      ]);
      expect(pairsOf(sent.queryParams)).toEqual([...received]);
    },
  );

  test("keeps a propagation parameter the propagator has nothing to inject for", async () => {
    const sent = await intercept(
      makeQueryRequest("baggage=tenant%3Dkept&room=alpha"),
    );

    expect(sent.queryString).toBe(
      `baggage=tenant%3Dkept&room=alpha&traceparent=${currentTraceparent}`,
    );
  });

  test("derives the query string from queryParams when queryString is absent", async () => {
    const req = {
      ...makeWsRequest(
        new URLSearchParams({ room: "alpha", traceparent: staleTraceparent }),
      ),
      queryString: undefined,
    };
    const sent = await intercept(req);

    expect(sent.queryString).toBe(
      `room=alpha&traceparent=${currentTraceparent}`,
    );
    expect(pairsOf(sent.queryParams)).toEqual(
      pairsOf(new URLSearchParams(sent.queryString)),
    );
  });
});
