import { describe, expect, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withInterceptors,
  withSSEHandle,
  withRetry,
} from "../../src/client/index.ts";
import { createSSEInterceptor } from "../../src/interceptor/index.ts";
import { struct } from "../../src/struct/index.ts";
import { defineEventStream } from "../../src/sse/index.ts";
import {
  uploadOutcome,
  type UploadCapability,
  type UploadOutcome,
} from "../upload-capability.ts";
import { expectUploadOutcome } from "../upload-outcome-assert.ts";

function byteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
      controller.close();
    },
  });
}

function requireRequest(input: RequestInfo | URL): Request {
  if (!(input instanceof Request)) {
    throw new TypeError("SSE handle received a non-Request");
  }
  return input;
}

function expectCustomStream(
  outcome: UploadOutcome,
  attempt: {
    fault: { code: string; cause?: unknown } | null;
    events: unknown;
    open: unknown;
    handleCalls: number;
    reconnectCalls: number;
    body: ReadableStream<Uint8Array> | undefined;
  },
): void {
  switch (outcome) {
    case "observed":
      return;
    case "unsupported":
      expectUploadOutcome(outcome, {
        error: attempt.fault,
        result: attempt.events,
        response: attempt.open,
        observerCalls: attempt.reconnectCalls,
      });
      expect(attempt.handleCalls).toBe(0);
      expect(attempt.body?.locked).toBe(false);
      return;
    case "bypassed":
    case "unreachable":
      throw new Error(`a custom ReadableStream upload is not ${outcome}`);
  }
}

export function registerSseFaultUploadSuite(cap: UploadCapability): void {
  describe("ReadableStream body and reconnect", () => {
    test("should not reconnect when the handle reads a stream body and fails", async () => {
      const failure = new TypeError("network down");
      const body = byteStream();
      const shouldRetry = vi.fn(() => true);
      const handle = vi.fn(async (input: RequestInfo | URL) => {
        const request = requireRequest(input);
        await request.arrayBuffer();
        throw failure;
      });
      const client = createClient(
        withEndpoint("https://example.com"),
        withSSEHandle(handle),
        withRetry({ maxRetries: 2, delayMs: 0, shouldRetry }),
      );
      const useStream = defineEventStream({
        builder: () => ({ body }),
        events: { message: struct.string() },
        method: "POST",
        path: "/events",
      });

      const [fault, events, open] = await useStream(client);
      const outcome = uploadOutcome(cap, "ReadableStream", "custom");
      if (outcome !== "observed") {
        expectCustomStream(outcome, {
          fault,
          events,
          open,
          handleCalls: handle.mock.calls.length,
          reconnectCalls: shouldRetry.mock.calls.length,
          body,
        });
        return;
      }

      expect(events).toBeUndefined();
      expect(open).toBeUndefined();
      expect(fault?.code).toBe("NET_UNREACHABLE");
      expect(fault?.cause).toBe(failure);
      expect(handle).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledTimes(0);
    });

    test("should not reconnect when an interceptor replaces the body with a stream", async () => {
      const failure = new TypeError("network down");
      const shouldRetry = vi.fn(() => true);
      const replaced: ReadableStream<Uint8Array>[] = [];
      const handle = vi.fn(async (input: RequestInfo | URL) => {
        const request = requireRequest(input);
        await request.arrayBuffer();
        throw failure;
      });
      const client = createClient(
        withEndpoint("https://example.com"),
        withSSEHandle(handle),
        withRetry({ maxRetries: 2, delayMs: 0, shouldRetry }),
        withInterceptors(
          createSSEInterceptor(async (request, next) => {
            const body = byteStream();
            replaced.push(body);
            return await next({ ...request, body });
          }),
        ),
      );
      const useStream = defineEventStream({
        builder: () => ({ body: "prompt" }),
        events: { message: struct.string() },
        method: "POST",
        path: "/events",
      });

      const [fault, events, open] = await useStream(client);
      const outcome = uploadOutcome(cap, "ReadableStream", "custom");
      if (outcome !== "observed") {
        expectCustomStream(outcome, {
          fault,
          events,
          open,
          handleCalls: handle.mock.calls.length,
          reconnectCalls: shouldRetry.mock.calls.length,
          body: replaced[0],
        });
        return;
      }

      expect(events).toBeUndefined();
      expect(open).toBeUndefined();
      expect(fault?.code).toBe("NET_UNREACHABLE");
      expect(fault?.cause).toBe(failure);
      expect(handle).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledTimes(0);
    });
  });
}
