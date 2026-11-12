import { describe, expect, test, vi } from "vitest";
import type { HttpRequest } from "../../src/http/index.ts";
import {
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  isReadableStreamBody,
  supportsStreamingRequestBody,
} from "../../src/http/transport/fetch_init.ts";
import {
  uploadOutcome,
  type UploadCapability,
  type UploadOutcome,
} from "../upload-capability.ts";
import { initOf } from "../fetch-request-init.ts";

function streamBody(body: unknown): ReadableStream<Uint8Array> {
  if (isReadableStreamBody(body)) return body;
  throw new Error("expected stream");
}

function helloStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello"));
      controller.close();
    },
  });
}

function expectUnsupportedInit(opening: () => unknown): void {
  expect(opening).toThrow(ERR_STREAMING_REQUEST_UNSUPPORTED);
}

export function registerFetchUploadSuite(cap: UploadCapability): void {
  describe("Fetch handler request creation", () => {
    test("should auto set duplex half for ReadableStream body", () => {
      const body = helloStream();
      const requestConfig: HttpRequest = {
        baseEndpoint: "https://example.com",
        endpoint: "/stream",
        method: "POST",
        body,
      };
      const outcome = uploadOutcome(cap, "ReadableStream", "custom");
      if (outcome !== "observed") {
        expectUnsupported(outcome, () => initOf(requestConfig));
        expect(body.locked).toBe(false);
        return;
      }

      const init = initOf(requestConfig);
      expect(init.duplex).toBe("half");
    });

    test.each([
      { contentLength: "-1", total: 0 },
      { contentLength: "not-a-number", total: 0 },
      { contentLength: "Infinity", total: 0 },
      { contentLength: "100", total: 100 },
      { contentLength: undefined, total: 0 },
      { contentLength: "0", total: 0 },
    ])(
      "should count upload bytes with Content-Length $contentLength",
      async ({ contentLength, total }) => {
        const events: Array<{
          lengthComputable: boolean;
          loaded: number;
          total: number;
        }> = [];
        const body = helloStream();
        const requestConfig: HttpRequest = {
          baseEndpoint: "https://example.com",
          endpoint: "/v1/user",
          headers: new Headers(
            contentLength === undefined
              ? {}
              : { "Content-Length": contentLength },
          ),
          method: "POST",
          uploadProgress(event) {
            events.push(event);
          },
          body,
        };
        const outcome = uploadOutcome(cap, "ReadableStream", "custom");
        if (outcome !== "observed") {
          expectUnsupported(outcome, () => initOf(requestConfig));
          expect(events).toEqual([]);
          expect(body.locked).toBe(false);
          return;
        }

        expect(supportsStreamingRequestBody()).toBe(true);
        const init = initOf(requestConfig);
        expect(init.duplex).toBe("half");
        expect(await new Response(init.body).text()).toBe("hello");
        expect(events).toEqual([
          { lengthComputable: total > 0, loaded: 5, total },
        ]);
      },
    );

    test("should handle upload progress stream cancel", async () => {
      const stream = helloStream();
      const requestConfig: HttpRequest = {
        baseEndpoint: "https://example.com",
        endpoint: "/v1/upload",
        method: "POST",
        body: stream,
        uploadProgress: vi.fn(),
      };
      const outcome = uploadOutcome(cap, "ReadableStream", "custom");
      if (outcome !== "observed") {
        expectUnsupported(outcome, () => initOf(requestConfig));
        expect(stream.locked).toBe(false);
        return;
      }

      const init = initOf(requestConfig);
      const reader = streamBody(init.body).getReader();
      const { value } = await reader.read();
      expect(value).toBeDefined();
      await reader.cancel("test-cancel");
    });

    test("should propagate upload progress stream read errors", async () => {
      const error = new Error("source failed");
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          throw error;
        },
      });
      const requestConfig: HttpRequest = {
        baseEndpoint: "https://example.com",
        endpoint: "/v1/upload",
        method: "POST",
        body: stream,
        uploadProgress: vi.fn(),
      };
      const outcome = uploadOutcome(cap, "ReadableStream", "custom");
      if (outcome !== "observed") {
        expectUnsupported(outcome, () => initOf(requestConfig));
        expect(stream.locked).toBe(false);
        return;
      }

      const init = initOf(requestConfig);
      const reader = streamBody(init.body).getReader();
      await expect(reader.read()).rejects.toThrow("source failed");
    });
  });
}

function expectUnsupported(
  outcome: UploadOutcome,
  opening: () => unknown,
): void {
  switch (outcome) {
    case "unsupported":
      expectUnsupportedInit(opening);
      return;
    case "observed":
    case "bypassed":
    case "unreachable":
      throw new Error(`a local ReadableStream init is not ${outcome}`);
  }
}
