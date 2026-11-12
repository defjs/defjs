import {
  type ClientConfig,
  type HttpInterceptor,
  type HttpRequest,
  pickFirstBalancer,
  type SSEInterceptor,
  type WebSocketInterceptor,
} from "@defjs/core";
import type { Context, Meter, TextMapPropagator } from "@opentelemetry/api";
import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type OpenTelemetryServerHttpOptions,
  type OpenTelemetryServerOptions,
  type OpenTelemetryServerSSEOptions,
  type OpenTelemetryServerWebSocketOptions,
  withOpenTelemetryServer,
} from "./option";
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
} from "../test/mocks";
import { method } from "../test/method";

function makeConfig(): ClientConfig {
  const sharedFetch = globalThis.fetch.bind(globalThis);

  return {
    endpoints: ["https://api.example.com"],
    balancer: pickFirstBalancer(),
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
      const reject = () => Promise.reject(cause);

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
    const reject = () => Promise.reject(cause);
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
      vi.mocked(method(meter, "createHistogram")).mockReturnValue({ record });
      vi.mocked(method(meter, "createUpDownCounter")).mockReturnValue({ add });
      vi.spyOn(context, "active").mockReturnValue(ROOT_CONTEXT);
      const config = makeConfig();
      withOpenTelemetryServer({ meter, requireParentSpan })(config);
      const response = makeHttpResponse();
      const stream = makeSSEStream();
      const session = makeWsSession();

      await expect(
        httpInterceptor(config).fn(makeHttpRequest(), () =>
          Promise.resolve(response),
        ),
      ).resolves.toBe(response);
      await expect(
        sseInterceptor(config).fn(makeSSERequest(), () =>
          Promise.resolve(stream),
        ),
      ).resolves.toBe(stream);
      await expect(
        webSocketInterceptor(config).fn(makeWsRequest(), () =>
          Promise.resolve(session),
        ),
      ).resolves.toBe(session);
      await waitForSettledPromises();

      expect(record).toHaveBeenCalledTimes(5);
      expect(record).toHaveBeenCalledWith(expect.any(Number), {
        "http.request.method": "GET",
        "http.response.status_code": 200,
        "server.address": "api.example.com",
        "server.port": 443,
      });
      expect(add.mock.calls).toEqual([
        [1, { "server.address": "api.example.com", "server.port": 443 }],
        [-1, { "server.address": "api.example.com", "server.port": 443 }],
        [1, { "server.address": "api.example.com", "server.port": 443 }],
        [-1, { "server.address": "api.example.com", "server.port": 443 }],
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
      httpInterceptor(config).fn(makeHttpRequest(), () =>
        Promise.resolve(response),
      ),
    ).resolves.toBe(response);
    await expect(
      sseInterceptor(config).fn(makeSSERequest(), () =>
        Promise.resolve(stream),
      ),
    ).resolves.toBe(stream);
    await expect(
      webSocketInterceptor(config).fn(makeWsRequest(), () =>
        Promise.resolve(session),
      ),
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
      const httpNext = vi.fn((_req: HttpRequest) =>
        Promise.resolve(makeHttpResponse()),
      );
      const sseNext = vi.fn((_req: HttpRequest) =>
        Promise.resolve(makeSSEStream()),
      );
      const wsNext = vi.fn((_req: HttpRequest) =>
        Promise.resolve(makeWsSession()),
      );

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
      expect(method(tracer, "startSpan")).toHaveBeenCalledTimes(1);
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
    const next = vi.fn((_req: HttpRequest) => Promise.resolve(makeWsSession()));
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
    vi.mocked(method(meter, "createHistogram")).mockReturnValue({ record });
    vi.mocked(method(meter, "createUpDownCounter")).mockReturnValue({ add });
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
    const httpNext = vi.fn((_req: HttpRequest) =>
      Promise.resolve(makeHttpResponse()),
    );
    const sseNext = vi.fn((_req: HttpRequest) =>
      Promise.resolve(makeSSEStream()),
    );
    const wsNext = vi.fn((_req: HttpRequest) =>
      Promise.resolve(makeWsSession()),
    );
    await httpInterceptor(config).fn(httpRequest, httpNext);
    await sseInterceptor(config).fn(sseRequest, sseNext);
    await webSocketInterceptor(config).fn(wsRequest, wsNext);
    await waitForSettledPromises();
    expect(httpNext.mock.calls[0]?.[0]).toBe(httpRequest);
    expect(sseNext.mock.calls[0]?.[0]).toBe(sseRequest);
    expect(wsNext.mock.calls[0]?.[0]).toBe(wsRequest);
    expect(method(tracer, "startSpan")).not.toHaveBeenCalled();
    expect(method(propagator, "extract")).not.toHaveBeenCalled();
    expect(method(propagator, "inject")).not.toHaveBeenCalled();
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
    await httpInterceptor(config).fn(httpRequest, () =>
      Promise.resolve(makeHttpResponse()),
    );
    expect(httpStartSpanHook).toHaveBeenCalledWith(httpRequest);
    expect(sseStartSpanHook).not.toHaveBeenCalled();
    expect(webSocketStartSpanHook).not.toHaveBeenCalled();

    const sseRequest = makeSSERequest();
    await sseInterceptor(config).fn(sseRequest, () =>
      Promise.resolve(makeSSEStream()),
    );
    expect(sseStartSpanHook).toHaveBeenCalledWith(sseRequest);
    expect(webSocketStartSpanHook).not.toHaveBeenCalled();

    const webSocketRequest = makeWsRequest();
    await webSocketInterceptor(config).fn(webSocketRequest, () =>
      Promise.resolve(makeWsSession()),
    );
    expect(webSocketStartSpanHook).toHaveBeenCalledWith(webSocketRequest);
  });

  test("should keep initial transport attributes when startSpanHook is omitted", async () => {
    const { tracer } = createMockTracer();
    const config = makeConfig();
    withOpenTelemetryServer({ tracer })(config);

    await httpInterceptor(config).fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );
    await sseInterceptor(config).fn(makeSSERequest(), () =>
      Promise.resolve(makeSSEStream()),
    );
    await webSocketInterceptor(config).fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(
      vi
        .mocked(method(tracer, "startSpan"))
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
    const next = vi.fn(() => Promise.resolve(makeWsSession()));
    await webSocketInterceptor(config).fn(req, next);

    expect(method(propagator, "inject")).not.toHaveBeenCalled();
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
    await httpInterceptor(config).fn(makeHttpRequest(), () =>
      Promise.resolve(res),
    );

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
    await sseInterceptor(config).fn(makeSSERequest(), () =>
      Promise.resolve(stream),
    );

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

    await webSocketInterceptor(config).fn(makeWsRequest(), () =>
      Promise.resolve(makeWsSession()),
    );

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(responseHook).toHaveBeenCalledTimes(1);
    expect(method(propagator, "inject")).toHaveBeenCalledTimes(1);
  });
});

