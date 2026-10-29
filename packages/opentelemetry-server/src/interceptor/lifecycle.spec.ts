import type { HttpRequest } from "@defjs/core";
import { createHttpInterceptor, createSSEInterceptor } from "@defjs/core";
import type {
  Attributes,
  Context,
  Span,
  SpanOptions,
} from "@opentelemetry/api";
import { context, diag, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runSpanHook } from "../telemetry/trace";
import type { MockSpan } from "../test-utils";
import {
  createMockMetrics,
  createMockTracer,
  makeDeferredSSEStream,
  makeDeferredWsSession,
  makeHttpRequest,
  makeHttpResponse,
  makeSSERequest,
  makeWsRequest,
} from "../test-utils";
import { createOpenTelemetryHttpInterceptor } from "./http";
import { createOpenTelemetrySSEInterceptor } from "./sse";
import { createOpenTelemetryWebSocketInterceptor } from "./web_socket";

const propagator = new W3CTraceContextPropagator();
const parent = {
  traceId: "11111111111111111111111111111111",
  spanId: "2222222222222222",
  traceFlags: 1,
};
const parentTraceparent = `00-${parent.traceId}-${parent.spanId}-01`;
const hookErrorMessage =
  "@defjs/opentelemetry-server: span hook failed on a non-recording span";

interface RecordedSpan {
  span: MockSpan;
  parentContext: Context | undefined;
  events: { name: string; attributes: Attributes }[];
}

// The SDK drops writes after end(); a call-count-only mock hides lost hook errors.
function createLifecycleTracer() {
  const { tracer } = createMockTracer();
  const startSpan = tracer.startSpan.bind(tracer);
  const records: RecordedSpan[] = [];
  tracer.startSpan = vi.fn(
    (name: string, options?: SpanOptions, parentContext?: Context) => {
      const span = startSpan(name, options, parentContext);
      const events: RecordedSpan["events"] = [];
      const spanContext = {
        ...span.spanContext(),
        traceId:
          trace.getSpanContext(parentContext ?? ROOT_CONTEXT)?.traceId ??
          parent.traceId,
        spanId: (records.length + 1).toString(16).padStart(16, "0"),
      };
      span.spanContext = () => spanContext;
      span.setAttribute.mockImplementation((key, value) => {
        if (!span.ended) span.attributes[key] = value;
        return span;
      });
      span.setAttributes.mockImplementation((attributes) => {
        if (!span.ended) {
          for (const [key, value] of Object.entries(attributes)) {
            if (value !== undefined) span.attributes[key] = value;
          }
        }
        return span;
      });
      span.addEvent.mockImplementation((name, attributes) => {
        if (!span.ended) {
          events.push({
            name,
            attributes:
              typeof attributes === "object" &&
              !Array.isArray(attributes) &&
              !(attributes instanceof Date)
                ? { ...attributes }
                : {},
          });
        }
        return span;
      });
      span.recordException.mockImplementation((error) => {
        if (!span.ended) {
          events.push({
            name: "exception",
            attributes: {
              "exception.type":
                typeof error === "string" ? "Error" : (error.name ?? "Error"),
              "exception.message":
                typeof error === "string" ? error : (error.message ?? ""),
            },
          });
        }
      });
      span.setStatus.mockImplementation((status) => {
        if (!span.ended) span.status = status;
        return span;
      });
      span.updateName.mockImplementation((name) => {
        if (!span.ended) span.name = name;
        return span;
      });
      records.push({ span, parentContext, events });
      return span;
    },
  );
  return { tracer, records };
}

