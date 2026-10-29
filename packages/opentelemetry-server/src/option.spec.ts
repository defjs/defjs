import type {
  ClientConfig,
  HttpInterceptor,
  HttpRequest,
  SSEInterceptor,
  WebSocketInterceptor,
} from "@defjs/core";
import type { Context, Meter, TextMapPropagator } from "@opentelemetry/api";
import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { withOpenTelemetryServer } from "./option";
import {
  createMockTracer,
  createMockLogger,
  makeHttpRequest,
  makeHttpResponse,
  makeSSERequest,
  makeSSEStream,
  makeWsRequest,
  makeWsSession,
  waitForSettledPromises,
} from "./test-utils";

function makeConfig(): ClientConfig {
  const sharedFetch = globalThis.fetch.bind(globalThis) as typeof fetch;

  return {
    endpoint: "https://api.example.com",
    http: { handle: sharedFetch },
    interceptors: [],
    sse: { handle: sharedFetch },
    webSocket: { handle: globalThis.WebSocket },
  };
}

function makeMeter(): Meter {
  return {
    createCounter: vi.fn(() => ({ add: vi.fn() })),
    createHistogram: vi.fn(() => ({ record: vi.fn() })),
    createGauge: vi.fn(() => ({ record: vi.fn() })),
    createUpDownCounter: vi.fn(() => ({ add: vi.fn() })),
    createObservableCounter: vi.fn(() => ({
      addCallback: vi.fn(),
      removeCallback: vi.fn(),
    })),
    createObservableGauge: vi.fn(() => ({
      addCallback: vi.fn(),
      removeCallback: vi.fn(),
    })),
    createObservableUpDownCounter: vi.fn(() => ({
      addCallback: vi.fn(),
      removeCallback: vi.fn(),
    })),
    addBatchObservableCallback: vi.fn(),
    removeBatchObservableCallback: vi.fn(),
  };
}

function makePropagator(): TextMapPropagator {
  return {
    inject: vi.fn(),
    extract: vi.fn(
      (ctx: Context, _carrier?: unknown, _getter?: unknown) => ctx,
    ),
    fields: vi.fn(() => ["traceparent"]),
  };
}

function httpInterceptor(config: ClientConfig): HttpInterceptor {
  const interceptor = config.interceptors.find((item) => item.kind === "http");
  if (interceptor?.kind !== "http") {
    throw new Error("Expected HTTP interceptor");
  }
  return interceptor;
}

function sseInterceptor(config: ClientConfig): SSEInterceptor {
  const interceptor = config.interceptors.find((item) => item.kind === "sse");
  if (interceptor?.kind !== "sse") {
    throw new Error("Expected SSE interceptor");
  }
  return interceptor;
}

function webSocketInterceptor(config: ClientConfig): WebSocketInterceptor {
  const interceptor = config.interceptors.find(
    (item) => item.kind === "web-socket",
  );
  if (interceptor?.kind !== "web-socket") {
    throw new Error("Expected WebSocket interceptor");
  }
  return interceptor;
}

describe("withOpenTelemetryServer logger", () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([false, true])(
    "records all transports with logger-only and requireParentSpan=%s",
    async (requireParentSpan) => {
      const { logger, records } = createMockLogger();
      const getTracer = vi.spyOn(trace, "getTracer");
      const getLogger = vi.spyOn(logs, "getLogger");
      const config = makeConfig();
      withOpenTelemetryServer({ logger, requireParentSpan })(config);
      const cause = new TypeError("offline");
      const reject = async () => {
        throw cause;
      };

      await expect(
        httpInterceptor(config).fn(makeHttpRequest(), reject),
      ).rejects.toBe(cause);
      await expect(
        sseInterceptor(config).fn(makeSSERequest(), reject),
      ).rejects.toBe(cause);
      await expect(
        webSocketInterceptor(config).fn(makeWsRequest(), reject),
      ).rejects.toBe(cause);

      expect(records.map((record) => record.eventName)).toEqual([
        "http.client.request.exception",
        "defjs.client.sse.exception",
        "defjs.client.websocket.exception",
      ]);
      expect(getTracer).not.toHaveBeenCalled();
      expect(getLogger).not.toHaveBeenCalled();
    },
  );

  test("preserves the explicit tracer parent-span bypass for logs", async () => {
    vi.spyOn(context, "active").mockReturnValue(ROOT_CONTEXT);
    const { logger, records } = createMockLogger();
    const config = makeConfig();
    withOpenTelemetryServer({
      logger,
      tracer: createMockTracer().tracer,
      requireParentSpan: true,
    })(config);
    const cause = new Error("offline");
    const reject = async () => {
      throw cause;
    };
    await expect(
      httpInterceptor(config).fn(makeHttpRequest(), reject),
    ).rejects.toBe(cause);
    await expect(
      sseInterceptor(config).fn(makeSSERequest(), reject),
    ).rejects.toBe(cause);
    await expect(
      webSocketInterceptor(config).fn(makeWsRequest(), reject),
    ).rejects.toBe(cause);
    expect(records).toEqual([]);
  });
});

