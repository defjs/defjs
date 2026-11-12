import { resolveRetryPolicy } from "../../src/internal/retry.ts";
import { describe, expect, inject, test, vi } from "vitest";
import type { FetchHandle } from "../../src/client/config.ts";
import { DEFAULT_FETCH } from "../../src/client/config.ts";
import type { HttpRequest } from "../../src/http/index.ts";
import { ERR_STREAMING_REQUEST_UNSUPPORTED } from "../../src/http/transport/fetch_init.ts";
import { type FetchEventStreamOptions } from "../../src/sse/transport/event_stream.ts";
import type { EventStreamMessage } from "../../src/sse/transport/parser.ts";
import { startEventStream } from "../start-event-stream.ts";
import {
  uploadOutcome,
  type UploadCapability,
  type UploadOutcome,
  type UploadTransport,
} from "../upload-capability.ts";

function fetchEventStream(
  request: HttpRequest,
  options: Omit<
    FetchEventStreamOptions<EventStreamMessage>,
    "fetch" | "maxBufferSize" | "transformMessage"
  > &
    Partial<Pick<FetchEventStreamOptions<EventStreamMessage>, "fetch">> = {},
) {
  return startEventStream(request, {
    fetch: DEFAULT_FETCH,
    maxBufferSize: 1024,
    transformMessage: (message) => message,
    ...options,
  });
}

function createRequest(endpoint: string): HttpRequest {
  return {
    baseEndpoint: inject("testServerHost"),
    endpoint,
    method: "GET",
  };
}

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

async function expectRejectedOpen(
  outcome: Exclude<UploadOutcome, "observed">,
  opening: Promise<unknown>,
): Promise<void> {
  const error: unknown = await opening.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  switch (outcome) {
    case "unsupported":
      expect(error).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
      return;
    case "unreachable":
      // The open promise rejects with the platform fetch cause. The HTTP client
      // is what reports that cause as NET_UNREACHABLE.
      expect(error).toBeInstanceOf(TypeError);
      expect(error instanceof TypeError ? error.message : "").toBe(
        "Failed to fetch",
      );
      return;
    case "bypassed":
      throw new Error("a ReadableStream upload is not bypassed");
  }
}

export function registerEventStreamAdvancedUploadSuite(
  cap: UploadCapability,
): void {
  describe("fetchEventStream advanced", () => {
    test("should support streaming request body", async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });
      const request: HttpRequest = {
        ...createRequest("/sse/basic"),
        body,
        method: "POST",
      };
      const outcome = uploadOutcome(cap, "ReadableStream", "platform");
      if (outcome !== "observed") {
        await expectRejectedOpen(outcome, fetchEventStream(request));
        if (outcome === "unsupported") expect(body.locked).toBe(false);
        return;
      }

      const stream = await fetchEventStream(request);
      const events: EventStreamMessage[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      expect(events.length).toBeGreaterThan(0);
    });

    test("should not reconnect a ReadableStream body after a startup failure", async () => {
      await expectStreamStartup(cap, "custom");
    });

    test("should end an opened ReadableStream-body stream with the original read error", async () => {
      const failure = new TypeError("network down");
      const shouldRetry = vi.fn(() => true);
      const body = byteStream();
      const fetch = vi.fn<FetchHandle>(async (input) => {
        const request = requireRequest(input);
        await request.arrayBuffer();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode("id: 1\ndata: a\n\n"),
              );
            },
            pull(controller) {
              controller.error(failure);
            },
          }),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        );
      });
      const opening = fetchEventStream(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/events",
          method: "POST",
          body,
        },
        {
          fetch,
          retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0, shouldRetry }),
        },
      );
      const outcome = uploadOutcome(cap, "ReadableStream", "custom");
      if (outcome !== "observed") {
        await expectRejectedOpen(outcome, opening);
        expect(fetch).not.toHaveBeenCalled();
        expect(shouldRetry).not.toHaveBeenCalled();
        expect(body.locked).toBe(false);
        return;
      }

      const stream = await opening;
      const iterator = stream[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { data: "a", event: "", id: "1" },
      });
      await expect(iterator.next()).rejects.toBe(failure);
      const closed = await stream.closed;
      expect(closed).toMatchObject({ kind: "error", code: "NET_UNREACHABLE" });
      expect(closed.cause).toBe(failure);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledTimes(0);
    });

    test("should not reconnect a ReadableStream body after a 307 redirect", async () => {
      const shouldRetry = vi.fn(() => true);
      const body = byteStream();
      const opening = fetchEventStream(
        {
          ...createRequest("/sse/redirect/307"),
          body,
          method: "POST",
        },
        {
          retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0, shouldRetry }),
        },
      );
      const outcome = uploadOutcome(cap, "ReadableStream", "platform");
      if (outcome !== "observed") {
        await expectRejectedOpen(outcome, opening);
        expect(shouldRetry).not.toHaveBeenCalled();
        if (outcome === "unsupported") expect(body.locked).toBe(false);
        return;
      }

      const error: unknown = await opening.then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(error).toBeInstanceOf(TypeError);
      expect(error instanceof Error ? error.message : "").not.toMatch(
        /disturbed|locked/,
      );
      expect(shouldRetry).toHaveBeenCalledTimes(0);
    });

    test("should open a ReadableStream body after a 303 redirect", async () => {
      const shouldRetry = vi.fn(() => true);
      const body = byteStream();
      const opening = fetchEventStream(
        {
          ...createRequest("/sse/redirect/303"),
          body,
          method: "POST",
        },
        {
          retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0, shouldRetry }),
        },
      );
      const outcome = uploadOutcome(cap, "ReadableStream", "platform");
      if (outcome !== "observed") {
        await expectRejectedOpen(outcome, opening);
        expect(shouldRetry).not.toHaveBeenCalled();
        if (outcome === "unsupported") expect(body.locked).toBe(false);
        return;
      }

      const stream = await opening;
      const events: EventStreamMessage[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      expect(events).toEqual([
        { id: "1", event: "message", data: "first" },
        { id: "2", event: "message", data: "second line 1\nsecond line 2" },
      ]);
      expect(shouldRetry).toHaveBeenCalledTimes(0);
    });
  });

  async function expectStreamStartup(
    capability: UploadCapability,
    transport: UploadTransport,
  ): Promise<void> {
    const failure = new TypeError("network down");
    const shouldRetry = vi.fn(() => true);
    const body = byteStream();
    const fetch = vi.fn<FetchHandle>(async (input) => {
      const request = requireRequest(input);
      await request.arrayBuffer();
      throw failure;
    });
    const opening = fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/events",
        method: "POST",
        body,
      },
      {
        fetch,
        retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0, shouldRetry }),
      },
    );
    const outcome = uploadOutcome(capability, "ReadableStream", transport);
    if (outcome !== "observed") {
      await expectRejectedOpen(outcome, opening);
      expect(fetch).not.toHaveBeenCalled();
      expect(shouldRetry).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
      return;
    }

    await expect(opening).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(0);
  }
}