async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function expectSiblings(
  records: RecordedSpan[],
  sent: HttpRequest[],
  req: HttpRequest,
  original: HttpRequest,
  headers: [string, string][],
) {
  expect(records).toHaveLength(sent.length);
  expect(new Set(sent.map((request) => request.headers)).size).toBe(
    sent.length,
  );
  expect(
    new Set(records.map(({ span }) => span.spanContext().spanId)).size,
  ).toBe(sent.length);
  for (const [index, record] of records.entries()) {
    expect(
      trace.getSpanContext(record.parentContext ?? ROOT_CONTEXT),
    ).toMatchObject(parent);
    expect(record.span.spanContext().traceId).toBe(parent.traceId);
    expect(record.span.ended).toBe(true);
    expect(sent[index]).not.toBe(req);
    expect(sent[index]?.headers).not.toBe(req.headers);
    expect(sent[index]?.headers?.get("x-custom")).toBe("kept");
    expect(sent[index]?.headers?.get("traceparent")).toBe(
      `00-${parent.traceId}-${record.span.spanContext().spanId}-01`,
    );
  }
  expect(req).toEqual(original);
  expect(req.headers).toBe(original.headers);
  if (!req.headers) throw new Error("Expected request headers");
  expect([...req.headers]).toEqual(headers);
}

afterEach(() => vi.restoreAllMocks());

describe("retry propagation lifecycle", () => {
  test.each(["incoming traceparent", "active context"] as const)(
    "HTTP retries remain siblings with %s",
    async (source) => {
      vi.spyOn(context, "active").mockReturnValue(
        source === "active context"
          ? trace.setSpanContext(ROOT_CONTEXT, parent)
          : ROOT_CONTEXT,
      );
      const headers = new Headers({ "x-custom": "kept" });
      if (source === "incoming traceparent")
        headers.set("traceparent", parentTraceparent);
      const req = makeHttpRequest(headers);
      const original = { ...req };
      const originalHeaders = [...headers];
      const { tracer, records } = createLifecycleTracer();
      const telemetry = createOpenTelemetryHttpInterceptor({
        tracer,
        propagator,
      });
      const sent: HttpRequest[] = [];
      const retry = createHttpInterceptor(async (request, next) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await next(request);
          if (response.status !== 503) return response;
        }
        throw new Error("Retry exhausted");
      });
      const result = await retry.fn(req, (request) =>
        telemetry.fn(request, async (outgoing) => {
          sent.push(outgoing);
          return {
            ...makeHttpResponse(),
            status: sent.length < 3 ? 503 : 200,
            ok: sent.length === 3,
          };
        }),
      );
      expect(result.status).toBe(200);
      expect(sent).toHaveLength(3);
      expect(
        records.map(({ span }) => span.attributes["http.response.status_code"]),
      ).toEqual([503, 503, 200]);
      expectSiblings(records, sent, req, original, originalHeaders);
    },
  );

  test.each(["incoming traceparent", "active context"] as const)(
    "SSE connect retries remain siblings with %s",
    async (source) => {
      vi.spyOn(context, "active").mockReturnValue(
        source === "active context"
          ? trace.setSpanContext(ROOT_CONTEXT, parent)
          : ROOT_CONTEXT,
      );
      const headers = new Headers({ "x-custom": "kept" });
      if (source === "incoming traceparent")
        headers.set("traceparent", parentTraceparent);
      const req = makeSSERequest(headers);
      const original = { ...req };
      const originalHeaders = [...headers];
      const { tracer, records } = createLifecycleTracer();
      const telemetry = createOpenTelemetrySSEInterceptor({
        tracer,
        propagator,
      });
      const stream = makeDeferredSSEStream();
      const sent: HttpRequest[] = [];
      const failure = new TypeError("First connect failed");
      const retry = createSSEInterceptor(async (request, next) => {
        try {
          return await next(request);
        } catch (error) {
          expect(error).toBe(failure);
          expect(records[0]?.span.ended).toBe(true);
          return next(request);
        }
      });
      const result = await retry.fn(req, (request) =>
        telemetry.fn(request, async (outgoing) => {
          sent.push(outgoing);
          if (sent.length === 1) throw failure;
          return stream.stream;
        }),
      );
      expect(result).toBe(stream.stream);
      expect(sent).toHaveLength(2);
      expect(records[1]?.span.isRecording()).toBe(true);
      stream.close();
      await drainMicrotasks();
      expectSiblings(records, sent, req, original, originalHeaders);
    },
  );

  test.each(["HTTP", "SSE"] as const)(
    "%s propagates synchronous requestHook header edits without changing the parent",
    async (transport) => {
      const headers = new Headers({
        authorization: "Bearer old-token",
        "x-sensitive": "private",
        traceparent: parentTraceparent,
      });
      const req =
        transport === "HTTP"
          ? makeHttpRequest(headers)
          : makeSSERequest(headers);
      const { tracer, records } = createLifecycleTracer();
      const requestHook = vi.fn((_span: Span, request: HttpRequest) => {
        request.headers?.set("authorization", "Bearer new-token");
        request.headers?.delete("x-sensitive");
      });
      const responseHook = vi.fn();
      const options = { tracer, propagator, requestHook, responseHook };
      const response = makeHttpResponse();
      const stream = makeDeferredSSEStream();
      const sent: HttpRequest[] = [];

      try {
        const result =
          transport === "HTTP"
            ? await createOpenTelemetryHttpInterceptor(options).fn(
                req,
                async (outgoing) => {
                  sent.push(outgoing);
                  return response;
                },
              )
            : await createOpenTelemetrySSEInterceptor(options).fn(
                req,
                async (outgoing) => {
                  sent.push(outgoing);
                  return stream.stream;
                },
              );

        expect(result).toBe(transport === "HTTP" ? response : stream.stream);
        expect(records).toHaveLength(1);
        const record = records[0];
        if (!record) throw new Error("Expected a recorded span");
        expect(requestHook).toHaveBeenCalledTimes(1);
        expect(requestHook.mock.calls[0]?.[1]).toBe(req);
        expect(responseHook).toHaveBeenCalledTimes(1);
        expect(responseHook.mock.calls[0]?.[2]).toBe(req);
        expect(
          trace.getSpanContext(record.parentContext ?? ROOT_CONTEXT),
        ).toMatchObject(parent);
        expect(sent).toHaveLength(1);
        expect(sent[0]).not.toBe(req);
        expect(sent[0]?.headers).not.toBe(headers);
        expect(sent[0]?.headers?.get("authorization")).toBe("Bearer new-token");
        expect(sent[0]?.headers?.has("x-sensitive")).toBe(false);
        expect(sent[0]?.headers?.get("traceparent")).toBe(
          `00-${parent.traceId}-${record.span.spanContext().spanId}-01`,
        );
        expect(req.headers).toBe(headers);
        expect([...headers]).toEqual([
          ["authorization", "Bearer new-token"],
          ["traceparent", parentTraceparent],
        ]);
      } finally {
        stream.close();
        await drainMicrotasks();
      }
      expect(records[0]?.span.ended).toBe(true);
    },
  );
});