describe("withOpenTelemetryServer without a tracer", () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([false, true])(
    "records every transport metric independently of requireParentSpan=%s",
    async (requireParentSpan) => {
      const record = vi.fn();
      const add = vi.fn();
      const meter = makeMeter();
      vi.mocked(meter.createHistogram).mockReturnValue({ record });
      vi.mocked(meter.createUpDownCounter).mockReturnValue({ add });
      vi.spyOn(context, "active").mockReturnValue(ROOT_CONTEXT);
      const config = makeConfig();
      withOpenTelemetryServer({ meter, requireParentSpan })(config);
      const response = makeHttpResponse();
      const stream = makeSSEStream();
      const session = makeWsSession();

      await expect(
        httpInterceptor(config).fn(makeHttpRequest(), async () => response),
      ).resolves.toBe(response);
      await expect(
        sseInterceptor(config).fn(makeSSERequest(), async () => stream),
      ).resolves.toBe(stream);
      await expect(
        webSocketInterceptor(config).fn(makeWsRequest(), async () => session),
      ).resolves.toBe(session);
      await waitForSettledPromises();

      expect(record).toHaveBeenCalledTimes(5);
      expect(record).toHaveBeenCalledWith(expect.any(Number), {
        "http.request.method": "GET",
        "http.response.status_code": 200,
        "server.address": "api.example.com",
      });
      expect(add.mock.calls).toEqual([
        [1, { "server.address": "api.example.com" }],
        [-1, { "server.address": "api.example.com" }],
        [1, { "server.address": "api.example.com" }],
        [-1, { "server.address": "api.example.com" }],
      ]);
    },
  );

  test("accepts empty options and does not acquire a global tracer", async () => {
    const getTracer = vi.spyOn(trace, "getTracer");
    const config = makeConfig();
    withOpenTelemetryServer({})(config);
    const response = makeHttpResponse();
    const stream = makeSSEStream();
    const session = makeWsSession();

    await expect(
      httpInterceptor(config).fn(makeHttpRequest(), async () => response),
    ).resolves.toBe(response);
    await expect(
      sseInterceptor(config).fn(makeSSERequest(), async () => stream),
    ).resolves.toBe(stream);
    await expect(
      webSocketInterceptor(config).fn(makeWsRequest(), async () => session),
    ).resolves.toBe(session);
    await waitForSettledPromises();

    expect(getTracer).not.toHaveBeenCalled();
  });

  test.each([
    {
      source: "headers",
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
      baggage: "tenant=acme",
    },
    {
      source: "active",
      traceparent: "00-aabbccddeeff00112233445566778899-aabbccddeeff0011-01",
      baggage: "tenant=acme",
    },
    { source: "baggage", traceparent: null, baggage: "tenant=acme" },
    { source: "empty", traceparent: null, baggage: null },
  ])(
    "propagates $source context without creating or modifying a span",
    async ({ source, traceparent, baggage }) => {
      const { tracer } = createMockTracer();
      const parent = tracer.startSpan("upstream");
      let parentCtx =
        source === "active" || source === "headers"
          ? trace.setSpan(ROOT_CONTEXT, parent)
          : ROOT_CONTEXT;
      if (source === "active" || source === "baggage") {
        parentCtx = propagation.setBaggage(
          parentCtx,
          propagation.createBaggage({ tenant: { value: "acme" } }),
        );
      }
      vi.spyOn(context, "active").mockReturnValue(parentCtx);
      const getTracer = vi.spyOn(trace, "getTracer");
      const startSpanHook = vi.fn(() => {
        throw new Error("start hook must not run");
      });
      const requestHook = vi.fn(() => {
        throw new Error("request hook must not run");
      });
      const responseHook = vi.fn(() => {
        throw new Error("response hook must not run");
      });
      const hooks = { startSpanHook, requestHook, responseHook };
      const config = makeConfig();
      withOpenTelemetryServer({
        http: hooks,
        sse: hooks,
        webSocket: { ...hooks, queryPropagation: true },
      })(config);
      const headers = new Headers({ "x-custom": "preserved" });
      if (source === "headers") {
        headers.set(
          "traceparent",
          "00-11111111111111111111111111111111-2222222222222222-01",
        );
        headers.set("tracestate", "vendor=value");
        headers.set("baggage", "tenant=acme");
      }
      const httpNext = vi.fn(async (_req: HttpRequest) => makeHttpResponse());
      const sseNext = vi.fn(async (_req: HttpRequest) => makeSSEStream());
      const wsNext = vi.fn(async (_req: HttpRequest) => makeWsSession());

      await httpInterceptor(config).fn(
        makeHttpRequest(new Headers(headers)),
        httpNext,
      );
      await sseInterceptor(config).fn(
        makeSSERequest(new Headers(headers)),
        sseNext,
      );
      await webSocketInterceptor(config).fn(
        {
          ...makeWsRequest(new URLSearchParams({ room: "a b" }), headers),
          queryString: "room=a%20b",
        },
        wsNext,
      );
      await waitForSettledPromises();

      for (const next of [httpNext, sseNext]) {
        const sent = next.mock.calls[0]?.[0].headers;
        expect(sent?.get("traceparent")).toBe(traceparent);
        expect(sent?.get("baggage")).toBe(baggage);
        expect(sent?.get("tracestate")).toBe(
          source === "headers" ? "vendor=value" : null,
        );
        expect(sent?.get("x-custom")).toBe("preserved");
      }
      const sent = wsNext.mock.calls[0]?.[0];
      expect(sent?.queryString?.startsWith("room=a%20b")).toBe(true);
      expect(new URLSearchParams(sent?.queryString).get("traceparent")).toBe(
        traceparent,
      );
      expect(new URLSearchParams(sent?.queryString).get("baggage")).toBe(
        baggage,
      );
      expect(sent?.queryParams?.get("traceparent")).toBe(traceparent);
      expect(sent?.queryParams?.get("tracestate")).toBe(
        source === "headers" ? "vendor=value" : null,
      );
      expect(tracer.startSpan).toHaveBeenCalledTimes(1);
      expect(getTracer).not.toHaveBeenCalled();
      expect(startSpanHook).not.toHaveBeenCalled();
      expect(requestHook).not.toHaveBeenCalled();
      expect(responseHook).not.toHaveBeenCalled();
      expect(parent.end).not.toHaveBeenCalled();
      expect(parent.setStatus).not.toHaveBeenCalled();
      expect(parent.setAttribute).not.toHaveBeenCalled();
      expect(parent.addEvent).not.toHaveBeenCalled();
      expect(parent.recordException).not.toHaveBeenCalled();
    },
  );

  test("leaves WebSocket query bytes unchanged when propagation is not enabled", async () => {
    const config = makeConfig();
    withOpenTelemetryServer({})(config);
    const req = {
      ...makeWsRequest(
        new URLSearchParams({ room: "a b" }),
        new Headers({
          traceparent:
            "00-11111111111111111111111111111111-2222222222222222-01",
        }),
      ),
      queryString: "room=a%20b",
    };
    const next = vi.fn(async (_req: HttpRequest) => makeWsSession());
    await webSocketInterceptor(config).fn(req, next);
    expect(next.mock.calls[0]?.[0].queryString).toBe("room=a%20b");
    expect(next.mock.calls[0]?.[0].queryParams).toBe(req.queryParams);
    expect(req.queryParams?.get("traceparent")).toBeNull();
  });

  test("preserves the full requireParentSpan bypass for an explicitly supplied tracer", async () => {
    vi.spyOn(context, "active").mockReturnValue(ROOT_CONTEXT);
    const { tracer } = createMockTracer();
    const meter = makeMeter();
    const record = vi.fn();
    const add = vi.fn();
    vi.mocked(meter.createHistogram).mockReturnValue({ record });
    vi.mocked(meter.createUpDownCounter).mockReturnValue({ add });
    const propagator = makePropagator();
    const config = makeConfig();
    withOpenTelemetryServer({
      tracer,
      meter,
      propagator,
      requireParentSpan: true,
    })(config);
    const httpRequest = makeHttpRequest();
    const sseRequest = makeSSERequest();
    const wsRequest = makeWsRequest();
    const httpNext = vi.fn(async (_req: HttpRequest) => makeHttpResponse());
    const sseNext = vi.fn(async (_req: HttpRequest) => makeSSEStream());
    const wsNext = vi.fn(async (_req: HttpRequest) => makeWsSession());
    await httpInterceptor(config).fn(httpRequest, httpNext);
    await sseInterceptor(config).fn(sseRequest, sseNext);
    await webSocketInterceptor(config).fn(wsRequest, wsNext);
    await waitForSettledPromises();
    expect(httpNext.mock.calls[0]?.[0]).toBe(httpRequest);
    expect(sseNext.mock.calls[0]?.[0]).toBe(sseRequest);
    expect(wsNext.mock.calls[0]?.[0]).toBe(wsRequest);
    expect(tracer.startSpan).not.toHaveBeenCalled();
    expect(propagator.extract).not.toHaveBeenCalled();
    expect(propagator.inject).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});

describe("withOpenTelemetryServer", () => {
  test("should create interceptors for all transports by default", () => {
    const config = makeConfig();
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
    });
    option(config);

    expect(config.interceptors.map((interceptor) => interceptor.kind)).toEqual([
      "http",
      "sse",
      "web-socket",
    ]);
  });

  test("should disable HTTP interceptor when http.enabled is false", () => {
    const config = makeConfig();
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      http: { enabled: false },
    });
    option(config);

    expect(config.interceptors.map((interceptor) => interceptor.kind)).toEqual([
      "sse",
      "web-socket",
    ]);
  });

  test("should disable SSE interceptor when sse.enabled is false", () => {
    const config = makeConfig();
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      sse: { enabled: false },
    });
    option(config);

    expect(config.interceptors.map((interceptor) => interceptor.kind)).toEqual([
      "http",
      "web-socket",
    ]);
  });

  test("should disable WebSocket interceptor when webSocket.enabled is false", () => {
    const config = makeConfig();
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      webSocket: { enabled: false },
    });
    option(config);

    expect(config.interceptors.map((interceptor) => interceptor.kind)).toEqual([
      "http",
      "sse",
    ]);
  });

  test("should enable transport when transport option object is empty", () => {
    const config = makeConfig();
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      http: {},
      sse: {},
      webSocket: {},
    });
    option(config);

    expect(config.interceptors).toHaveLength(3);
    expect(config.http.handle).toBe(config.sse.handle);
  });

  test("should route each startSpanHook only to its transport", async () => {
    const { tracer } = createMockTracer();
    const httpStartSpanHook = vi.fn(() => ({ "app.transport": "http" }));
    const sseStartSpanHook = vi.fn(() => ({ "app.transport": "sse" }));
    const webSocketStartSpanHook = vi.fn(() => ({
      "app.transport": "webSocket",
    }));
    const config = makeConfig();

    withOpenTelemetryServer({
      tracer,
      http: { startSpanHook: httpStartSpanHook },
      sse: { startSpanHook: sseStartSpanHook },
      webSocket: { startSpanHook: webSocketStartSpanHook },
    })(config);

    const httpRequest = makeHttpRequest();
    await httpInterceptor(config).fn(httpRequest, async () =>
      makeHttpResponse(),
    );
    expect(httpStartSpanHook).toHaveBeenCalledWith(httpRequest);
    expect(sseStartSpanHook).not.toHaveBeenCalled();
    expect(webSocketStartSpanHook).not.toHaveBeenCalled();

    const sseRequest = makeSSERequest();
    await sseInterceptor(config).fn(sseRequest, async () => makeSSEStream());
    expect(sseStartSpanHook).toHaveBeenCalledWith(sseRequest);
    expect(webSocketStartSpanHook).not.toHaveBeenCalled();

    const webSocketRequest = makeWsRequest();
    await webSocketInterceptor(config).fn(webSocketRequest, async () =>
      makeWsSession(),
    );
    expect(webSocketStartSpanHook).toHaveBeenCalledWith(webSocketRequest);
  });

  test("should keep initial transport attributes when startSpanHook is omitted", async () => {
    const { tracer } = createMockTracer();
    const config = makeConfig();
    withOpenTelemetryServer({ tracer })(config);

    await httpInterceptor(config).fn(makeHttpRequest(), async () =>
      makeHttpResponse(),
    );
    await sseInterceptor(config).fn(makeSSERequest(), async () =>
      makeSSEStream(),
    );
    await webSocketInterceptor(config).fn(makeWsRequest(), async () =>
      makeWsSession(),
    );

    expect(
      vi
        .mocked(tracer.startSpan)
        .mock.calls.map((call) => call[1]?.attributes?.["url.full"]),
    ).toEqual([
      "https://api.example.com/test",
      "https://api.example.com/events",
      "wss://api.example.com/ws",
    ]);
  });

  test("should disable all interceptors when all transports are disabled", () => {
    const config = makeConfig();
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      http: { enabled: false },
      sse: { enabled: false },
      webSocket: { enabled: false },
    });
    option(config);

    expect(config.interceptors).toHaveLength(0);
  });

  test("should accept external meter", () => {
    const meter = makeMeter();

    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      meter,
    });
    expect(typeof option).toBe("function");
  });

  test("should apply interceptors with external meter", () => {
    const meter = makeMeter();
    const config = makeConfig();

    withOpenTelemetryServer({ tracer: createMockTracer().tracer, meter })(
      config,
    );

    expect(config.interceptors).toHaveLength(3);
  });

  test("should accept custom propagator", () => {
    const propagator = makePropagator();

    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      propagator,
    });
    expect(typeof option).toBe("function");
  });

  test("should default WebSocket query propagation to off", async () => {
    const { tracer } = createMockTracer();
    const propagator = makePropagator();
    const config = makeConfig();

    withOpenTelemetryServer({
      tracer,
      propagator,
      http: { enabled: false },
      sse: { enabled: false },
    })(config);

    const req = makeWsRequest(new URLSearchParams({ room: "alpha" }));
    const next = vi.fn(async () => makeWsSession());
    await webSocketInterceptor(config).fn(req, next);

    expect(propagator.inject).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: req.queryParams,
        queryString: "room=alpha",
      }),
    );
  });

  test("should pass HTTP hooks only to HTTP interceptor", async () => {
    const { tracer } = createMockTracer();
    const requestHook = vi.fn();
    const responseHook = vi.fn();
    const config = makeConfig();

    withOpenTelemetryServer({
      tracer,
      sse: { enabled: false },
      webSocket: { enabled: false },
      http: { requestHook, responseHook },
    })(config);

    const res = makeHttpResponse();
    await httpInterceptor(config).fn(makeHttpRequest(), async () => res);

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(responseHook).toHaveBeenCalledTimes(1);
  });

  test("should pass SSE hooks only to SSE interceptor", async () => {
    const { tracer } = createMockTracer();
    const requestHook = vi.fn();
    const responseHook = vi.fn();
    const config = makeConfig();

    withOpenTelemetryServer({
      tracer,
      http: { enabled: false },
      webSocket: { enabled: false },
      sse: { requestHook, responseHook },
    })(config);

    const stream = makeSSEStream();
    await sseInterceptor(config).fn(makeSSERequest(), async () => stream);

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(responseHook).toHaveBeenCalledTimes(1);
  });

  test("should pass WebSocket hooks and explicit query propagation to WebSocket interceptor", async () => {
    const { tracer } = createMockTracer();
    const requestHook = vi.fn();
    const responseHook = vi.fn();
    const propagator = makePropagator();
    const config = makeConfig();

    withOpenTelemetryServer({
      tracer,
      propagator,
      http: { enabled: false },
      sse: { enabled: false },
      webSocket: { queryPropagation: true, requestHook, responseHook },
    })(config);

    await webSocketInterceptor(config).fn(makeWsRequest(), async () =>
      makeWsSession(),
    );

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(responseHook).toHaveBeenCalledTimes(1);
    expect(propagator.inject).toHaveBeenCalledTimes(1);
  });
});
