import { afterEach, describe, expect, test, vi } from "vitest";
import {
  __resetStreamingRequestBodySupportForTests,
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  isReadableStreamBody,
  supportsStreamingRequestBody,
} from "./fetch_init";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "../../client";
import type { HttpRequest } from "../../http";
import { createHttpInterceptor } from "../../interceptor";
import { defineRequest } from "../index";
import {
  installProbeRequest,
  simulateUnsupportedStreaming,
} from "../../../test/streaming-support";
import { createFetchRequest, fetchHandler } from "./fetch";

function streamBody(body: unknown): ReadableStream<Uint8Array> {
  if (isReadableStreamBody(body)) return body;
  throw new Error("expected stream");
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetStreamingRequestBodySupportForTests();
});

describe("Fetch handler streaming", () => {
  test("should throw when runtime does not support streaming request bodies", () => {
    class FakeRequest {
      body = null;

      constructor(
        _input: URL | string,
        init?: RequestInit & { duplex?: "half" },
      ) {
        if (init?.body instanceof ReadableStream) {
          throw new TypeError(
            "ReadableStream request bodies are not supported",
          );
        }
      }
    }

    vi.stubGlobal("Request", FakeRequest);

    expect(supportsStreamingRequestBody()).toBe(false);

    const requestConfig: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/stream",
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    };

    expect(() => createFetchRequest(requestConfig)).toThrow(
      ERR_STREAMING_REQUEST_UNSUPPORTED,
    );
  });

  test("should skip upload wrapping for non-streamable bodies without a counted type", async () => {
    const uploadProgress = vi.fn();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    const response = await fetchHandler(
      {
        baseEndpoint: "https://example.com",
        body: "plain-text-body",
        endpoint: "/upload",
        method: "POST",
        responseType: "text",
        uploadProgress,
      },
      fetchMock,
    );

    expect(response.body).toBe("ok");
    expect(uploadProgress).not.toHaveBeenCalled();
  });
});

describe("streaming request body capability", () => {
  test("should treat a non-null stream body with an implicit Content-Type as unsupported", () => {
    installProbeRequest("text/plain;charset=UTF-8");

    expect(supportsStreamingRequestBody()).toBe(false);
  });

  test("should refuse a ReadableStream body when the runtime adds an implicit Content-Type", () => {
    installProbeRequest("text/plain;charset=UTF-8");

    expect(() =>
      createFetchRequest({
        baseEndpoint: "https://example.com",
        body: closedUploadStream(),
        endpoint: "/upload",
        method: "POST",
      }),
    ).toThrow(ERR_STREAMING_REQUEST_UNSUPPORTED);
  });

  test("should treat a non-null stream body without a Content-Type as supported", () => {
    installProbeRequest();

    expect(supportsStreamingRequestBody()).toBe(true);
  });

  test("should probe streaming support once until the test reset", () => {
    let constructions = 0;
    installProbeRequest(undefined, () => {
      constructions += 1;
    });

    expect(supportsStreamingRequestBody()).toBe(true);
    expect(supportsStreamingRequestBody()).toBe(true);
    expect(constructions).toBe(1);

    __resetStreamingRequestBodySupportForTests();

    expect(supportsStreamingRequestBody()).toBe(true);
    expect(constructions).toBe(2);
  });
});

describe("unsupported streaming request body", () => {
  test("should report ENV_UNSUPPORTED for a ReadableStream body before calling the handle", async () => {
    simulateUnsupportedStreaming();
    const stream = byteStream();
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const client = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(handle),
    );
    const upload = defineRequest({
      builder: () => ({ body: stream }),
      method: "POST",
      path: "/upload",
    });

    const [error, result, response] = await upload(client);

    expect(error?.code).toBe("ENV_UNSUPPORTED");
    expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
    expect(error?.cause instanceof Error ? error.cause.message : "").toBe(
      "ERR_STREAMING_REQUEST_UNSUPPORTED",
    );
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(handle).toHaveBeenCalledTimes(0);
    expect(stream.locked).toBe(false);
  });

  test("should report ENV_UNSUPPORTED for a ReadableStream body when onUploadProgress is set", async () => {
    simulateUnsupportedStreaming();
    const stream = byteStream();
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const onUploadProgress = vi.fn();
    const client = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(handle),
    );
    const upload = defineRequest({
      builder: () => ({ body: stream }),
      method: "POST",
      path: "/upload",
    });

    const [error, result, response] = await upload(
      client({ onUploadProgress }),
    );

    expect(error?.code).toBe("ENV_UNSUPPORTED");
    expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
    expect(error?.cause instanceof Error ? error.cause.message : "").toBe(
      "ERR_STREAMING_REQUEST_UNSUPPORTED",
    );
    expect(result).toBeUndefined();
    expect(response).toBeUndefined();
    expect(handle).toHaveBeenCalledTimes(0);
    expect(onUploadProgress).toHaveBeenCalledTimes(0);
    expect(stream.locked).toBe(false);
  });

  test("should let an interceptor resend the unlocked stream as a Blob", async () => {
    simulateUnsupportedStreaming();
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const stream = byteStream(bytes);
    let received = new Uint8Array();
    const handle = vi.fn(async (input: RequestInfo | URL) => {
      if (!(input instanceof Request)) {
        throw new TypeError("expected Request");
      }
      received = new Uint8Array(await input.arrayBuffer());
      return new Response("ok", {
        headers: { "content-type": "text/plain" },
        status: 200,
      });
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(handle),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          try {
            return await next(request);
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "ERR_STREAMING_REQUEST_UNSUPPORTED"
            ) {
              throw error;
            }
            expect(stream.locked).toBe(false);
            const blob = await new Response(streamBody(request.body)).blob();
            return await next({ ...request, body: blob });
          }
        }),
      ),
    );
    const upload = defineRequest({
      builder: () => ({ body: stream }),
      method: "POST",
      path: "/upload",
    });

    const [error] = await upload(client);

    expect(error).toBeNull();
    expect(handle).toHaveBeenCalledTimes(1);
    expect(Array.from(received)).toEqual(Array.from(bytes));
  });
});

function byteStream(
  bytes: Uint8Array = Uint8Array.from([1, 2, 3, 4]),
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function closedUploadStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}
