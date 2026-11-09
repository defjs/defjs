import { afterEach, describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint, withHTTPHandle } from "../../client";
import { defineRequest } from "../../http";
import { __resetStreamingRequestBodySupportForTests } from "./fetch";

function requireRequest(input: RequestInfo | URL): Request {
  if (input instanceof Request) return input;
  throw new Error("expected Request");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetStreamingRequestBodySupportForTests();
});

describe("HTTP transport FormData stalls on Node", () => {
  test.each(["timeout", "abort"] as const)(
    "should promptly settle a stalled native FormData File upload on %s and unlock the serialized reader",
    async (mode) => {
      // Serialization stays frozen until the file stream's pull runs.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      let release!: () => void;
      let opened!: () => void;
      const reading = new Promise<void>((resolve) => {
        opened = resolve;
      });
      const source = new ReadableStream<Uint8Array<ArrayBuffer>>(
        {
          pull() {
            opened();
            return new Promise<void>(() => undefined);
          },
          start(controller) {
            release = () => controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      class StalledFile extends File {
        override stream() {
          return source;
        }
      }
      const form = new FormData();
      form.append("file", new StalledFile(["x"], "stalled.txt"));
      const serialized: { body?: ReadableStream<Uint8Array> | null } = {};
      class TrackedResponse extends Response {
        constructor(body?: BodyInit | null, init?: ResponseInit) {
          super(body, init);
          if (body === form) {
            serialized.body = this.body;
          }
        }
      }
      vi.stubGlobal("Response", TrackedResponse);
      const controller = new AbortController();
      const client = createClient(
        withEndpoint("https://example.com"),
        withHTTPHandle(async (input) => {
          await requireRequest(input).arrayBuffer();
          return new Response(null, { status: 204 });
        }),
      );
      const endpoint = defineRequest({
        builder: () => ({ body: form }),
        method: "POST",
        path: "/upload",
      });
      const pending = endpoint(
        client({
          signal: controller.signal,
          onUploadProgress: () => undefined,
        }),
      );
      try {
        // Node 24 resumes FormData serialization on a zero-delay timer and
        // reads the file on the following immediate. Flush both before cancelling.
        vi.advanceTimersByTime(0);
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        await reading;
        expect(serialized.body).not.toBeNull();
        expect(serialized.body?.locked).toBe(true);
        controller.abort(
          mode === "timeout"
            ? new DOMException("deadline", "TimeoutError")
            : undefined,
        );
        const [fault] = await pending;
        expect(fault?.code).toBe(
          mode === "timeout" ? "NET_TIMEOUT" : "NET_ABORTED",
        );
        expect(serialized.body?.locked).toBe(false);
      } finally {
        vi.useRealTimers();
        if (serialized.body?.locked) {
          release();
        }
        await pending;
      }
    },
  );
});