describe("span hook recording lifecycle", () => {
  test.each(["Promise.reject", "deferred rejection"] as const)(
    "HTTP reports %s after end through diag with span IDs",
    async (mode) => {
      const diagnostic = vi
        .spyOn(diag, "error")
        .mockImplementation(() => undefined);
      const { tracer, records } = createLifecycleTracer();
      const metrics = createMockMetrics();
      const deferred = Promise.withResolvers<void>();
      const failure = new TypeError("private hook detail");
      const response = makeHttpResponse("ok");
      const interceptor = createOpenTelemetryHttpInterceptor({
        tracer,
        propagator,
        metrics,
        responseHook: () =>
          mode === "Promise.reject"
            ? Promise.reject(failure)
            : deferred.promise,
      });

      expect(
        await interceptor.fn(makeHttpRequest(), async () => response),
      ).toBe(response);
      const record = records[0];
      if (!record) throw new Error("Expected a recorded HTTP span");
      expect(record.span.isRecording()).toBe(false);
      expect(record.events).toEqual([]);
      if (mode === "deferred rejection") {
        expect(diagnostic).not.toHaveBeenCalled();
        deferred.reject(failure);
      }
      await drainMicrotasks();

      expect(record.events).toEqual([]);
      expect(diagnostic.mock.calls).toEqual([
        [
          hookErrorMessage,
          {
            "hook.name": "responseHook",
            "error.type": "TypeError",
            traceId: record.span.spanContext().traceId,
            spanId: record.span.spanContext().spanId,
          },
        ],
      ]);
      expect(metrics.requestDuration.record).toHaveBeenCalledExactlyOnceWith(
        expect.any(Number),
        {
          "http.request.method": "GET",
          "http.response.status_code": 200,
          "server.address": "api.example.com",
        },
      );
    },
  );

  test("HTTP keeps synchronous response attributes and throw events before end", async () => {
    const diagnostic = vi
      .spyOn(diag, "error")
      .mockImplementation(() => undefined);
    const { tracer, records } = createLifecycleTracer();
    const metrics = createMockMetrics();
    const response = makeHttpResponse("ok");
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator,
      metrics,
      responseHook: (span) => {
        expect(span.isRecording()).toBe(true);
        span.setAttribute("hook.sync", "kept");
        throw new TypeError("sync failure");
      },
    });
    expect(await interceptor.fn(makeHttpRequest(), async () => response)).toBe(
      response,
    );
    expect(records[0]?.span.attributes).toMatchObject({
      "hook.sync": "kept",
      "http.response.status_code": 200,
    });
    expect(records[0]?.events).toEqual([
      {
        name: "defjs.otel.hook.error",
        attributes: { "hook.name": "responseHook", "error.type": "TypeError" },
      },
      {
        name: "exception",
        attributes: {
          "exception.type": "TypeError",
          "exception.message": "sync failure",
        },
      },
    ]);
    expect(records[0]?.span.ended).toBe(true);
    expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1);
    expect(diagnostic).not.toHaveBeenCalled();
  });

  test("HTTP returns and ends a span without waiting for a never-settling hook; late writes are ignored", async () => {
    const diagnostic = vi
      .spyOn(diag, "error")
      .mockImplementation(() => undefined);
    const { tracer, records } = createLifecycleTracer();
    const metrics = createMockMetrics();
    const response = makeHttpResponse("ok");
    const lateWrite = Promise.withResolvers<void>();
    let wroteLate = false;
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator,
      metrics,
      responseHook: (span) => {
        void lateWrite.promise.then(() => {
          span.setAttribute("hook.late", "lost");
          span.setAttributes({ "hook.late.batch": "lost" });
          wroteLate = true;
        });
        return new Promise<void>(() => undefined);
      },
    });
    const result = await Promise.race([
      interceptor.fn(makeHttpRequest(), async () => response),
      drainMicrotasks().then(() => "still waiting for hook"),
    ]);
    expect(result).toBe(response);
    expect(records[0]?.span.ended).toBe(true);
    lateWrite.resolve();
    await drainMicrotasks();
    expect(wroteLate).toBe(true);
    expect(records[0]?.span.attributes["hook.late"]).toBeUndefined();
    expect(records[0]?.span.attributes["hook.late.batch"]).toBeUndefined();
    expect(records[0]?.events).toEqual([]);
    expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1);
    expect(diagnostic).not.toHaveBeenCalled();
  });

  test("an unsampled span reports hook failure through diag before end", async () => {
    const diagnostic = vi
      .spyOn(diag, "error")
      .mockImplementation(() => undefined);
    const { tracer, records } = createLifecycleTracer();
    const span = tracer.startSpan("unsampled");
    const spanContext = { ...span.spanContext(), traceFlags: 0 };
    span.spanContext = () => spanContext;
    span.isRecording.mockReturnValue(false);

    runSpanHook(span, "requestHook", () =>
      Promise.reject(new TypeError("private hook detail")),
    );
    await drainMicrotasks();

    expect(span.ended).toBe(false);
    expect(records[0]?.events).toEqual([]);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(hookErrorMessage, {
      "hook.name": "requestHook",
      "error.type": "TypeError",
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    });
  });

  test.each([
    { error: "private detail", type: "string" },
    { error: 42, type: "number" },
    { error: null, type: "_OTHER" },
    { error: undefined, type: "_OTHER" },
    {
      error: Object.assign(new Error("private detail"), { name: "" }),
      type: "Error",
    },
  ])(
    "an ended span reports a synchronous $type failure without recording events",
    ({ error, type }) => {
      const diagnostic = vi
        .spyOn(diag, "error")
        .mockImplementation(() => undefined);
      const { tracer, records } = createLifecycleTracer();
      const span = tracer.startSpan("already ended");
      span.end();
      expect(() =>
        runSpanHook(span, "requestHook", () => {
          throw error;
        }),
      ).not.toThrow();
      expect(records[0]?.events).toEqual([]);
      expect(diagnostic).toHaveBeenCalledExactlyOnceWith(hookErrorMessage, {
        "hook.name": "requestHook",
        "error.type": type,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
      });
    },
  );

  test("a throwing diag logger cannot reject HTTP or leave an unhandled hook rejection", async () => {
    const diagnostic = vi.spyOn(diag, "error").mockImplementation(() => {
      throw new Error("diagnostic failed");
    });
    const { tracer, records } = createLifecycleTracer();
    const metrics = createMockMetrics();
    const response = makeHttpResponse("ok");
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator,
      metrics,
      responseHook: () => Promise.reject("private hook detail"),
    });
    expect(await interceptor.fn(makeHttpRequest(), async () => response)).toBe(
      response,
    );
    await drainMicrotasks();
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(records[0]?.events).toEqual([]);
    expect(records[0]?.span.ended).toBe(true);
    expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1);
    const record = records[0];
    if (!record) throw new Error("Expected a recorded HTTP span");
    expect(() =>
      runSpanHook(record.span, "requestHook", () => {
        throw null;
      }),
    ).not.toThrow();
    expect(diagnostic).toHaveBeenCalledTimes(2);
  });

  test.each(["SSE", "WebSocket"] as const)(
    "%s retains async hook errors on a still-recording span",
    async (transport) => {
      const diagnostic = vi
        .spyOn(diag, "error")
        .mockImplementation(() => undefined);
      const { tracer, records } = createLifecycleTracer();
      const deferred = Promise.withResolvers<void>();
      const options = {
        tracer,
        propagator,
        responseHook: () => deferred.promise,
      };
      const stream = makeDeferredSSEStream();
      const session = makeDeferredWsSession();
      if (transport === "SSE") {
        expect(
          await createOpenTelemetrySSEInterceptor(options).fn(
            makeSSERequest(),
            async () => stream.stream,
          ),
        ).toBe(stream.stream);
      } else {
        expect(
          await createOpenTelemetryWebSocketInterceptor(options).fn(
            makeWsRequest(),
            async () => session.session,
          ),
        ).toBe(session.session);
      }
      const record = records[0];
      if (!record) throw new Error("Expected a recorded connection span");
      expect(record.span.isRecording()).toBe(true);
      const before = record.events.length;
      deferred.reject(new TypeError("async hook failed"));
      await drainMicrotasks();
      expect(record.events.slice(before)).toEqual([
        {
          name: "defjs.otel.hook.error",
          attributes: {
            "hook.name": "responseHook",
            "error.type": "TypeError",
          },
        },
        {
          name: "exception",
          attributes: {
            "exception.type": "TypeError",
            "exception.message": "async hook failed",
          },
        },
      ]);
      expect(record.span.isRecording()).toBe(true);
      expect(diagnostic).not.toHaveBeenCalled();
      stream.close();
      session.close();
      await drainMicrotasks();
      expect(record.span.ended).toBe(true);
    },
  );
});
