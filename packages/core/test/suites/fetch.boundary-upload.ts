import { afterEach, describe, expect, inject, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
} from "../../src/client/index.ts";
import type { HttpProgressEvent } from "../../src/http/index.ts";
import { defineRequest } from "../../src/http/index.ts";
import { createHttpRequest } from "../../src/http/request.ts";
import { fetchHandler } from "../../src/http/transport/fetch.ts";
import { struct } from "../../src/struct/index.ts";
import {
  uploadOutcome,
  type UploadBodyKind,
  type UploadCapability,
  type UploadOutcome,
} from "../upload-capability.ts";
import { expectUploadOutcome } from "../upload-outcome-assert.ts";

function requireRequest(input: RequestInfo | URL): Request {
  if (input instanceof Request) return input;
  throw new Error("expected Request");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

export function registerFetchBoundaryUploadSuite(cap: UploadCapability): void {
  describe("HTTP transport boundary regressions", () => {
    test("should preserve the real outgoing multipart boundary and report unknown upload length", async () => {
      const form = new FormData();
      form.append(
        "file",
        new File(["streamed file"], "notes.txt", { type: "text/plain" }),
      );
      const events: HttpProgressEvent[] = [];
      const client = createClient(withEndpoint(inject("testServerHost")));
      const endpoint = defineRequest({
        builder: () => ({
          body: form,
          headers: { "content-type": "application/incorrect" },
        }),
        method: "POST",
        output: struct.object({
          bodyBase64: struct.string(),
          contentType: struct.string(),
        }),
        path: "/e2e/echo-raw",
      });
      const [fault, data, response] = await endpoint(
        client({
          onUploadProgress: (event) => {
            events.push(event);
          },
        }),
      );
      const outcome = uploadOutcome(cap, "FormData", "platform");
      switch (outcome) {
        case "observed":
        case "bypassed": {
          expect(fault).toBeNull();
          expect(data?.contentType).toContain("multipart/form-data");
          expect(data?.contentType).toContain("boundary=");
          const received = new Response(
            Uint8Array.from(atob(data?.bodyBase64 ?? ""), (character) =>
              character.charCodeAt(0),
            ),
            {
              headers: { "content-type": data?.contentType ?? "" },
            },
          );
          const uploaded = (await received.formData()).get("file");
          if (!(uploaded instanceof File)) throw new Error("expected File");
          expect(uploaded.name).toBe("notes.txt");
          expect(await uploaded.text()).toBe("streamed file");
          if (outcome === "bypassed") {
            expect(events).toEqual([]);
            return;
          }
          expect(events.length).toBeGreaterThanOrEqual(2);
          expect(events[0]).toEqual({
            lengthComputable: false,
            loaded: 0,
            total: 0,
          });
          expect(events.at(-1)?.loaded).toBeGreaterThan(0);
          expect(
            events.every(
              (event) => !event.lengthComputable && event.total === 0,
            ),
          ).toBe(true);
          return;
        }
        case "unreachable":
          expectUploadOutcome(outcome, {
            error: fault,
            observerCalls: events.length,
            response,
            result: data,
          });
          return;
        case "unsupported":
          throw new Error("FormData uploads are not rejected as unsupported");
      }
    });

    test.each(["timeout", "abort"] as const)(
      "should cancel and unlock a stalled serialized FormData stream on %s",
      async (mode) => {
        await expectCancelledStalledFormData(
          mode,
          uploadOutcome(cap, "FormData", "custom"),
        );
      },
    );

    test("should preserve a start observer failure even when converted stream cancellation rejects", async () => {
      const body = new Blob(["bytes"]);
      const cancel = vi.fn((_reason?: unknown) =>
        Promise.reject(new Error("cancel refused")),
      );
      const source = new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel });
      vi.spyOn(body, "stream").mockReturnValue(source);
      const cause = new Error("observer failed");
      const outcome = uploadOutcome(cap, "Blob", "custom");
      const attempt = fetchHandler(
        {
          baseEndpoint: "https://example.com",
          body,
          endpoint: "/",
          method: "POST",
          uploadProgress() {
            throw cause;
          },
        },
        () => Promise.resolve(new Response(null)),
      );
      switch (outcome) {
        case "observed":
          await expect(attempt).rejects.toMatchObject({
            code: "EXT_OBSERVER_FAILED",
            cause,
          });
          expect(cancel).toHaveBeenCalledOnce();
          expect(cancel.mock.calls[0]?.[0]).toBe(cause);
          expect(source.locked).toBe(false);
          return;
        case "bypassed": {
          const response = await attempt;
          expect(response.status).toBe(200);
          expect(cancel).not.toHaveBeenCalled();
          expect(source.locked).toBe(false);
          return;
        }
        case "unsupported":
        case "unreachable":
          throw new Error(`a custom Blob upload is not ${outcome}`);
      }
    });

    test.each([
      {
        kind: "Blob",
        body: () => new Blob(["bytes"], { type: "text/plain" }),
      },
      {
        kind: "File",
        body: () => new File(["bytes"], "bytes.txt", { type: "text/plain" }),
      },
      {
        kind: "ArrayBuffer",
        body: () => new TextEncoder().encode("bytes").buffer,
      },
    ] as const)(
      "should preserve declared types when converting a $kind for upload progress",
      async ({ kind, body }) => {
        const outcome = uploadOutcome(cap, bodyKind(kind), "custom");
        for (const declaration of [
          "header",
          "bodyContentType",
          "null",
        ] as const) {
          const payload = body();
          const request = createHttpRequest(
            "POST",
            "/upload",
            undefined,
            () => ({
              body: payload,
              headers:
                declaration === "header"
                  ? { "content-type": "application/custom" }
                  : undefined,
            }),
            {
              signal: new AbortController().signal,
              baseEndpoint: "https://example.com",
              responseType: "text",
            },
          );
          if (declaration === "bodyContentType") {
            request.bodyContentType = "application/custom";
          }
          if (declaration === "null") {
            request.bodyContentType = null;
          }
          let observerCalls = 0;
          request.uploadProgress = () => {
            observerCalls += 1;
          };
          let contentType: string | null = null;
          let sent = "";
          await fetchHandler(request, async (input) => {
            contentType = requireRequest(input).headers.get("content-type");
            sent = await requireRequest(input).text();
            return new Response("ok");
          });
          expect(sent).toBe("bytes");
          if (outcome === "bypassed" && declaration === "null") {
            expect(contentType).toBe(
              payload instanceof Blob ? payload.type : null,
            );
            expect(observerCalls).toBe(0);
            continue;
          }
          expect(contentType).toBe(
            declaration === "null" ? null : "application/custom",
          );
          if (outcome === "bypassed") expect(observerCalls).toBe(0);
        }
      },
    );
  });
}

