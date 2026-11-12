import { createNetworkFault, ERR_ABORTED, ERR_TIMEOUT } from "@defjs/core";
import { SpanStatusCode } from "@opentelemetry/api";
import { describe, expect, test, vi } from "vitest";
import type { MockSpan } from "../../test/mocks";
import { createMockTracer } from "../../test/mocks";
import {
  getErrorType,
  getExceptionType,
  isCallerCancellation,
  normalizeHttpMethod,
  runSpanHook,
  endSpanWithError,
  endSpanWithResponse,
} from "./trace";

describe("trace helpers", () => {
  test.each([
    ["GET", "GET"],
    ["PATCH", "PATCH"],
    ["QUERY", "QUERY"],
    ["get", "GET"],
    ["Delete", "DELETE"],
    ["patch", "_OTHER"],
    ["PROPFIND", "_OTHER"],
  ])("normalizeHttpMethod(%s)", (input, expected) => {
    expect(normalizeHttpMethod(input)).toBe(expected);
  });

  test("endSpanWithResponse with 2xx status", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    endSpanWithResponse(span, 200);

    expect(spans[0]?.attributes["http.response.status_code"]).toBe(200);
    expect(spans[0]?.attributes["error.type"]).toBeUndefined();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
  });

  test.each([400, 404, 500, 599])(
    "endSpanWithResponse with error status %i",
    (status) => {
      const { tracer, spans } = createMockTracer();
      const span = tracer.startSpan("test");
      endSpanWithResponse(span, status);

      expect(spans[0]?.attributes["http.response.status_code"]).toBe(status);
      expect(spans[0]?.attributes["error.type"]).toBe(String(status));
      expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
      expect(spans[0]?.ended).toBe(true);
    },
  );

  test("endSpanWithResponse leaves a status-0 response unattributed", () => {
    // A real transport failure is a fault and never arrives as a response; status 0 can only come
    // from a synthetic interceptor response, which carries nothing to report.
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    endSpanWithResponse(span, 0);

    expect(spans[0]?.attributes["http.response.status_code"]).toBeUndefined();
    expect(spans[0]?.attributes["error.type"]).toBeUndefined();
    expect(spans[0]?.status).toBeUndefined();
    expect(spans[0]?.ended).toBe(true);
  });

  test("endSpanWithError with Error instance", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    endSpanWithError(span, new Error("boom"));

    expect(spans[0]?.recordException).toHaveBeenCalledWith({ name: "Error" });
    expect(spans[0]?.attributes["error.type"]).toBe("Error");
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.ended).toBe(true);
  });

  test("endSpanWithError with non-Error value", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    endSpanWithError(span, "string error");

    expect(spans[0]?.recordException).toHaveBeenCalledWith({ name: "string" });
    expect(spans[0]?.attributes["error.type"]).toBe("string");
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.ended).toBe(true);
  });

  test("endSpanWithError with undefined", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    endSpanWithError(span, undefined);

    expect(spans[0]?.recordException).toHaveBeenCalledWith({ name: "_OTHER" });
    expect(spans[0]?.attributes["error.type"]).toBe("_OTHER");
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.ended).toBe(true);
  });

  test("endSpanWithError uses the fallback error type for null", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    endSpanWithError(span, null);

    expect(spans[0]?.attributes["error.type"]).toBe("_OTHER");
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.ended).toBe(true);
  });

  describe("exception events carry no free-form error text", () => {
    function leakyError(): TypeError {
      return new TypeError(
        "Request cannot be constructed from a URL that includes credentials: http://svc-user:S3cretPassw0rd@host/ok?token=SECRET",
      );
    }

    function expectOnlyType(span: MockSpan | undefined, name: string): void {
      const calls = span?.recordException.mock.calls ?? [];
      expect(calls).toHaveLength(1);
      const argument: unknown = calls[0]?.[0];
      expect(argument).toEqual({ name });
      expect(JSON.stringify(argument)).not.toMatch(
        /S3cretPassw0rd|SECRET|credentials/,
      );
    }

    test("endSpanWithError records only the error type", () => {
      const { tracer, spans } = createMockTracer();
      const span = tracer.startSpan("test");
      endSpanWithError(span, leakyError());

      expectOnlyType(spans[0], "TypeError");
    });

    test("a failing span hook records only the error type", () => {
      const { tracer, spans } = createMockTracer();
      const span = tracer.startSpan("test");
      runSpanHook(span, "requestHook", () => {
        throw leakyError();
      });

      expectOnlyType(spans[0], "TypeError");
    });

    test.each([
      { thrown: "token=SECRET", name: "string" },
      { thrown: undefined, name: "_OTHER" },
      { thrown: 42, name: "number" },
    ])("records $name for a non-Error value", ({ thrown, name }) => {
      const { tracer, spans } = createMockTracer();
      const span = tracer.startSpan("test");
      endSpanWithError(span, thrown);

      expectOnlyType(spans[0], name);
    });
  });

  test("runSpanHook calls provided hook", () => {
    const { tracer } = createMockTracer();
    const span = tracer.startSpan("test");
    const hook = vi.fn();
    runSpanHook(span, "requestHook", hook);

    expect(hook).toHaveBeenCalledTimes(1);
  });

  test.each([
    { error: new Error("async hook failed"), errorType: "Error" },
    { error: "async hook failed", errorType: "string" },
  ])(
    "runSpanHook records async $errorType hook failures without an unhandled rejection",
    async ({ error, errorType }) => {
      const { tracer, spans } = createMockTracer();
      const span = tracer.startSpan("test");
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- INTENT: the table rejects with a string to prove non-Error failures are recorded
      runSpanHook(span, "requestHook", () => Promise.reject(error));
      await Promise.resolve();
      await Promise.resolve();

      expect(spans[0]?.addEvent).toHaveBeenCalledWith("defjs.otel.hook.error", {
        "error.type": errorType,
        "hook.name": "requestHook",
      });
      expect(spans[0]?.recordException).toHaveBeenCalledWith({
        name: errorType,
      });
    },
  );

  test("runSpanHook does not wait for a pending async hook", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    const pending = new Promise<void>(() => undefined);

    runSpanHook(span, "requestHook", () => pending);

    expect(spans[0]?.addEvent).not.toHaveBeenCalled();
    expect(spans[0]?.recordException).not.toHaveBeenCalled();
  });

  test("runSpanHook isolates failures while recording an async hook rejection", async () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    spans[0]?.addEvent.mockImplementation(() => {
      throw new Error("addEvent failed");
    });
    spans[0]?.recordException.mockImplementation(() => {
      throw new Error("recordException failed");
    });
    runSpanHook(span, "requestHook", () =>
      Promise.reject(new Error("async hook failed")),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(spans[0]?.addEvent).toHaveBeenCalledTimes(1);
    expect(spans[0]?.recordException).toHaveBeenCalledTimes(1);
  });

  test("runSpanHook records non-Error hook failures", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    runSpanHook(span, "requestHook", () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the hook failure under test is a non-Error string
      throw "boom";
    });

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("defjs.otel.hook.error", {
      "error.type": "string",
      "hook.name": "requestHook",
    });
    expect(spans[0]?.recordException).toHaveBeenCalledWith({ name: "string" });
  });

  test("runSpanHook uses Error default name when Error name is empty", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    const error = new Error("boom");
    error.name = "";

    runSpanHook(span, "requestHook", () => {
      throw error;
    });

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("defjs.otel.hook.error", {
      "error.type": "Error",
      "hook.name": "requestHook",
    });
    expect(spans[0]?.recordException).toHaveBeenCalledWith({ name: "Error" });
  });

  test("runSpanHook records non-string non-Error hook failures", () => {
    const { tracer, spans } = createMockTracer();
    const span = tracer.startSpan("test");
    runSpanHook(span, "requestHook", () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- INTENT: the hook must throw a number to prove non-string, non-Error failures are typed "number"
      throw 42;
    });

    expect(spans[0]?.addEvent).toHaveBeenCalledWith("defjs.otel.hook.error", {
      "error.type": "number",
      "hook.name": "requestHook",
    });
    expect(spans[0]?.recordException).toHaveBeenCalledWith({ name: "number" });
  });

  describe("isCallerCancellation", () => {
    const foreign = new Error("Request was aborted");
    Object.defineProperty(foreign, Symbol.for("defjs.cause.aborted"), {
      value: true,
    });

    test.each([
      ERR_ABORTED,
      foreign,
      new DOMException("cancelled", "AbortError"),
      createNetworkFault(ERR_ABORTED),
    ])("is true for a rejection that is cancellation: %s", (error) => {
      expect(isCallerCancellation(undefined, error)).toBe(true);
    });

    test("is true when the signal reason is cancellation", () => {
      expect(
        isCallerCancellation(AbortSignal.abort(), new TypeError("lost")),
      ).toBe(true);
    });

    test("is false for a timeout, also when the signal reason is cancellation", () => {
      expect(isCallerCancellation(undefined, ERR_TIMEOUT)).toBe(false);
      expect(
        isCallerCancellation(
          AbortSignal.abort(),
          new DOMException("timed out", "TimeoutError"),
        ),
      ).toBe(false);
    });

    test("is false when the signal reason is a timeout", () => {
      expect(
        isCallerCancellation(
          AbortSignal.abort(ERR_TIMEOUT),
          new Error("socket hang up"),
        ),
      ).toBe(false);
      expect(
        isCallerCancellation(
          AbortSignal.abort(ERR_TIMEOUT),
          new DOMException("cancelled", "AbortError"),
        ),
      ).toBe(false);
    });

    test("is false for a failure, whatever the signal says", () => {
      expect(
        isCallerCancellation(new AbortController().signal, new TypeError("x")),
      ).toBe(false);
      const abort = new AbortController();
      abort.abort({ kind: "error", cause: new Error("refused") });
      expect(isCallerCancellation(abort.signal, new TypeError("x"))).toBe(
        false,
      );
    });
  });

  test.each([
    [ERR_TIMEOUT, "timeout", "Error"],
    [new DOMException("timed out", "TimeoutError"), "timeout", "TimeoutError"],
    [new TypeError("x"), "TypeError", "TypeError"],
    [createNetworkFault(ERR_TIMEOUT), "DefjsFault", "DefjsFault"],
  ])(
    "error.type of %s is %s and its exception.type is %s",
    (error, errorType, exceptionType) => {
      expect(getErrorType(error)).toBe(errorType);
      expect(getExceptionType(error)).toBe(exceptionType);
    },
  );
});
