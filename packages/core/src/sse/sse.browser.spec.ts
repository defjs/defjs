import { beforeEach, describe, expect, inject, test, vi } from "vitest";
import { server } from "vitest/browser";

import { createClient, withEndpoint, withSSEReconnect } from "../client";
import type { Client } from "../client";
import { ERR_STREAMING_REQUEST_UNSUPPORTED } from "../http/transport/fetch_init";
import { struct } from "../struct";
import { missHits } from "../../test/miss-log";
import { defineEventStream } from "./index";

describe("sse browser runtime", () => {
  let baseClient: Client;

  beforeEach(() => {
    baseClient = createClient(withEndpoint(inject("testServerHost")));
  });

  test("should consume event streams in real browsers", async () => {
    const useBasicStream = defineEventStream({
      maxBufferSize: 1024,
      maxQueueSize: 16,
      events: {
        message: struct.string(),
      },
      path: "/sse/basic",
    });

    const [error, stream, open] = await baseClient.execute(useBasicStream());

    expect(error).toBeNull();
    expect(open?.response?.ok).toBe(true);
    if (!stream) {
      throw new Error("Expected event stream");
    }

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.data);
    }

    expect(events).toEqual(["first", "second line 1\nsecond line 2"]);
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test("should return the fixed error tuple for non-2xx open responses in real browsers", async () => {
    const useFailedStream = defineEventStream({
      maxBufferSize: 1024,
      maxQueueSize: 16,
      events: {
        message: struct.string(),
      },
      path: "/500",
    });

    const [error, stream, open] = await baseClient.execute(useFailedStream());

    expect(error?.code).toBe("HTTP_STATUS");
    expect(stream).toBeUndefined();
    expect(open?.response?.status).toBe(500);
  });

  test("should close an open stream when browser iteration stops early", async () => {
    const useStream = defineEventStream({
      maxBufferSize: 1024,
      maxQueueSize: 16,
      events: { tick: struct.string() },
      path: "/sse/infinite",
    });
    const [error, stream] = await baseClient.execute(useStream());

    expect(error).toBeNull();
    if (!stream) {
      throw new Error("Expected event stream");
    }

    for await (const event of stream) {
      expect(event.event).toBe("tick");
      break;
    }

    await expect(stream.closed).resolves.toMatchObject({
      kind: "aborted",
      reason: "iterator-return",
    });
  });

  test("should skip unexpected events in real browsers", async () => {
    const useStream = defineEventStream({
      maxBufferSize: 1024,
      maxQueueSize: 16,
      events: {
        message: struct.number(),
      },
      path: "/sse/basic",
    });

    const [error, stream] = await baseClient.execute(useStream());

    expect(error).toBeNull();
    if (!stream) {
      throw new Error("Expected event stream");
    }

    const events: unknown[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });

  test("should refuse or fail a caller-supplied ReadableStream without posting it", async () => {
    if (server.browser !== "chromium" && server.browser !== "firefox") {
      throw new Error(`unexpected browser ${server.browser}`);
    }

    const path = `/e2e/miss/sse-stream-body-${server.browser}-${Date.now()}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
        controller.close();
      },
    });
    const useStream = defineEventStream({
      builder: () => ({ body: stream }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      method: "POST",
      path,
    });

    const [error, events] = await baseClient.execute(useStream());
    const hits = await missHits(baseClient, path);

    expect(events).toBeUndefined();
    if (server.browser === "firefox") {
      expect(error?.code).toBe("ENV_UNSUPPORTED");
      expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
      expect(hits).toEqual([]);
      expect(stream.locked).toBe(false);
      return;
    }
    expect(error?.code).toBe("NET_UNREACHABLE");
    expect(error?.cause).toBeInstanceOf(TypeError);
    expect(error?.cause instanceof Error ? error.cause.message : "").toBe(
      "Failed to fetch",
    );
    expect(hits).toEqual([`OPTIONS ${path}`]);
    expect(stream.locked).toBe(true);
  });

  test("should not reconnect a caller-supplied ReadableStream body", async () => {
    if (server.browser !== "chromium" && server.browser !== "firefox") {
      throw new Error(`unexpected browser ${server.browser}`);
    }

    const path = `/e2e/miss/sse-stream-body-reconnect-${server.browser}-${Date.now()}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
        controller.close();
      },
    });
    const shouldReconnect = vi.fn(() => true);
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withSSEReconnect({ attempts: 2, delayMs: 0, shouldReconnect }),
    );
    const useStream = defineEventStream({
      builder: () => ({ body: stream }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      method: "POST",
      path,
    });

    const [error, events] = await client.execute(useStream());
    const hits = await missHits(client, path);

    expect(events).toBeUndefined();
    expect(shouldReconnect).toHaveBeenCalledTimes(0);
    if (server.browser === "firefox") {
      expect(error?.code).toBe("ENV_UNSUPPORTED");
      expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
      expect(hits).toEqual([]);
      return;
    }
    expect(error?.code).toBe("NET_UNREACHABLE");
    expect(error?.cause).toBeInstanceOf(TypeError);
    expect(error?.cause instanceof Error ? error.cause.message : "").toBe(
      "Failed to fetch",
    );
    expect(hits).toEqual([`OPTIONS ${path}`]);
  });
});
