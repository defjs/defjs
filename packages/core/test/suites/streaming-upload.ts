import { afterEach, describe, expect, test, vi } from "vitest";
import type { FetchHandle } from "../../src/client/index.ts";
import { ERR_ABORTED } from "../../src/error/index.ts";
import { isBodyFailure } from "../../src/http/transport/body_failure.ts";
import { isReadableStreamBody } from "../../src/http/transport/fetch_init.ts";
import {
  __resetStreamingRequestBodySupportForTests,
  createFetchRequestInit,
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  fetchHandler,
  supportsStreamingRequestBody,
} from "../../src/http/transport/fetch.ts";
import { createNotesForm, notesFormBody } from "../multipart-fixture.ts";
import { uploadOutcome, type UploadCapability } from "../upload-capability.ts";

function streamBody(body: unknown): ReadableStream<Uint8Array> {
  if (isReadableStreamBody(body)) return body;
  throw new Error("expected stream");
}

function closedUploadStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

async function expectUnsupportedStream(
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  await expect(
    fetchHandler({
      baseEndpoint: "https://example.com",
      body: stream,
      endpoint: "/upload",
      method: "POST",
      uploadProgress: () => undefined,
    }),
  ).rejects.toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
  expect(stream.locked).toBe(false);
}

async function expectBypassedUpload(
  body: ArrayBuffer | Blob | FormData,
): Promise<void> {
  const uploadProgress = vi.fn();
  let received: Request | undefined;
  const handle: FetchHandle = (input) => {
    if (!(input instanceof Request)) throw new Error("expected Request");
    received = input;
    return Promise.resolve(
      new Response("ok", {
        headers: { "content-type": "text/plain" },
        status: 200,
      }),
    );
  };
  const response = await fetchHandler(
    {
      baseEndpoint: "https://example.com",
      body,
      endpoint: "/upload",
      method: "POST",
      responseType: "text",
      uploadProgress,
    },
    handle,
  );

  expect(response.body).toBe("ok");
  expect(uploadProgress).not.toHaveBeenCalled();
  if (!received) throw new Error("expected Request");
  const header = received.headers.get("content-type");
  const sent = new Uint8Array(await received.arrayBuffer());
  if (body instanceof FormData) {
    if (typeof header !== "string") {
      throw new Error("expected a content type");
    }
    expect(new TextDecoder().decode(sent)).toBe(notesFormBody(header));
    return;
  }
  if (body instanceof Blob) {
    expect(header).toBe(body.type || "application/octet-stream");
    expect(sent).toEqual(new Uint8Array(await body.arrayBuffer()));
    return;
  }
  expect(header).toBe("application/octet-stream");
  expect(sent).toEqual(new Uint8Array(body));
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetStreamingRequestBodySupportForTests();
});

