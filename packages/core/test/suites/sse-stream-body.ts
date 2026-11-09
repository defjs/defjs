import { beforeEach, describe, expect, inject, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withSSEReconnect,
} from "../../src/client/index.ts";
import type { Client } from "../../src/client/index.ts";
import { ERR_STREAMING_REQUEST_UNSUPPORTED } from "../../src/http/transport/fetch_init.ts";
import { defineEventStream } from "../../src/sse/index.ts";
import { struct } from "../../src/struct/index.ts";
import { missHits } from "../miss-log.ts";
import { uploadOutcome, type UploadCapability } from "../upload-capability.ts";

export function registerSseStreamBodySuite(
  cap: UploadCapability,
  browser: "chromium" | "firefox",
): void {
  describe("sse stream body", () => {
    let baseClient: Client;

    beforeEach(() => {
      baseClient = createClient(withEndpoint(inject("testServerHost")));
    });

    test("should refuse or fail a caller-supplied ReadableStream without posting it", async () => {
      const path = `/e2e/miss/sse-stream-body-${browser}-${Date.now()}`;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
          controller.close();
        },
      });
      const useStream = defineEventStream({
        builder: () => ({ body: stream }),
        events: { message: struct.string() },
        method: "POST",
        path,
      });

      const [error, events] = await useStream(baseClient);
      const hits = await missHits(baseClient, path);

      expect(events).toBeUndefined();
      if (uploadOutcome(cap, "ReadableStream", "platform") === "unsupported") {
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
      const path = `/e2e/miss/sse-stream-body-reconnect-${browser}-${Date.now()}`;
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
        method: "POST",
        path,
      });

      const [error, events] = await useStream(client);
      const hits = await missHits(client, path);

      expect(events).toBeUndefined();
      expect(shouldReconnect).toHaveBeenCalledTimes(0);
      if (uploadOutcome(cap, "ReadableStream", "platform") === "unsupported") {
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
}
