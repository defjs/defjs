import { createNetworkFault, ERR_TIMEOUT } from "@defjs/core";
import { diag, ROOT_CONTEXT } from "@opentelemetry/api";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMockLogger } from "../../test/mocks";
import { emitClientException } from "./logs";

describe("client exception logs", () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([
    {
      kind: "operation",
      eventName: "defjs.client.operation.exception",
      body: "Defjs operation failed",
    },
    {
      kind: "sse",
      eventName: "defjs.client.sse.exception",
      body: "SSE client connection failed",
    },
    {
      kind: "websocket",
      eventName: "defjs.client.websocket.exception",
      body: "WebSocket client connection failed",
    },
  ] as const)(
    "emits a correlated WARN without error text for $kind",
    ({ kind, eventName, body }) => {
      const { logger, records } = createMockLogger();
      emitClientException(logger, {
        kind,
        context: ROOT_CONTEXT,
        error: new TypeError("password=secret"),
        attributes: {
          "defjs.meta.operation": "orders.create",
          "server.address": "api.example.com",
        },
        includeErrorDiagnostics: false,
      });
      expect(records).toEqual([
        {
          eventName,
          body,
          context: ROOT_CONTEXT,
          severityNumber: 13,
          severityText: "WARN",
          attributes: {
            "defjs.meta.operation": "orders.create",
            "server.address": "api.example.com",
            "exception.type": "TypeError",
          },
        },
      ]);
      expect(JSON.stringify(records)).not.toContain("secret");
    },
  );

  test.each([
    [ERR_TIMEOUT, "Error"],
    [new DOMException("timeout", "TimeoutError"), "TimeoutError"],
    [createNetworkFault(ERR_TIMEOUT), "DefjsFault"],
    ["private-string", "string"],
    [17, "number"],
    [null, "_OTHER"],
    [undefined, "_OTHER"],
    [{ details: "secret" }, "object"],
  ])("records only the exception type of %s by default", (error, type) => {
    const { logger, records } = createMockLogger();
    emitClientException(logger, {
      kind: "operation",
      context: ROOT_CONTEXT,
      error,
      attributes: {},
      includeErrorDiagnostics: false,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toEqual({ "exception.type": type });
    expect(JSON.stringify(records)).not.toContain("private-string");
    expect(JSON.stringify(records)).not.toContain("secret");
  });

  test("includeErrorDiagnostics adds the message and the stack, never the cause or enumerable fields", () => {
    const { logger, records } = createMockLogger();
    const cause = Object.assign(new TypeError("ECONNREFUSED"), {
      path: "https://api.example.com/?sign=SECRET",
    });
    const fault = createNetworkFault(cause);
    emitClientException(logger, {
      kind: "operation",
      context: ROOT_CONTEXT,
      error: fault,
      attributes: {},
      includeErrorDiagnostics: true,
    });
    expect(records[0]?.attributes).toEqual({
      "exception.type": "DefjsFault",
      "exception.message": "ECONNREFUSED",
      "exception.stacktrace": fault.stack,
    });
    expect(JSON.stringify(records)).not.toContain("SECRET");
  });

  test("includeErrorDiagnostics records the string of a value that is not an Error", () => {
    const { logger, records } = createMockLogger();
    emitClientException(logger, {
      kind: "sse",
      context: ROOT_CONTEXT,
      error: "stream broke",
      attributes: {},
      includeErrorDiagnostics: true,
    });
    expect(records[0]?.attributes).toEqual({
      "exception.type": "string",
      "exception.message": "stream broke",
    });
  });

  test("does not read error attributes without a logger", () => {
    const readName = vi.fn(() => {
      throw new Error("must not read");
    });
    const error = Object.defineProperty(new Error("private"), "name", {
      get: readName,
    });
    expect(() =>
      emitClientException(undefined, {
        kind: "operation",
        context: ROOT_CONTEXT,
        error,
        attributes: {},
        includeErrorDiagnostics: true,
      }),
    ).not.toThrow();
    expect(readName).not.toHaveBeenCalled();
  });

  test.each(["emit", "name", "diag"] as const)(
    "isolates %s failures from callers",
    (failure) => {
      const { logger } = createMockLogger();
      const report = vi.spyOn(diag, "error").mockImplementation(() => {
        if (failure === "diag") throw new Error("diagnostics failed");
      });
      const error = new Error("original private failure");
      if (failure === "name") {
        Object.defineProperty(error, failure, {
          get() {
            throw new Error("private getter failure");
          },
        });
      } else {
        logger.emit.mockImplementation(() => {
          throw new Error("private exporter failure");
        });
      }
      expect(() =>
        emitClientException(logger, {
          kind: "websocket",
          context: ROOT_CONTEXT,
          error,
          attributes: {},
          includeErrorDiagnostics: false,
        }),
      ).not.toThrow();
      expect(report).toHaveBeenCalledExactlyOnceWith(
        "@defjs/opentelemetry-server: failed to emit client diagnostic log",
      );
    },
  );
});