export function registerStreamingUploadSuite(cap: UploadCapability): void {
  describe("streaming upload", () => {
    test("should call uploadProgress for ReadableStream body", async () => {
      const controller = new AbortController();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4, 5]));
          controller.close();
        },
      });

      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(stream);
        return;
      }

      const progressEvents: Array<{
        lengthComputable: boolean;
        loaded: number;
        total: number;
      }> = [];
      const fetchMock = vi.fn<FetchHandle>(async (input) => {
        if (!(input instanceof Request)) throw new Error("expected Request");
        const request = input;
        const reader = request.body?.getReader();

        if (reader) {
          while (true) {
            const { done } = await reader.read();
            if (done) {
              break;
            }
          }
        }

        return new Response("ok", {
          headers: {
            "content-type": "text/plain",
          },
          status: 200,
        });
      });

      vi.stubGlobal("fetch", fetchMock);

      try {
        const response = await fetchHandler({
          signal: controller.signal,
          body: stream,
          endpoint: "/upload",
          baseEndpoint: "https://example.com",
          method: "POST",
          responseType: "text",
          uploadProgress(event) {
            progressEvents.push({
              lengthComputable: event.lengthComputable,
              loaded: event.loaded,
              total: event.total,
            });
          },
        });

        expect(response.body).toBe("ok");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(progressEvents.length).toBeGreaterThan(0);
        expect(progressEvents.at(-1)?.loaded).toBeGreaterThan(0);
        expect(
          progressEvents.every(
            (event) => event.lengthComputable === false && event.total === 0,
          ),
        ).toBe(true);
        expect(progressEvents.map((event) => event.loaded)).toEqual([2, 5]);
        expect(progressEvents.at(-1)?.total).toBe(0);
        expect(stream.locked).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test("should preserve an async upload observer error and unlock without waiting for cancellation", async () => {
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(closedUploadStream());
        return;
      }

      const observerError = new Error("observer failed");
      const cancel = vi.fn(
        (_reason?: unknown) => new Promise<void>(() => undefined),
      );
      const stream = new ReadableStream<Uint8Array>({
        cancel,
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
      });
      const init = createFetchRequestInit({
        baseEndpoint: "https://example.com",
        body: stream,
        endpoint: "/upload",
        method: "POST",
        async uploadProgress() {
          await Promise.resolve();
          throw observerError;
        },
      });
      const reader = streamBody(init.body).getReader();

      await expect(settleWithin(reader.read())).rejects.toBe(observerError);
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(observerError);
      expect(stream.locked).toBe(false);
    });

    test("should unlock an upload body without waiting for consumer cancellation", async () => {
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(closedUploadStream());
        return;
      }

      const cancel = vi.fn(
        (_reason?: unknown) => new Promise<void>(() => undefined),
      );
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const init = createFetchRequestInit({
        baseEndpoint: "https://example.com",
        body: stream,
        endpoint: "/upload",
        method: "POST",
        uploadProgress: vi.fn(),
      });
      const reader = streamBody(init.body).getReader();

      await expect(
        settleWithin(reader.cancel("consumer canceled")),
      ).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe("consumer canceled");
      expect(stream.locked).toBe(false);
    });

    test("should clean up a wrapped upload body when Request construction fails", async () => {
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(closedUploadStream());
        return;
      }

      // Cache the real probe before this test replaces Request.
      supportsStreamingRequestBody();

      class FailingRequest {
        constructor() {
          throw new TypeError("Request construction failed");
        }
      }

      vi.stubGlobal("Request", FailingRequest);
      const cancel = vi.fn(
        (_reason?: unknown) => new Promise<void>(() => undefined),
      );
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const fetchMock = vi.fn<typeof fetch>();
      const failure = await settleWithin(
        fetchHandler(
          {
            baseEndpoint: "https://example.com",
            body: stream,
            endpoint: "/upload",
            method: "POST",
            uploadProgress: vi.fn(),
          },
          fetchMock,
        ).catch((cause: unknown) => cause),
      );

      expect(failure).toBeInstanceOf(TypeError);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(failure);
      expect(stream.locked).toBe(false);
    });

    test("should clean up a wrapped upload body when fetch rejects", async () => {
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(closedUploadStream());
        return;
      }

      const networkError = new Error("network failed");
      const cancel = vi.fn(
        (_reason?: unknown) => new Promise<void>(() => undefined),
      );
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const fetchMock = vi.fn(() => Promise.reject(networkError));
      const failure = await settleWithin(
        fetchHandler(
          {
            baseEndpoint: "https://example.com",
            body: stream,
            endpoint: "/upload",
            method: "POST",
            uploadProgress: vi.fn(),
          },
          fetchMock,
        ).catch((cause: unknown) => cause),
      );

      expect(failure).toBe(networkError);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(networkError);
      expect(stream.locked).toBe(false);
    });

    test("should clean up an upload body for a pre-aborted signal", async () => {
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(closedUploadStream());
        return;
      }

      const controller = new AbortController();
      controller.abort();
      const cancel = vi.fn(
        (_reason?: unknown) => new Promise<void>(() => undefined),
      );
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const fetchMock = vi.fn<typeof fetch>();
      const failure = await settleWithin(
        fetchHandler(
          {
            signal: controller.signal,
            baseEndpoint: "https://example.com",
            body: stream,
            endpoint: "/upload",
            method: "POST",
            uploadProgress: vi.fn(),
          },
          fetchMock,
        ).catch((cause: unknown) => cause),
      );

      expect(failure).toBe(ERR_ABORTED);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(controller.signal.reason);
      expect(stream.locked).toBe(false);
    });

    test("should unlock an upload body when a custom fetch ignores abort", async () => {
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(closedUploadStream());
        return;
      }

      const controller = new AbortController();
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
      const pending = fetchHandler(
        {
          signal: controller.signal,
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          uploadProgress: vi.fn(),
        },
        fetchMock,
      );

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      controller.abort();

      await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED);
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(controller.signal.reason);
      expect(stream.locked).toBe(false);
    });

    test("should unlock an upload body when a custom fetch consumes it and ignores abort", async () => {
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(closedUploadStream());
        return;
      }

      const controller = new AbortController();
      const cancel = vi.fn(
        (_reason?: unknown) => new Promise<void>(() => undefined),
      );
      let startPull!: () => void;
      const pullStarted = new Promise<void>((resolve) => {
        startPull = resolve;
      });
      const stream = new ReadableStream<Uint8Array>(
        {
          cancel,
          pull() {
            startPull();
            return new Promise<void>(() => undefined);
          },
        },
        { highWaterMark: 0 },
      );
      let startConsuming!: () => void;
      const consumingStarted = new Promise<void>((resolve) => {
        startConsuming = resolve;
      });
      const fetchMock = vi.fn<FetchHandle>(async (input) => {
        if (!(input instanceof Request)) throw new Error("expected Request");
        const request = input;
        const consuming = request.arrayBuffer();
        startConsuming();
        await consuming;
        return new Response();
      });
      const pending = fetchHandler(
        {
          signal: controller.signal,
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          uploadProgress: vi.fn(),
        },
        fetchMock,
      );

      await consumingStarted;
      await pullStarted;
      controller.abort();

      await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED);
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(controller.signal.reason);
      expect(stream.locked).toBe(false);
    });

    test.each([false, true])(
      "should clean up once when upload progress cancels its consumer (throw: %s)",
      async (throwAfterCancel) => {
        if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
          await expectUnsupportedStream(closedUploadStream());
          return;
        }

        const cancel = vi.fn(
          (_reason?: unknown) => new Promise<void>(() => undefined),
        );
        const stream = new ReadableStream<Uint8Array>({
          cancel,
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
        });
        const observerError = new Error("observer failed after cancel");
        const init = createFetchRequestInit({
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          uploadProgress() {
            void reader.cancel("observer canceled");
            if (throwAfterCancel) {
              throw observerError;
            }
          },
        });
        const reader = streamBody(init.body).getReader();

        await expect(settleWithin(reader.read())).resolves.toEqual({
          done: true,
          value: undefined,
        });
        expect(cancel).toHaveBeenCalledOnce();
        expect(cancel.mock.calls[0]?.[0]).toBe("observer canceled");
        expect(stream.locked).toBe(false);
      },
    );

    test("should preserve a fetch error when its request body is already locked", async () => {
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(closedUploadStream());
        return;
      }

      const networkError = new Error("network failed");
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ cancel });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const fetchMock = vi.fn<FetchHandle>((input) => {
        if (!(input instanceof Request))
          return Promise.reject(new Error("expected Request"));
        const request = input;
        reader = request.body?.getReader();
        return Promise.reject(networkError);
      });
      const failure = await fetchHandler(
        {
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          uploadProgress: vi.fn(),
        },
        fetchMock,
      ).catch((cause: unknown) => cause);

      expect(failure).toBe(networkError);
      expect(cancel).not.toHaveBeenCalled();
      await expect(reader?.cancel(networkError)).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(networkError);
      expect(stream.locked).toBe(false);
    });

    test("should reject a later upload chunk observer failure as EXT_OBSERVER_FAILED", async () => {
      const stream = twoChunkUpload();
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(stream);
        return;
      }

      const observerError = new Error("chunk failed");
      let seen = 0;
      const pending = fetchHandler(
        {
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          responseType: "text",
          uploadProgress() {
            seen += 1;
            if (seen >= 2) {
              throw observerError;
            }
          },
        },
        async (input) => {
          await readRequestBody(input);
          return new Response("ok", {
            headers: { "content-type": "text/plain" },
            status: 200,
          });
        },
      );

      const failure = await settleWithin(pending).catch(
        (cause: unknown) => cause,
      );

      expect(seen).toBeGreaterThanOrEqual(2);
      expectUploadObserverFailure(failure, observerError);
    });

    test("should reject with the abort cause when an upload observer aborts the request and then throws", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new Uint8Array([1, 2, 3]));
          streamController.close();
        },
      });
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(stream);
        return;
      }

      const controller = new AbortController();
      const observerError = new Error("observer failed after abort");
      const pending = fetchHandler(
        {
          signal: controller.signal,
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          responseType: "text",
          uploadProgress() {
            controller.abort();
            throw observerError;
          },
        },
        async (input) => {
          await readRequestBody(input);
          return new Response("ok", {
            headers: { "content-type": "text/plain" },
            status: 200,
          });
        },
      );

      const failure = await settleWithin(pending).catch(
        (cause: unknown) => cause,
      );

      expect(isBodyFailure(failure)).toBe(false);
      expect(failure).toBe(ERR_ABORTED);
    });

    test("should reject with EXT_OBSERVER_FAILED when a custom fetch swallows the upload body error", async () => {
      const stream = twoChunkUpload();
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(stream);
        return;
      }

      const observerError = new Error("observer failed");
      const cancel = vi.fn(() => Promise.resolve());
      let read = false;
      const responseBody = new ReadableStream<Uint8Array>(
        {
          cancel,
          pull(controller) {
            read = true;
            controller.enqueue(new TextEncoder().encode("late"));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      let seen = 0;
      const pending = fetchHandler(
        {
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          responseType: "text",
          uploadProgress() {
            seen += 1;
            if (seen >= 2) {
              throw observerError;
            }
          },
        },
        async (input) => {
          try {
            await readRequestBody(input);
          } catch {
            // The handle keeps going after the request body fails.
          }
          return new Response(responseBody, {
            headers: { "content-type": "text/plain" },
            status: 200,
          });
        },
      );

      const failure = await settleWithin(pending).catch(
        (cause: unknown) => cause,
      );

      expect(seen).toBeGreaterThanOrEqual(2);
      expectUploadObserverFailure(failure, observerError);
      expect(read).toBe(true);
      expect(cancel).not.toHaveBeenCalled();
    });

    test("should report caller ReadableStream upload chunks", async () => {
      const stream = twoChunkUpload();
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(stream);
        return;
      }

      const loaded: number[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (!(input instanceof Request)) {
          throw new TypeError("expected Request");
        }
        await readRequestBody(input);
        return new Response("ok", {
          headers: { "content-type": "text/plain" },
          status: 200,
        });
      });

      const response = await fetchHandler(
        {
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          responseType: "text",
          uploadProgress(event) {
            loaded.push(event.loaded);
          },
        },
        fetchMock,
      );

      expect(response.body).toBe("ok");
      expect(loaded).toEqual([2, 5]);
    });

    test.each([
      { body: () => "plain-text", name: "string", sent: "plain-text" },
      {
        body: () => new URLSearchParams({ a: "1", b: "2" }),
        name: "URLSearchParams",
        sent: "a=1&b=2",
      },
    ])(
      "should send a $name body as built and not call uploadProgress",
      async ({ body, sent: expected }) => {
        const uploadProgress = vi.fn();
        let sent = "";
        const response = await fetchHandler(
          {
            baseEndpoint: "https://example.com",
            body: body(),
            endpoint: "/upload",
            method: "POST",
            responseType: "text",
            uploadProgress,
          },
          async (input) => {
            if (!(input instanceof Request))
              throw new Error("expected Request");
            sent = await input.text();
            return new Response("ok", {
              headers: { "content-type": "text/plain" },
              status: 200,
            });
          },
        );

        expect(response.body).toBe("ok");
        expect(sent).toBe(expected);
        expect(uploadProgress).not.toHaveBeenCalled();
      },
    );

    test.each([
      {
        body: () => new Blob(["hello-upload"], { type: "text/plain" }),
        name: "Blob",
      },
      {
        body: () =>
          new File(["hello-upload"], "hello.txt", { type: "text/plain" }),
        name: "File",
      },
      {
        body: () => new TextEncoder().encode("bytes-upload").buffer,
        name: "ArrayBuffer",
      },
      { body: () => createNotesForm(), name: "FormData" },
    ])(
      "should send a $name body as built and not call uploadProgress",
      async ({ body }) => {
        await expectBypassedUpload(body());
      },
    );

    test("should ignore rejection from cancelling a wrapped upload stream", async () => {
      const cancel = vi.fn((_reason?: unknown) =>
        Promise.reject(new Error("cancel failed")),
      );
      const stream = new ReadableStream<Uint8Array>({ cancel });
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expectUnsupportedStream(stream);
        return;
      }

      const networkError = new Error("network failed");
      const failure = await fetchHandler(
        {
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          uploadProgress: vi.fn(),
        },
        () => Promise.reject(networkError),
      ).catch((cause: unknown) => cause);

      expect(failure).toBe(networkError);
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(networkError);
      await Promise.resolve();
    });

    test("should send a ReadableStream when upload progress is absent", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });
      if (uploadOutcome(cap, "ReadableStream", "custom") === "unsupported") {
        await expect(
          fetchHandler({
            baseEndpoint: "https://example.com",
            body: stream,
            endpoint: "/upload",
            method: "POST",
          }),
        ).rejects.toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
        expect(stream.locked).toBe(false);
        return;
      }

      let sent = new Uint8Array();
      const response = await fetchHandler(
        {
          baseEndpoint: "https://example.com",
          body: stream,
          endpoint: "/upload",
          method: "POST",
          responseType: "text",
        },
        async (input) => {
          if (!(input instanceof Request)) throw new Error("expected Request");
          sent = new Uint8Array(await input.arrayBuffer());
          return new Response("ok", {
            headers: { "content-type": "text/plain" },
            status: 200,
          });
        },
      );

      expect(response.body).toBe("ok");
      expect(sent).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("should report the declared streaming capability of this runtime", () => {
      expect(supportsStreamingRequestBody()).toBe(cap.streamBody);
    });
  });
}

function twoChunkUpload(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4, 5]));
      controller.close();
    },
  });
}

async function readRequestBody(input: RequestInfo | URL): Promise<ArrayBuffer> {
  if (!(input instanceof Request)) {
    throw new TypeError("expected Request");
  }
  return input.arrayBuffer();
}

function expectUploadObserverFailure(failure: unknown, cause: unknown): void {
  if (!isBodyFailure(failure)) {
    throw new Error("Expected a tagged body failure");
  }
  expect(failure.code).toBe("EXT_OBSERVER_FAILED");
  expect(failure.cause).toBe(cause);
  expect(failure.meta).toBeUndefined();
}

// Liveness guard, not a timing assertion: the budget does not depend on machine speed.
function settleWithin<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("operation did not settle")),
      10_000,
    );
    timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
