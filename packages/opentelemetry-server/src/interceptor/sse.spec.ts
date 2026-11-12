import type { HttpRequest } from "@defjs/core";
import { createNetworkFault, ERR_ABORTED, ERR_TIMEOUT } from "@defjs/core";
import { context, diag, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createMockMetrics,
  createMockLogger,
  createMockPropagator,
  createMockTracer,
  makeDeferredSSEStream,
  makeSSERequest,
  makeSSEStream,
  waitForSettledPromises,
} from "../../test/mocks";
import { createOpenTelemetrySSEInterceptor } from "./sse";
import { method } from "../../test/method";

let mockPropagator: ReturnType<typeof createMockPropagator>;

describe("SSE client diagnostic logs", () => {
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
      const interceptor = createOpenTelemetrySSEInterceptor({
        logger,
        propagator: createMockPropagator(),
      });
      await expect(
        interceptor.fn(makeSSERequest(), () => Promise.reject(cause)),
      ).rejects.toBe(cause);
      expect(records).toHaveLength(count);
      if (count)
        expect(records[0]).toMatchObject({
          eventName: "defjs.client.sse.exception",
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
      const stream = makeDeferredSSEStream();
      const interceptor = createOpenTelemetrySSEInterceptor({
        logger,
        tracer: tracing ? tracer : undefined,
        metrics,
        propagator: createMockPropagator(),
      });
      await expect(
        interceptor.fn(makeSSERequest(), () => Promise.resolve(stream.stream)),
      ).resolves.toBe(stream.stream);
      expect(records).toEqual([]);
      active.mockReturnValue(ROOT_CONTEXT);
      const cause = new TypeError("private failure");
      if (rejected) stream.reject(cause);
      else stream.close("error", cause, "CAP_BUFFER_EXCEEDED");
      await waitForSettledPromises();
      stream.close("error", cause);
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
      expect(record.attributes?.["defjs.sse.fault.code"]).toBe(
        rejected ? undefined : "CAP_BUFFER_EXCEEDED",
      );
      if (tracing) expect(trace.getSpan(record.context)).toBe(spans[0]);
      else expect(record.context).toBe(parent);
      expect(
        metrics.activeStreams.add.mock.calls.map((call) => {
          const value: unknown = call[0];
          return value;
        }),
      ).toEqual([1, -1]);
      expect(metrics.connectionDuration.record).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["eof", "aborted"] as const)(
    "does not log %s even if it carries an error cause",
    async (kind) => {
      const { logger, records } = createMockLogger();
      const stream = makeDeferredSSEStream();
      const interceptor = createOpenTelemetrySSEInterceptor({
        logger,
        propagator: createMockPropagator(),
      });
      await interceptor.fn(makeSSERequest(), () =>
        Promise.resolve(stream.stream),
      );
      stream.close(kind, new Error("user decided to stop"));
      await waitForSettledPromises();
      expect(records).toEqual([]);
    },
  );

  test.each([false, true])(
    "logger failure preserves closed outcome, rejected=%s",
    async (rejected) => {
      const { logger } = createMockLogger();
      logger.emit.mockImplementation(() => {
        throw new Error("logger failed");
      });
      vi.spyOn(diag, "error").mockImplementation(() => undefined);
      const { tracer, spans } = createMockTracer();
      const metrics = createMockMetrics();
      const stream = makeDeferredSSEStream();
      const interceptor = createOpenTelemetrySSEInterceptor({
        logger,
        tracer,
        metrics,
        propagator: createMockPropagator(),
      });
      await expect(
        interceptor.fn(makeSSERequest(), () => Promise.resolve(stream.stream)),
      ).resolves.toBe(stream.stream);
      const cause = new Error("original");
      if (rejected) {
        stream.reject(cause);
        await expect(stream.stream.closed).rejects.toBe(cause);
      } else {
        stream.close("error", cause);
        await expect(stream.stream.closed).resolves.toMatchObject({
          kind: "error",
          cause,
        });
      }
      await waitForSettledPromises();
      expect(logger.emit).toHaveBeenCalledTimes(1);
      expect(spans[0]?.ended).toBe(true);
      expect(
        metrics.activeStreams.add.mock.calls.map((call) => {
          const value: unknown = call[0];
          return value;
        }),
      ).toEqual([1, -1]);
    },
  );
});

describe("createOpenTelemetrySSEInterceptor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPropagator = createMockPropagator();
  });

  test.each([
    { close: "eof", result: "success", extras: { "sse.close.kind": "eof" } },
    {
      close: "aborted",
      result: "success",
      extras: { "sse.close.kind": "aborted" },
    },
    {
      close: "error",
      result: "error",
      extras: {
        "sse.close.kind": "error",
        "defjs.sse.fault.code": "CAP_BUFFER_EXCEEDED",
        "error.type": "TypeError",
      },
    },
    {
      close: "rejected",
      result: "error",
      extras: { "error.type": "TypeError" },
    },
  ] as const)(
    "records SSE $close lifecycle without a tracer",
    async ({ close, result, extras }) => {
      const metrics = createMockMetrics();
      const stream = makeDeferredSSEStream();
      const interceptor = createOpenTelemetrySSEInterceptor({
        propagator: mockPropagator,
        metrics,
        requireParentSpan: true,
      });
      await expect(
        interceptor.fn(makeSSERequest(), () => Promise.resolve(stream.stream)),
      ).resolves.toBe(stream.stream);
      expect(metrics.connectDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "server.address": "api.example.com",
          "server.port": 443,
          "defjs.result": "success",
        },
      );
      expect(metrics.activeStreams.add.mock.calls).toEqual([
        [1, { "server.address": "api.example.com", "server.port": 443 }],
      ]);
      expect(metrics.connectionDuration.record).not.toHaveBeenCalled();

      if (close === "rejected") stream.reject(new TypeError("stream lost"));
      else
        stream.close(
          close,
          close === "error" ? new TypeError("stream lost") : undefined,
          "CAP_BUFFER_EXCEEDED",
        );
      await waitForSettledPromises();

      expect(metrics.activeStreams.add.mock.calls).toEqual([
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

  test("records SSE startup failure without a tracer without incrementing active streams", async () => {
    const metrics = createMockMetrics();
    const error = new TypeError("connect failed");
    const interceptor = createOpenTelemetrySSEInterceptor({
      propagator: mockPropagator,
      metrics,
    });
    await expect(
      interceptor.fn(makeSSERequest(), () => Promise.reject(error)),
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
    expect(metrics.activeStreams.add).not.toHaveBeenCalled();
    expect(metrics.connectionDuration.record).not.toHaveBeenCalled();
  });

  test("should inject traceparent header via propagator", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = makeSSERequest();
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeSSEStream()));

    await interceptor.fn(req, next);

    expect(method(mockPropagator, "inject")).toHaveBeenCalled();
    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].headers?.get("traceparent")).toBe("mock-trace-id");
  });

  test("should create span with correct name", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(makeSSEStream()),
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("SSE");
  });

  test("should set url.full attribute", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(makeSSEStream()),
    );

    expect(spans[0]?.attributes["url.full"]).toBe(
      "https://api.example.com/events",
    );
  });

  test.each([
    ["https://api.example.com", "api.example.com", 443],
    ["https://api.example.com:8443", "api.example.com", 8443],
    ["http://localhost:8080", "localhost", 8080],
    ["http://localhost", "localhost", 80],
  ])(
    "should put server.address and server.port on the SSE span when it is created, base %s",
    async (baseEndpoint, address, port) => {
      const { tracer } = createMockTracer();
      const interceptor = createOpenTelemetrySSEInterceptor({
        tracer,
        propagator: mockPropagator,
      });

      await interceptor.fn({ ...makeSSERequest(), baseEndpoint }, () =>
        Promise.resolve(makeSSEStream()),
      );

      expect(
        vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
      ).toMatchObject({ "server.address": address, "server.port": port });
    },
  );

  test.each([
    ["GET", { "http.request.method": "GET" }],
    ["POST", { "http.request.method": "POST" }],
    [
      "post",
      { "http.request.method": "POST", "http.request.method_original": "post" },
    ],
    [
      "FOO",
      {
        "http.request.method": "_OTHER",
        "http.request.method_original": "FOO",
      },
    ],
  ])(
    "should put http.request.method on the SSE span when it is created, method %s",
    async (requestMethod, expected) => {
      const { tracer } = createMockTracer();
      const interceptor = createOpenTelemetrySSEInterceptor({
        tracer,
        propagator: mockPropagator,
      });

      await interceptor.fn({ ...makeSSERequest(), method: requestMethod }, () =>
        Promise.resolve(makeSSEStream()),
      );

      expect(
        vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
      ).toMatchObject(expected);
    },
  );

  test("should let startSpanHook override http.request.method on the SSE span", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => ({ "http.request.method": "POST" }),
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(makeSSEStream()),
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toMatchObject({ "http.request.method": "POST" });
  });

  test("should not write server attributes on the SSE span without a base endpoint", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn({ ...makeSSERequest(), baseEndpoint: undefined }, () =>
      Promise.resolve(makeSSEStream()),
    );

    const attributes = vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]
      ?.attributes;
    expect(attributes).not.toHaveProperty("server.address");
    expect(attributes).not.toHaveProperty("server.port");
  });

  test("should let startSpanHook override the built-in SSE server attributes", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => ({
        "server.address": "tenant.example.com",
        "server.port": 9443,
      }),
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(makeSSEStream()),
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
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(
      {
        ...makeSSERequest(),
        baseEndpoint: "https://svc-user:S3cretPassw0rd@api.example.com",
      },
      () => Promise.resolve(makeSSEStream()),
    );

    expect(spans[0]?.attributes["url.full"]).toBe(
      "https://REDACTED:REDACTED@api.example.com/events",
    );
  });

  test("should merge startSpanHook attributes last into initial SSE span options", async () => {
    const { tracer } = createMockTracer();
    const req = makeSSERequest();
    const startSpanHook = vi.fn(() => ({
      "app.tenant": "acme",
      "url.full": "https://tenant.example.com/events",
    }));
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook,
    });

    await interceptor.fn(req, () => Promise.resolve(makeSSEStream()));

    expect(startSpanHook).toHaveBeenCalledWith(req);
    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "app.tenant": "acme",
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
      "url.full": "https://tenant.example.com/events",
    });
  });

  test("should keep the resolved SSE URL in initial span options when startSpanHook is absent", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(makeSSEStream()),
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
      "url.full": "https://api.example.com/events",
    });
  });

  test("should continue SSE and record a hook error when startSpanHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const next = vi.fn(() => Promise.resolve(makeSSEStream()));
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => {
        throw new Error("start hook failed");
      },
    });

    await interceptor.fn(makeSSERequest(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
      "url.full": "https://api.example.com/events",
    });
    expect(spans[0]?.addEvent).toHaveBeenCalledWith("defjs.otel.hook.error", {
      "error.type": "Error",
      "hook.name": "startSpanHook",
    });
  });

  test("should add sse.connected event on success", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(makeSSEStream()),
    );

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("sse.connected", undefined);
  });

  test("should keep span open until stream.closed settles", async () => {
    const { tracer, spans } = createMockTracer();
    const stream = makeDeferredSSEStream();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );

    expect(spans[0]?.ended).toBe(false);

    stream.close();
    await waitForSettledPromises();

    expect(spans[0]?.ended).toBe(true);
  });

  test("should record sse.closed and end span when stream closes normally", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const stream = makeDeferredSSEStream();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );
    stream.close("eof");
    await waitForSettledPromises();

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("sse.closed", {
      "sse.close.kind": "eof",
    });
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "success",
        "server.address": "api.example.com",
        "server.port": 443,
        "sse.close.kind": "eof",
      }),
    );
  });

  test("should record sse.aborted without marking span as error", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const stream = makeDeferredSSEStream();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );
    stream.close("aborted");
    await waitForSettledPromises();

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("sse.aborted", {
      "sse.close.kind": "aborted",
    });
    expect(spans[0]?.recordException).not.toHaveBeenCalled();
    expect(spans[0]?.status).toBeUndefined();
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "success",
        "sse.close.kind": "aborted",
      }),
    );
  });

  test("should record error when stream closes with error code", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const stream = makeDeferredSSEStream();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );
    stream.close("error", new Error("stream broken"), "CAP_BUFFER_EXCEEDED");
    await waitForSettledPromises();

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("sse.error", {
      "defjs.sse.fault.code": "CAP_BUFFER_EXCEEDED",
      "error.type": "Error",
      "sse.close.kind": "error",
    });
    expect(spans[0]?.recordException).toHaveBeenCalled();
    expect(spans[0]?.status?.code).toBe(2);
    expect(spans[0]?.ended).toBe(true);
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "error",
        "defjs.sse.fault.code": "CAP_BUFFER_EXCEEDED",
        "error.type": "Error",
        "sse.close.kind": "error",
      }),
    );
  });

  test("should record error when stream.closed rejects", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const stream = makeDeferredSSEStream();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );
    stream.reject(new TypeError("rejected"));
    await waitForSettledPromises();

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("sse.error", {
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

  test("should record error on next() exception", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await expect(
      interceptor.fn(makeSSERequest(), () =>
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
    expect(metrics.activeStreams.add).not.toHaveBeenCalled();
  });

  test("should skip span creation when requireParentSpan and no active span", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      requireParentSpan: true,
    });

    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeSSEStream()));
    await interceptor.fn(makeSSERequest(), next);

    expect(spans).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("should call requestHook before request", async () => {
    const { tracer, spans } = createMockTracer();
    const requestHook = vi.fn();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    });

    const req = makeSSERequest();
    await interceptor.fn(req, () => Promise.resolve(makeSSEStream()));

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(requestHook).toHaveBeenCalledWith(spans[0], req);
  });

  test("should call responseHook after stream returned", async () => {
    const { tracer, spans } = createMockTracer();
    const responseHook = vi.fn();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      responseHook,
    });

    const stream = makeSSEStream();
    const req = makeSSERequest();
    await interceptor.fn(req, () => Promise.resolve(stream));

    expect(responseHook).toHaveBeenCalledTimes(1);
    expect(responseHook).toHaveBeenCalledWith(spans[0], stream, req);
  });

  test("should keep stream open when requestHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const stream = makeDeferredSSEStream();
    const requestHook = vi.fn(() => {
      throw new Error("hook failed");
    });
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    });

    const result = await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );

    expect(result).toBe(stream.stream);
    expect(spans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      expect.objectContaining({ "hook.name": "requestHook" }),
    );
    expect(spans[0]?.recordException).toHaveBeenCalled();

    stream.close();
    await waitForSettledPromises();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
  });

  test("should keep stream open when responseHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const stream = makeDeferredSSEStream();
    const responseHook = vi.fn(() => {
      throw new Error("hook failed");
    });
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
      responseHook,
    });

    const result = await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );

    expect(result).toBe(stream.stream);
    expect(spans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      expect.objectContaining({ "hook.name": "responseHook" }),
    );
    expect(metrics.connectDuration.record).toHaveBeenCalled();

    stream.close();
    await waitForSettledPromises();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
  });

  test("should record connect duration and active streams on success", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const stream = makeDeferredSSEStream();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );

    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "defjs.result": "success",
        "server.address": "api.example.com",
        "server.port": 443,
      }),
    );
    expect(metrics.activeStreams.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
  });

  test("should decrement active streams exactly once when stream closes", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const stream = makeDeferredSSEStream();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );
    stream.close();
    await waitForSettledPromises();
    stream.close();
    await waitForSettledPromises();

    expect(metrics.activeStreams.add).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(metrics.activeStreams.add).toHaveBeenNthCalledWith(
      2,
      -1,
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(metrics.activeStreams.add).toHaveBeenCalledTimes(2);
  });

  test("should keep metric attributes low-cardinality", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const stream = makeDeferredSSEStream();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeSSERequest(), () =>
      Promise.resolve(stream.stream),
    );

    const call = vi.mocked(metrics.connectDuration.record).mock.calls[0];
    const attributes: unknown = call?.[1];

    expect(attributes).toEqual(
      expect.objectContaining({ "server.address": "api.example.com" }),
    );
    expect(attributes).not.toHaveProperty("url.full");
    expect(attributes).not.toHaveProperty("traceparent");
  });

  test("should fall back to endpoint on invalid baseEndpoint", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = { ...makeSSERequest(), baseEndpoint: "not-a-url" };
    await interceptor.fn(req, () => Promise.resolve(makeSSEStream()));

    expect(spans[0]?.attributes["url.full"]).toBe("/events");
  });

  test.each([false, true])(
    "should copy existing Headers without changing the caller with tracer=%s",
    async (tracing) => {
      const { tracer } = createMockTracer();
      const interceptor = createOpenTelemetrySSEInterceptor({
        tracer: tracing ? tracer : undefined,
        propagator: mockPropagator,
      });

      const existingHeaders = new Headers({ "x-custom": "value" });
      const req = { ...makeSSERequest(), headers: existingHeaders };
      const next = vi.fn((_req: HttpRequest) =>
        Promise.resolve(makeSSEStream()),
      );

      await interceptor.fn(req, next);

      const calls = vi.mocked(next).mock.calls;
      expect(calls[0]?.[0]?.headers).not.toBe(existingHeaders);
      expect(calls[0]?.[0]?.headers?.get("x-custom")).toBe("value");
      expect(calls[0]?.[0]?.headers?.get("traceparent")).toBe("mock-trace-id");
      expect(req.headers).toBe(existingHeaders);
      expect([...existingHeaders]).toEqual([["x-custom", "value"]]);
    },
  );

  test("should create Headers when req.headers is undefined", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = { ...makeSSERequest(), headers: undefined };
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeSSEStream()));

    await interceptor.fn(req, next);

    expect(method(mockPropagator, "extract")).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Headers),
      expect.anything(),
    );
    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0]?.headers).toBeInstanceOf(Headers);
    expect(calls[0]?.[0]?.headers?.get("traceparent")).toBe("mock-trace-id");
  });
});
