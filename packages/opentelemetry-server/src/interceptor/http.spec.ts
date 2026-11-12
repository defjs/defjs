import type { HttpRequest } from "@defjs/core";
import {
  createClient,
  createHttpInterceptor,
  createNetworkFault,
  defineRequest,
  ERR_ABORTED,
  ERR_TIMEOUT,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "@defjs/core";
import {
  context,
  diag,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createMockLogger,
  createMockMetrics,
  createMockPropagator,
  createMockTracer,
  makeHttpRequest,
  makeHttpResponse,
} from "../../test/mocks";
import { withOpenTelemetryServer } from "../option";
import { createOpenTelemetryHttpInterceptor } from "./http";
import { method } from "../../test/method";

let mockPropagator: ReturnType<typeof createMockPropagator>;

describe("HTTP client diagnostic logs", () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([false, true])(
    "records the saved context and original cause with tracer=%s",
    async (tracing) => {
      const { logger, records } = createMockLogger();
      const { tracer, spans } = createMockTracer();
      const parent = trace.setSpanContext(ROOT_CONTEXT, {
        traceId: "11111111111111111111111111111111",
        spanId: "2222222222222222",
        traceFlags: 0,
      });
      const active = vi.spyOn(context, "active").mockReturnValue(parent);
      const interceptor = createOpenTelemetryHttpInterceptor({
        logger,
        tracer: tracing ? tracer : undefined,
        propagator: createMockPropagator(),
      });
      const cause = new TypeError("private network detail");
      await expect(
        interceptor.fn(makeHttpRequest(), () => {
          active.mockReturnValue(ROOT_CONTEXT);
          return Promise.reject(cause);
        }),
      ).rejects.toBe(cause);
      expect(records).toHaveLength(1);
      const record = records[0];
      if (!record?.context)
        throw new Error("Expected a log record with explicit context");
      expect(record).toMatchObject({
        eventName: "http.client.request.exception",
        severityNumber: 13,
        severityText: "WARN",
        attributes: { "defjs.phase": "request", "exception.type": "TypeError" },
      });
      if (tracing) expect(trace.getSpan(record.context)).toBe(spans[0]);
      else expect(record.context).toBe(parent);
    },
  );

  test.each([
    ERR_ABORTED,
    new DOMException("cancelled", "AbortError"),
    createNetworkFault(ERR_ABORTED),
  ])("does not log cancellation: %s", async (cause) => {
    const { logger, records } = createMockLogger();
    const interceptor = createOpenTelemetryHttpInterceptor({
      logger,
      propagator: createMockPropagator(),
    });
    await expect(
      interceptor.fn(makeHttpRequest(), () => Promise.reject(cause)),
    ).rejects.toBe(cause);
    expect(records).toEqual([]);
  });

  test("still logs a timeout when the request signal is aborted", async () => {
    const { logger, records } = createMockLogger();
    const interceptor = createOpenTelemetryHttpInterceptor({
      logger,
      propagator: createMockPropagator(),
    });
    await expect(
      interceptor.fn(
        { ...makeHttpRequest(), signal: AbortSignal.abort(ERR_TIMEOUT) },
        () => Promise.reject(ERR_TIMEOUT),
      ),
    ).rejects.toBe(ERR_TIMEOUT);
    expect(records).toHaveLength(1);
    expect(records[0]?.severityNumber).toBe(13);
  });

  test.each([200, 404, 500, 0])(
    "does not manufacture an exception log for status %s",
    async (status) => {
      const { logger, records } = createMockLogger();
      const interceptor = createOpenTelemetryHttpInterceptor({
        logger,
        propagator: createMockPropagator(),
      });
      const response = { ...makeHttpResponse(), status };
      await expect(
        interceptor.fn(makeHttpRequest(), () => Promise.resolve(response)),
      ).resolves.toBe(response);
      expect(records).toEqual([]);
    },
  );

  test("logger failure preserves the original rejection and other telemetry", async () => {
    const { logger } = createMockLogger();
    logger.emit.mockImplementation(() => {
      throw new Error("logger failed");
    });
    vi.spyOn(diag, "error").mockImplementation(() => undefined);
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const cause = new Error("network failed");
    const interceptor = createOpenTelemetryHttpInterceptor({
      logger,
      tracer,
      metrics,
      propagator: createMockPropagator(),
    });
    await expect(
      interceptor.fn(makeHttpRequest(), () => Promise.reject(cause)),
    ).rejects.toBe(cause);
    expect(logger.emit).toHaveBeenCalledTimes(1);
    expect(spans[0]?.ended).toBe(true);
    expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1);
  });
});