function bodyKind(kind: "ArrayBuffer" | "Blob" | "File"): UploadBodyKind {
  switch (kind) {
    case "ArrayBuffer":
      return "ArrayBuffer";
    case "Blob":
    case "File":
      return "Blob";
  }
}

async function expectCancelledStalledFormData(
  mode: "timeout" | "abort",
  outcome: UploadOutcome,
): Promise<void> {
  const form = new FormData();
  const cancel = vi.fn();
  let release!: () => void;
  let entered!: () => void;
  const handleEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const source = new ReadableStream<Uint8Array>({
    cancel,
    start(controller) {
      release = () => controller.close();
    },
  });
  class SerializedResponse extends Response {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(
        body === form ? source : body,
        body === form
          ? {
              headers: {
                "content-type": "multipart/form-data; boundary=fixture",
              },
            }
          : init,
      );
    }
  }
  vi.stubGlobal("Response", SerializedResponse);
  const controller = new AbortController();
  const reason =
    mode === "timeout"
      ? new DOMException("deadline", "TimeoutError")
      : undefined;
  let observerCalls = 0;
  const client = createClient(
    withEndpoint("https://example.com"),
    withHTTPHandle(async (input) => {
      entered();
      await requireRequest(input).arrayBuffer();
      return new Response(null, { status: 204 });
    }),
  );
  const endpoint = defineRequest({
    builder: () => ({ body: form }),
    method: "POST",
    path: "/",
  });
  const pending = endpoint(
    client({
      signal: controller.signal,
      onUploadProgress() {
        observerCalls += 1;
      },
    }),
  );
  try {
    if (outcome === "bypassed") {
      const [fault] = await pending;
      expect(fault).toBeNull();
      expect(observerCalls).toBe(0);
      expect(cancel).not.toHaveBeenCalled();
      expect(source.locked).toBe(false);
      return;
    }
    if (outcome !== "observed") {
      throw new Error(`a custom FormData upload is not ${outcome}`);
    }
    await handleEntered;
    expect(source.locked).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    controller.abort(reason);
    const [fault] = await pending;
    expect(fault?.code).toBe(
      mode === "timeout" ? "NET_TIMEOUT" : "NET_ABORTED",
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  } finally {
    if (source.locked) {
      release();
      await pending;
    }
  }
}