const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

describe("withOpenTelemetryServer transport capture", () => {
  test("uses the blocks captured at creation when one option is applied twice", async () => {
    const { tracer, spans } = createMockTracer();
    const httpStart = vi.fn(() => ({ "app.phase": "http-initial" }));
    const sseStart = vi.fn(() => ({ "app.phase": "sse-initial" }));
    const webSocketStart = vi.fn(() => ({ "app.phase": "ws-initial" }));
    const httpRequest = vi.fn();
    const httpResponse = vi.fn();
    const sseRequest = vi.fn();
    const sseResponse = vi.fn();
    const webSocketRequest = vi.fn();
    const webSocketResponse = vi.fn();
    const lateHttpRequest = vi.fn();
    const lateSseRequest = vi.fn();
    const lateWebSocketRequest = vi.fn();
    const seenQuery: string[] = [];
    const propagator: TextMapPropagator = {
      inject(_context, carrier, setter) {
        expect(this).toBe(propagator);
        setter.set(carrier, "traceparent", "captured-parent");
      },
      extract: (ctx) => ctx,
      fields: () => ["traceparent"],
    };
    const http: OpenTelemetryServerHttpOptions = {
      enabled: true,
      startSpanHook: httpStart,
      requestHook: httpRequest,
      responseHook: httpResponse,
    };
    const sse: OpenTelemetryServerSSEOptions = {
      enabled: true,
      startSpanHook: sseStart,
      requestHook: sseRequest,
      responseHook: sseResponse,
    };
    const webSocket: OpenTelemetryServerWebSocketOptions = {
      enabled: true,
      queryPropagation: true,
      startSpanHook: webSocketStart,
      requestHook: webSocketRequest,
      responseHook: webSocketResponse,
    };
    const options: OpenTelemetryServerOptions = {
      tracer,
      propagator,
      http,
      sse,
      webSocket,
    };

    const option = withOpenTelemetryServer(options);
    http.enabled = false;
    http.startSpanHook = () => ({ "app.phase": "http-replaced" });
    http.requestHook = lateHttpRequest;
    http.responseHook = vi.fn();
    sse.enabled = false;
    sse.startSpanHook = () => ({ "app.phase": "sse-replaced" });
    sse.requestHook = lateSseRequest;
    sse.responseHook = vi.fn();
    webSocket.enabled = false;
    webSocket.queryPropagation = false;
    webSocket.startSpanHook = () => ({ "app.phase": "ws-replaced" });
    webSocket.requestHook = lateWebSocketRequest;
    webSocket.responseHook = vi.fn();
    options.http = { enabled: false };
    options.sse = { enabled: false };
    options.webSocket = { enabled: false, queryPropagation: false };
    options.propagator = {
      inject: () => {
        throw new Error("replacement propagator");
      },
      extract: (ctx) => ctx,
      fields: () => [],
    };

    for (let application = 0; application < 2; application += 1) {
      const config = makeConfig();
      option(config);
      expect(config.interceptors.map((item) => item.kind)).toEqual([
        "http",
        "sse",
        "web-socket",
      ]);
      const httpCall = makeHttpRequest();
      const httpResult = makeHttpResponse();
      await httpInterceptor(config).fn(httpCall, () =>
        Promise.resolve(httpResult),
      );
      expect(httpRequest).toHaveBeenLastCalledWith(
        expect.any(Object),
        httpCall,
      );
      expect(httpResponse).toHaveBeenLastCalledWith(
        expect.any(Object),
        httpResult,
        httpCall,
      );
      const sseCall = makeSSERequest();
      const stream = makeSSEStream();
      await sseInterceptor(config).fn(sseCall, () => Promise.resolve(stream));
      expect(sseRequest).toHaveBeenLastCalledWith(expect.any(Object), sseCall);
      expect(sseResponse).toHaveBeenLastCalledWith(
        expect.any(Object),
        stream,
        sseCall,
      );
      const webSocketCall = makeWsRequest(
        new URLSearchParams({ room: "alpha" }),
      );
      const session = makeWsSession();
      const next = vi.fn((request: HttpRequest) => {
        seenQuery.push(request.queryString ?? "");
        return Promise.resolve(session);
      });
      await webSocketInterceptor(config).fn(webSocketCall, next);
      expect(webSocketRequest).toHaveBeenLastCalledWith(
        expect.any(Object),
        webSocketCall,
      );
      expect(webSocketResponse).toHaveBeenLastCalledWith(
        expect.any(Object),
        session,
        webSocketCall,
      );
    }

    expect(httpStart).toHaveBeenCalledTimes(2);
    expect(sseStart).toHaveBeenCalledTimes(2);
    expect(webSocketStart).toHaveBeenCalledTimes(2);
    expect(lateHttpRequest).not.toHaveBeenCalled();
    expect(lateSseRequest).not.toHaveBeenCalled();
    expect(lateWebSocketRequest).not.toHaveBeenCalled();
    expect(spans.map((span) => span.attributes["app.phase"])).toEqual([
      "http-initial",
      "sse-initial",
      "ws-initial",
      "http-initial",
      "sse-initial",
      "ws-initial",
    ]);
    expect(seenQuery).toEqual([
      "room=alpha&traceparent=captured-parent",
      "room=alpha&traceparent=captured-parent",
    ]);
  });

  test("reads each transport block once while building the option", () => {
    let httpReads = 0;
    let sseReads = 0;
    let webSocketReads = 0;
    const option = withOpenTelemetryServer({
      get http() {
        httpReads += 1;
        return { requestHook: vi.fn() };
      },
      get sse() {
        sseReads += 1;
        return {};
      },
      get webSocket() {
        webSocketReads += 1;
        return { queryPropagation: false };
      },
    });

    expect([httpReads, sseReads, webSocketReads]).toEqual([1, 1, 1]);
    option(makeConfig());
    option(makeConfig());
    expect([httpReads, sseReads, webSocketReads]).toEqual([1, 1, 1]);
  });

  test("reads enabled once and keeps that captured value", async () => {
    let reads = 0;
    const requestHook = vi.fn();
    const { tracer } = createMockTracer();
    const option = withOpenTelemetryServer({
      tracer,
      http: {
        get enabled() {
          reads += 1;
          return reads === 1;
        },
        requestHook,
      },
    });

    expect(reads).toBe(1);
    const first = makeConfig();
    const second = makeConfig();
    option(first);
    option(second);
    expect(reads).toBe(1);
    await httpInterceptor(first).fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );
    await httpInterceptor(second).fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );
    expect(requestHook).toHaveBeenCalledTimes(2);
  });

  test("ignores hooks added to an empty transport block after capture", async () => {
    const { tracer, spans } = createMockTracer();
    const http: OpenTelemetryServerHttpOptions = {};
    const option = withOpenTelemetryServer({ tracer, http });
    http.startSpanHook = () => ({ "app.late": "too-late" });
    const config = makeConfig();
    option(config);

    await httpInterceptor(config).fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );

    expect(spans[0]?.attributes["app.late"]).toBeUndefined();
    expect(spans[0]?.attributes["url.full"]).toBe(
      "https://api.example.com/test",
    );
  });

  test("keeps a disabled transport disabled when the block is later enabled", () => {
    const requestHook = vi.fn();
    const http: OpenTelemetryServerHttpOptions = {
      enabled: false,
      requestHook,
    };
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      http,
    });
    http.enabled = true;
    http.requestHook = vi.fn();
    const config = makeConfig();
    option(config);

    expect(config.interceptors.map((item) => item.kind)).toEqual([
      "sse",
      "web-socket",
    ]);
    expect(requestHook).not.toHaveBeenCalled();
  });

  test("keeps captured queryPropagation false when the block is later turned on", async () => {
    const { tracer } = createMockTracer();
    const propagator = makePropagator();
    const requestHook = vi.fn();
    const webSocket: OpenTelemetryServerWebSocketOptions = {
      queryPropagation: false,
      requestHook,
    };
    const options: OpenTelemetryServerOptions = {
      tracer,
      propagator,
      http: { enabled: false },
      sse: { enabled: false },
      webSocket,
    };
    const option = withOpenTelemetryServer(options);
    webSocket.queryPropagation = true;
    options.webSocket = { queryPropagation: true, requestHook: vi.fn() };
    const config = makeConfig();
    option(config);
    const request = makeWsRequest(new URLSearchParams({ room: "alpha" }));
    const next = vi.fn((_request: HttpRequest) =>
      Promise.resolve(makeWsSession()),
    );

    await webSocketInterceptor(config).fn(request, next);

    expect(requestHook).toHaveBeenCalledTimes(1);
    expect(method(propagator, "inject")).not.toHaveBeenCalled();
    expect(next.mock.calls[0]?.[0].queryString).toBe("room=alpha");
    expect(next.mock.calls[0]?.[0].queryParams).toBe(request.queryParams);
  });

  test("throws an enabled getter failure from withOpenTelemetryServer without reading hooks", () => {
    const error = new Error("enabled getter failed");
    let hookReads = 0;
    expect(() =>
      withOpenTelemetryServer({
        http: {
          get enabled(): never {
            throw error;
          },
          get requestHook(): never {
            hookReads += 1;
            throw new Error("request hook getter");
          },
        },
      }),
    ).toThrow(error);
    expect(hookReads).toBe(0);
  });

  test("throws an active hook getter failure once from withOpenTelemetryServer", () => {
    const error = new Error("request hook getter failed");
    let reads = 0;
    expect(() =>
      withOpenTelemetryServer({
        http: {
          get startSpanHook() {
            reads += 1;
            return () => ({});
          },
          get requestHook(): never {
            reads += 1;
            throw error;
          },
          get responseHook() {
            reads += 1;
            return () => undefined;
          },
        },
      }),
    ).toThrow(error);
    expect(reads).toBe(2);
  });

  test("does not read a later transport block when an earlier active getter throws", () => {
    const error = new Error("http request hook getter failed");
    let sseReads = 0;
    expect(() =>
      withOpenTelemetryServer({
        http: {
          get requestHook(): never {
            throw error;
          },
        },
        get sse() {
          sseReads += 1;
          return { enabled: true };
        },
      }),
    ).toThrow(error);
    expect(sseReads).toBe(0);
  });

  test("does not read disabled hooks or queryPropagation", () => {
    let httpEnabledReads = 0;
    let webSocketEnabledReads = 0;
    let httpHookReads = 0;
    let sseHookReads = 0;
    let webSocketHookReads = 0;
    let queryReads = 0;
    const option = withOpenTelemetryServer({
      http: {
        get enabled() {
          httpEnabledReads += 1;
          return false;
        },
        get startSpanHook(): never {
          httpHookReads += 1;
          throw new Error("http start");
        },
        get requestHook(): never {
          httpHookReads += 1;
          throw new Error("http request");
        },
        get responseHook(): never {
          httpHookReads += 1;
          throw new Error("http response");
        },
      },
      sse: {
        enabled: false,
        get requestHook(): never {
          sseHookReads += 1;
          throw new Error("sse request");
        },
      },
      webSocket: {
        get enabled() {
          webSocketEnabledReads += 1;
          return false;
        },
        get queryPropagation(): never {
          queryReads += 1;
          throw new Error("query propagation");
        },
        get startSpanHook(): never {
          webSocketHookReads += 1;
          throw new Error("ws start");
        },
        get requestHook(): never {
          webSocketHookReads += 1;
          throw new Error("ws request");
        },
        get responseHook(): never {
          webSocketHookReads += 1;
          throw new Error("ws response");
        },
      },
    });

    expect(httpEnabledReads).toBe(1);
    expect(webSocketEnabledReads).toBe(1);
    expect(httpHookReads).toBe(0);
    expect(sseHookReads).toBe(0);
    expect(webSocketHookReads).toBe(0);
    expect(queryReads).toBe(0);
    const config = makeConfig();
    option(config);
    expect(config.interceptors).toEqual([]);
    expect(httpHookReads).toBe(0);
    expect(queryReads).toBe(0);
    expect(httpEnabledReads).toBe(1);
    expect(webSocketEnabledReads).toBe(1);
  });

  test("creates metrics at application and isolates bucket arrays across clients", async () => {
    const received: number[][] = [];
    const records: Array<ReturnType<typeof vi.fn>> = [];
    const meter = makeMeter();
    vi.mocked(method(meter, "createHistogram")).mockImplementation(
      (_name, options) => {
        const buckets = options?.advice?.explicitBucketBoundaries;
        if (!buckets) throw new Error("expected explicitBucketBoundaries");
        if (received.length === 0) {
          buckets[0] = 999;
          buckets.push(42);
        }
        received.push(buckets);
        const record = vi.fn();
        records.push(record);
        return { record };
      },
    );
    const option = withOpenTelemetryServer({ meter });

    expect(method(meter, "createHistogram")).not.toHaveBeenCalled();
    expect(method(meter, "createUpDownCounter")).not.toHaveBeenCalled();
    const first = makeConfig();
    option(first);
    expect(method(meter, "createHistogram")).toHaveBeenCalledTimes(5);
    expect(method(meter, "createUpDownCounter")).toHaveBeenCalledTimes(2);
    const second = makeConfig();
    option(second);

    expect(received).toHaveLength(10);
    expect(new Set(received).size).toBe(10);
    expect(received[0]?.[0]).toBe(999);
    expect(received[0]).toContain(42);
    for (const buckets of received.slice(1)) {
      expect(buckets).toEqual(DURATION_BUCKETS);
    }
    expect(new Set(records).size).toBe(10);
    await httpInterceptor(first).fn(makeHttpRequest(), () =>
      Promise.resolve(makeHttpResponse()),
    );
    expect(records[0]).toHaveBeenCalledTimes(1);
    expect(records[5]).not.toHaveBeenCalled();
  });
});