describe("createOpenTelemetryHttpInterceptor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPropagator = createMockPropagator();
  });

  test("preserves inferred body media type for a signing interceptor after trace propagation", async () => {
    let signedType: string | null = null;
    let contentType: string | null = null;
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createOpenTelemetryHttpInterceptor({ propagator: mockPropagator }),
        createHttpInterceptor((request, next) => {
          request.headers?.set(
            "x-signed-content-type",
            request.bodyContentType ?? "missing",
          );
          return next(request);
        }),
      ),
      withHTTPHandle((input) => {
        if (!(input instanceof Request))
          throw new TypeError("expected a Request");
        signedType = input.headers.get("x-signed-content-type");
        contentType = input.headers.get("content-type");
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    const request = defineRequest({
      builder: () => ({ body: { signed: true } }),
      method: "POST",
      path: "/",
    });
    const [fault] = await request(client);

    expect(fault).toBeNull();
    expect(method(mockPropagator, "inject")).toHaveBeenCalled();
    expect(signedType).toBe("application/json");
    expect(contentType).toBe(signedType);
  });

  test("records one span and one request hook for a base call and a derived call", async () => {
    const { tracer, spans } = createMockTracer();
    const requestHook = vi.fn();
    const base = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      ),
      withOpenTelemetryServer({ tracer, http: { requestHook } }),
    );
    const derived = base({ signal: new AbortController().signal });
    const readInventory = defineRequest({ method: "GET", path: "/inventory" });

    expect(typeof base).toBe("function");
    expect(typeof derived).toBe("object");
    expect(derived).not.toBe(base);

    const [baseFault] = await readInventory(base);
    expect(baseFault).toBeNull();
    expect(spans).toHaveLength(1);
    expect(requestHook).toHaveBeenCalledTimes(1);

    const [derivedFault] = await readInventory(derived);
    expect(derivedFault).toBeNull();
    expect(spans).toHaveLength(2);
    expect(requestHook).toHaveBeenCalledTimes(2);
  });

  test("should inject traceparent header via propagator", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = makeHttpRequest();
    const next = vi.fn((_req: HttpRequest) =>
      Promise.resolve(makeHttpResponse()),
    );

    await interceptor.fn(req, next);

    expect(method(mockPropagator, "inject")).toHaveBeenCalled();
    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].headers?.get("traceparent")).toBe("mock-trace-id");
  });

  test.each([200, 404, 500, 0])(
    "records HTTP status %s without a tracer and preserves the response",
    async (status) => {
      const metrics = createMockMetrics();
      const response = { ...makeHttpResponse(), status };
      const interceptor = createOpenTelemetryHttpInterceptor({
        propagator: mockPropagator,
        metrics,
      });

      await expect(
        interceptor.fn(makeHttpRequest(), () => Promise.resolve(response)),
      ).resolves.toBe(response);

      expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1);
      expect(metrics.requestDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "http.request.method": "GET",
          "server.address": "api.example.com",
          "server.port": 443,
          ...(status === 0 ? {} : { "http.response.status_code": status }),
          ...(status >= 400 ? { "error.type": String(status) } : {}),
        },
      );
    },
  );

  test("records a transport rejection without a tracer and rethrows the original cause", async () => {
    const metrics = createMockMetrics();
    const error = new TypeError("connection failed");
    const interceptor = createOpenTelemetryHttpInterceptor({
      propagator: mockPropagator,
      metrics,
    });

    await expect(
      interceptor.fn(makeHttpRequest(), () => Promise.reject(error)),
    ).rejects.toBe(error);

    expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1);
    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        "http.request.method": "GET",
        "server.address": "api.example.com",
        "server.port": 443,
        "error.type": "TypeError",
      },
    );
  });

  test("uses only the explicit operation as the metric identity", async () => {
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryHttpInterceptor({
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(
      { ...makeHttpRequest(), endpoint: "/users/42", operation: "users.read" },
      () => Promise.resolve(makeHttpResponse()),
    );

    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        "defjs.operation": "users.read",
        "http.request.method": "GET",
        "http.response.status_code": 200,
        "server.address": "api.example.com",
        "server.port": 443,
      },
    );
  });

  test("records error.type _OTHER on the duration sample when the rejection carries no error", async () => {
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryHttpInterceptor({
      propagator: mockPropagator,
      metrics,
    });

    await expect(
      interceptor.fn(makeHttpRequest(), () =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- INTENT: the rejection must be undefined to prove a failed sample still carries error.type
        Promise.reject(undefined),
      ),
    ).rejects.toBeUndefined();

    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        "http.request.method": "GET",
        "server.address": "api.example.com",
        "server.port": 443,
        "error.type": "_OTHER",
      },
    );
  });

  test("should create span with correct name", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("GET");
  });

  test.each([
    ["GET", "GET", { "http.request.method": "GET" }],
    [
      "get",
      "GET",
      { "http.request.method": "GET", "http.request.method_original": "get" },
    ],
    [
      "PROPFIND",
      "HTTP",
      {
        "http.request.method": "_OTHER",
        "http.request.method_original": "PROPFIND",
      },
    ],
  ])(
    "normalizes http.request.method on the span, the metric and the log for method %s",
    async (requestMethod, name, expected) => {
      const { tracer, spans } = createMockTracer();
      const { logger, records } = createMockLogger();
      const metrics = createMockMetrics();
      const interceptor = createOpenTelemetryHttpInterceptor({
        tracer,
        logger,
        metrics,
        propagator: mockPropagator,
      });
      const error = new TypeError("connection failed");

      await expect(
        interceptor.fn({ ...makeHttpRequest(), method: requestMethod }, () =>
          Promise.reject(error),
        ),
      ).rejects.toBe(error);

      expect(spans[0]?.name).toBe(name);
      expect(
        vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
      ).toEqual({
        ...expected,
        "server.address": "api.example.com",
        "server.port": 443,
        "url.full": "https://api.example.com/test",
      });
      expect(metrics.requestDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "http.request.method": expected["http.request.method"],
          "server.address": "api.example.com",
          "server.port": 443,
          "error.type": "TypeError",
        },
      );
      expect(records[0]?.attributes?.["http.request.method"]).toBe(
        expected["http.request.method"],
      );
    },
  );

  test("should set span attributes", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );

    expect(spans[0]?.attributes["http.request.method"]).toBe("GET");
    expect(spans[0]?.attributes["url.full"]).toBe(
      "https://api.example.com/test",
    );
  });

  test("should replace endpoint userinfo in url.full and keep server attributes", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(
      {
        ...makeHttpRequest(),
        baseEndpoint: "https://svc-user:S3cretPassw0rd@api.example.com:8443",
      },
      () => Promise.resolve(makeHttpResponse()),
    );

    expect(spans[0]?.attributes["url.full"]).toBe(
      "https://REDACTED:REDACTED@api.example.com:8443/test",
    );
    expect(spans[0]?.attributes["server.address"]).toBe("api.example.com");
    expect(spans[0]?.attributes["server.port"]).toBe(8443);
  });

  test("should merge startSpanHook attributes last into initial HTTP span options", async () => {
    const { tracer } = createMockTracer();
    const req = {
      ...makeHttpRequest(),
      baseEndpoint: "https://api.example.com:8443",
    };
    const startSpanHook = vi.fn(() => ({
      "app.tenant": "acme",
      "server.address": "tenant.example.com",
      "server.port": 9443,
      "url.full": "https://tenant.example.com/custom",
    }));
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook,
    });

    await interceptor.fn(req, () => Promise.resolve(makeHttpResponse()));

    expect(startSpanHook).toHaveBeenCalledWith(req);
    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "app.tenant": "acme",
      "http.request.method": "GET",
      "server.address": "tenant.example.com",
      "server.port": 9443,
      "url.full": "https://tenant.example.com/custom",
    });
  });

  test("should keep the resolved HTTP URL initial and omit req.query when startSpanHook is absent", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });
    const req = {
      ...makeHttpRequest(),
      query: new URLSearchParams({ tenant: "acme" }),
    };

    await interceptor.fn(req, () => Promise.resolve(makeHttpResponse()));

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
      "url.full": "https://api.example.com/test",
    });
  });

  test("should preserve a literal query already present in the endpoint URL", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(
      { ...makeHttpRequest(), endpoint: "/test?literal=kept" },
      () => Promise.resolve(makeHttpResponse()),
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes?.[
        "url.full"
      ],
    ).toBe("/test?literal=kept");
  });

  test("should let startSpanHook explicitly include req.query in url.full", async () => {
    const { tracer } = createMockTracer();
    const req = {
      ...makeHttpRequest(),
      query: new URLSearchParams({ tenant: "acme" }),
    };
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: (request) => ({
        "url.full": `${request.baseEndpoint}${request.endpoint}?${request.query}`,
      }),
    });

    await interceptor.fn(req, () => Promise.resolve(makeHttpResponse()));

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes?.[
        "url.full"
      ],
    ).toBe("https://api.example.com/test?tenant=acme");
  });

  test("should continue HTTP and record a hook error when startSpanHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const next = vi.fn(() => Promise.resolve(makeHttpResponse()));
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => {
        throw new Error("start hook failed");
      },
    });

    await interceptor.fn(makeHttpRequest(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({
      "http.request.method": "GET",
      "server.address": "api.example.com",
      "server.port": 443,
      "url.full": "https://api.example.com/test",
    });
    expect(spans[0]?.addEvent).toHaveBeenCalledWith("defjs.otel.hook.error", {
      "error.type": "Error",
      "hook.name": "startSpanHook",
    });
  });

  test("should continue HTTP when startSpanHook throws undefined", async () => {
    const { tracer, spans } = createMockTracer();
    const next = vi.fn(() => Promise.resolve(makeHttpResponse()));
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- INTENT: startSpanHook must be fed a thrown undefined, which is not an Error
        throw undefined;
      },
    });

    await interceptor.fn(makeHttpRequest(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(spans[0]?.addEvent).toHaveBeenCalledWith("defjs.otel.hook.error", {
      "error.type": "_OTHER",
      "hook.name": "startSpanHook",
    });
  });

  test("should leave span status unset on success", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );

    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.status).toBeUndefined();
  });

  test("should end span on 5xx status with ERROR", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve({
        ...makeHttpResponse(),
        status: 500,
      }),
    );

    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.attributes["error.type"]).toBe("500");
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
  });

  test("should end client span on 4xx status with ERROR", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve({
        ...makeHttpResponse(),
        status: 404,
      }),
    );

    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.attributes["error.type"]).toBe("404");
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
  });

  test("should leave a status-0 response unattributed for spans and metrics", async () => {
    // Transport failures reject now, so a status-0 response can only be a synthetic one an
    // interceptor built, and it carries nothing to attribute.
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });
    const response = { ...makeHttpResponse(), status: 0 };

    await expect(
      interceptor.fn(makeHttpRequest(), () => Promise.resolve(response)),
    ).resolves.toBe(response);

    expect(spans[0]?.attributes["http.response.status_code"]).toBeUndefined();
    expect(spans[0]?.attributes["error.type"]).toBeUndefined();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        "http.request.method": "GET",
        "server.address": "api.example.com",
        "server.port": 443,
      },
    );
  });

  test("should record error on exception", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await expect(
      interceptor.fn(makeHttpRequest(), () =>
        Promise.reject(new Error("network error")),
      ),
    ).rejects.toThrow("network error");

    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.attributes["error.type"]).toBe("Error");
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.recordException).toHaveBeenCalled();
  });

  test.each([
    ERR_ABORTED,
    new DOMException("cancelled", "AbortError"),
    createNetworkFault(ERR_ABORTED),
  ])(
    "records caller cancellation as http.aborted, not a failure: %s",
    async (cause) => {
      const { tracer, spans } = createMockTracer();
      const metrics = createMockMetrics();
      const interceptor = createOpenTelemetryHttpInterceptor({
        tracer,
        metrics,
        propagator: mockPropagator,
      });

      await expect(
        interceptor.fn(makeHttpRequest(), () => Promise.reject(cause)),
      ).rejects.toBe(cause);

      expect(spans[0]?.addEvent).toHaveBeenCalledWith("http.aborted");
      expect(spans[0]?.status).toBeUndefined();
      expect(spans[0]?.attributes["error.type"]).toBeUndefined();
      expect(spans[0]?.recordException).not.toHaveBeenCalled();
      expect(spans[0]?.ended).toBe(true);
      expect(metrics.requestDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        {
          "http.request.method": "GET",
          "server.address": "api.example.com",
          "server.port": 443,
        },
      );
    },
  );

  test.each([ERR_TIMEOUT, new DOMException("timed out", "TimeoutError")])(
    "records a timeout as a failure with error.type timeout: %s",
    async (cause) => {
      const { tracer, spans } = createMockTracer();
      const metrics = createMockMetrics();
      const interceptor = createOpenTelemetryHttpInterceptor({
        tracer,
        metrics,
        propagator: mockPropagator,
      });

      await expect(
        interceptor.fn(
          { ...makeHttpRequest(), signal: AbortSignal.abort(cause) },
          () => Promise.reject(cause),
        ),
      ).rejects.toBe(cause);

      expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
      expect(spans[0]?.attributes["error.type"]).toBe("timeout");
      expect(spans[0]?.recordException).toHaveBeenCalledTimes(1);
      expect(metrics.requestDuration.record).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ "error.type": "timeout" }),
      );
    },
  );

  test("should pass request with headers to next", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = makeHttpRequest();
    const next = vi.fn((_req: HttpRequest) =>
      Promise.resolve(makeHttpResponse()),
    );

    await interceptor.fn(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0].method).toBe("GET");
    expect(calls[0]?.[0].endpoint).toBe("/test");
    expect(calls[0]?.[0].headers).toBeInstanceOf(Headers);
  });

  test("should skip span creation when requireParentSpan and no active span", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      requireParentSpan: true,
    });

    const next = vi.fn((_req: HttpRequest) =>
      Promise.resolve(makeHttpResponse()),
    );
    await interceptor.fn(makeHttpRequest(), next);

    expect(spans).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("should call requestHook before request", async () => {
    const { tracer, spans } = createMockTracer();
    const requestHook = vi.fn();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    });

    const req = makeHttpRequest();
    await interceptor.fn(req, () => Promise.resolve(makeHttpResponse()));

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(requestHook).toHaveBeenCalledWith(spans[0], req);
  });

  test("should call responseHook before span ends", async () => {
    const { tracer, spans } = createMockTracer();
    let recordingDuringHook: boolean | undefined;
    const responseHook = vi.fn((span: { isRecording(): boolean }) => {
      recordingDuringHook = span.isRecording();
    });
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      responseHook,
    });

    const res = makeHttpResponse();
    const req = makeHttpRequest();
    await interceptor.fn(req, () => Promise.resolve(res));

    expect(responseHook).toHaveBeenCalledTimes(1);
    expect(responseHook).toHaveBeenCalledWith(spans[0], res, req);
    expect(recordingDuringHook).toBe(true);
    expect(spans[0]?.ended).toBe(true);
  });

  test("should keep request running when requestHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const requestHook = vi.fn(() => {
      throw new Error("hook failed");
    });
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    });

    const response = makeHttpResponse();
    const result = await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve(response),
    );

    expect(result).toBe(response);
    expect(spans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      expect.objectContaining({ "hook.name": "requestHook" }),
    );
    expect(spans[0]?.recordException).toHaveBeenCalled();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
  });

  test("should keep response running when responseHook throws", async () => {
    const { tracer, spans } = createMockTracer();
    const metrics = createMockMetrics();
    const responseHook = vi.fn(() => {
      throw new Error("hook failed");
    });
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
      responseHook,
    });

    const response = makeHttpResponse();
    const result = await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve(response),
    );

    expect(result).toBe(response);
    expect(spans[0]?.addEvent).toHaveBeenCalledWith(
      "defjs.otel.hook.error",
      expect.objectContaining({ "hook.name": "responseHook" }),
    );
    expect(metrics.requestDuration.record).toHaveBeenCalled();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
  });

  test("should record duration metrics on success", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );

    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "http.request.method": "GET",
        "http.response.status_code": 200,
        "server.address": "api.example.com",
        "server.port": 443,
      }),
    );
  });

  test("should record status code on non-2xx metrics", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve({
        ...makeHttpResponse(),
        status: 500,
      }),
    );

    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "error.type": "500",
        "http.response.status_code": 500,
      }),
    );
  });

  test("should record error attributes on exception metrics", async () => {
    const { tracer } = createMockTracer();
    const metrics = createMockMetrics();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    });

    await expect(
      interceptor.fn(makeHttpRequest(), () =>
        Promise.reject(new TypeError("fail")),
      ),
    ).rejects.toThrow("fail");

    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        "http.request.method": "GET",
        "error.type": "TypeError",
      }),
    );
  });

  test("should set server.address and server.port from URL", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );

    expect(spans[0]?.attributes["server.address"]).toBe("api.example.com");
  });

  test("should set the scheme default server.port when URL has no explicit port", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    await interceptor.fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );

    expect(spans[0]?.attributes["server.port"]).toBe(443);
  });

  test("should set server.port when URL has explicit port", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = {
      ...makeHttpRequest(),
      baseEndpoint: "https://api.example.com:8443",
    };
    await interceptor.fn(req, () => Promise.resolve(makeHttpResponse()));

    expect(spans[0]?.attributes["server.address"]).toBe("api.example.com");
    expect(spans[0]?.attributes["server.port"]).toBe(8443);
  });

  test("should fall back to endpoint on invalid baseEndpoint", async () => {
    const { tracer, spans } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = { ...makeHttpRequest(), baseEndpoint: "not-a-url" };
    await interceptor.fn(req, () => Promise.resolve(makeHttpResponse()));

    expect(spans[0]?.attributes["url.full"]).toBe("/test");
  });

  test.each([false, true])(
    "should copy existing Headers without changing the caller with tracer=%s",
    async (tracing) => {
      const { tracer } = createMockTracer();
      const interceptor = createOpenTelemetryHttpInterceptor({
        tracer: tracing ? tracer : undefined,
        propagator: mockPropagator,
      });

      const existingHeaders = new Headers({ "x-custom": "value" });
      const req = { ...makeHttpRequest(), headers: existingHeaders };
      const next = vi.fn((_req: HttpRequest) =>
        Promise.resolve(makeHttpResponse()),
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

  test("should create new Headers when req.headers is undefined", async () => {
    const { tracer } = createMockTracer();
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
    });

    const req = { ...makeHttpRequest(), headers: undefined };
    const next = vi.fn((_req: HttpRequest) =>
      Promise.resolve(makeHttpResponse()),
    );

    await interceptor.fn(req, next);

    const calls = vi.mocked(next).mock.calls;
    expect(calls[0]?.[0]?.headers).toBeInstanceOf(Headers);
    expect(calls[0]?.[0]?.headers?.get("traceparent")).toBe("mock-trace-id");
  });
});
