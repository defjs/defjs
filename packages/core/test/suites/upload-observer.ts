import { describe, expect, inject, test, vi } from "vitest";
import type { FetchHandle } from "../../src/client/index.ts";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "../../src/client/index.ts";
import type { HttpExecuteOptions } from "../../src/http/http.ts";
import { defineRequest } from "../../src/http/index.ts";
import { createHttpInterceptor } from "../../src/interceptor/index.ts";
import { struct } from "../../src/struct/index.ts";
import {
  expectUploadOutcome,
  type UploadAttempt,
} from "../upload-outcome-assert.ts";

const observerModes = ["sync", "async", "rejected-promise"] as const;
const usedSourceStates = ["locked", "partly read", "already read"] as const;

type ObserverMode = (typeof observerModes)[number];
type UploadBody = ReadableStream<Uint8Array>;
type UploadTuple = Awaited<ReturnType<typeof executeUpload>>;

const swallowCases = observerModes.map((mode) => ({ mode }));

/** The upload observer failures a custom handle sees: it is given a `Request` whose stream body it reads itself. */
export function registerCustomUploadObserverSuite(): void {
  describe("upload progress observer failures through a custom handle", () => {
    test.each(observerModes)(
      "should report $mode failure of a later upload chunk via custom fetch as EXT_OBSERVER_FAILED",
      async (mode) => {
        const cause = new Error(`chunk ${mode} custom`);
        const tuple = await executeUpload(
          createUploadBody(),
          { onUploadProgress: observerThatFails(mode, cause) },
          readingHandle(false),
        );

        expectObserverFault(tuple, cause);
      },
    );

    test("should report an AbortError thrown on a later upload chunk read by a custom handle as EXT_OBSERVER_FAILED", async () => {
      const cause = new DOMException("stop", "AbortError");
      const tuple = await executeUpload(
        createUploadBody(),
        { onUploadProgress: observerThatFails("sync", cause) },
        readingHandle(false),
      );

      expectObserverFault(tuple, cause);
    });

    test("should report NET_TIMEOUT when the upload observer never settles", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      let markObserved: () => void = () => undefined;
      const observed = new Promise<void>((resolve) => {
        markObserved = resolve;
      });

      try {
        const pending = executeUpload(
          createUploadBody(),
          {
            onUploadProgress() {
              markObserved();
              return new Promise<void>(() => undefined);
            },
            signal: AbortSignal.timeout(50),
          },
          readingHandle(false),
        );
        await observed;
        await vi.advanceTimersByTimeAsync(50);

        const [error, result, response] = await pending;
        expect(error?.code).toBe("NET_TIMEOUT");
        expect(result).toBeUndefined();
        expect(response).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test.each(swallowCases)(
      "should report $mode failure of a later upload chunk when the handle swallows the body error",
      async ({ mode }) => {
        const cause = new Error(`swallowed ${mode}`);
        const tuple = await executeUpload(
          createUploadBody(),
          { onUploadProgress: observerThatFails(mode, cause) },
          readingHandle(true),
        );

        expectObserverFault(tuple, cause);
      },
    );

    test("should leave a send unaborted once its upload observer has failed", async () => {
      const cause = new Error("observer failed");
      const signals: AbortSignal[] = [];
      const read = readingHandle(false);
      const tuple = await executeUpload(
        createUploadBody(),
        { onUploadProgress: observerThatFails("sync", cause) },
        (input, init) => {
          if (input instanceof Request) signals.push(input.signal);
          return read(input, init);
        },
      );

      expectObserverFault(tuple, cause);
      expect(signals.map((signal) => signal.aborted)).toEqual([false]);
    });

    test.each([
      { label: "with", observed: true },
      { label: "without", observed: false },
    ])(
      "should leave a send unaborted once its source stream errored $label an observer",
      async ({ observed }) => {
        const signals: AbortSignal[] = [];
        const read = readingHandle(false);
        const tuple = await executeUpload(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new Error("source stream failed"));
            },
          }),
          observed ? { onUploadProgress: () => undefined } : {},
          (input, init) => {
            if (input instanceof Request) signals.push(input.signal);
            return read(input, init);
          },
        );

        // Firefox reports a read of the errored stream as an AbortError, so the code differs by engine.
        expect(tuple[0]).not.toBeNull();
        expect(signals.map((signal) => signal.aborted)).toEqual([false]);
      },
    );

    test.each(
      usedSourceStates.flatMap((state) => [
        { label: "with", observed: true, state },
        { label: "without", observed: false, state },
      ]),
    )(
      "should fail a $state source stream $label an observer as a build failure",
      async ({ observed, state }) => {
        const onUploadProgress = vi.fn();
        const handle = vi.fn<FetchHandle>(() =>
          Promise.resolve(new Response("ok", { status: 200 })),
        );

        const tuple = await executeUpload(
          await usedSource(state),
          observed ? { onUploadProgress } : {},
          handle,
        );

        expect(tuple[0]?.code).toBe("REQ_BUILD_FAILED");
        expect(tuple[0]?.cause).toBeInstanceOf(TypeError);
        expect(handle).not.toHaveBeenCalled();
        expect(onUploadProgress).not.toHaveBeenCalled();
      },
    );

    test.each([
      {
        handle: () => Promise.reject(new TypeError("network down")),
        label: "fails",
      },
      {
        handle: () => Promise.resolve(new Response("ok", { status: 200 })),
        label: "answers",
      },
    ] satisfies { handle: FetchHandle; label: string }[])(
      "should release an unread source stream when a custom handle $label without reading it",
      async ({ handle }) => {
        const source = trackedSource();

        await executeUpload(source.stream, {}, handle);

        expect(source.stream.locked).toBe(false);
        expect(source.cancelled).toHaveLength(1);
        expect(source.pulls()).toBe(0);
      },
    );

    test("should release a partly read source stream when the send fails", async () => {
      const source = trackedSource();

      const tuple = await executeUpload(source.stream, {}, async (input) => {
        if (!(input instanceof Request)) {
          throw new TypeError("expected Request");
        }
        await input.body?.getReader().read();
        throw new TypeError("network down");
      });

      expect(tuple[0]?.code).toBe("NET_UNREACHABLE");
      expect(source.stream.locked).toBe(false);
      expect(source.cancelled).toHaveLength(1);
      expect(source.pulls()).toBe(1);
    });

    test.each([
      {
        handle: () => Promise.reject(new TypeError("network down")),
        label: "failed without reading it",
      },
      {
        handle: () => Promise.resolve(new Response("ok", { status: 200 })),
        label: "answered without reading it",
      },
      {
        handle: async (input) => {
          if (!(input instanceof Request)) {
            throw new TypeError("expected Request");
          }
          await input.body?.getReader().read();
          return new Response("ok", { status: 200 });
        },
        label: "answered after reading part of it",
      },
    ] satisfies { handle: FetchHandle; label: string }[])(
      "should release the source stream of a send that $label when an interceptor replaced its signal",
      async ({ handle }) => {
        const source = trackedSource();
        const client = createClient(
          withEndpoint("https://example.com"),
          withHTTPHandle(handle),
          withInterceptors(
            createHttpInterceptor((request, next) =>
              next({ ...request, signal: new AbortController().signal }),
            ),
          ),
        );
        const endpoint = defineRequest({
          builder: () => ({ body: source.stream }),
          method: "POST",
          path: "/",
        });

        await endpoint(client({}));

        expect(source.stream.locked).toBe(false);
        expect(source.cancelled).toHaveLength(1);
      },
    );

    test("should abort a send that failed for another reason when the chain settles", async () => {
      const signals: AbortSignal[] = [];
      const tuple = await executeUpload(
        createUploadBody(),
        { onUploadProgress: () => undefined },
        (input) => {
          if (input instanceof Request) signals.push(input.signal);
          return Promise.reject(new TypeError("network down"));
        },
      );

      expect(tuple[0]?.code).toBe("NET_UNREACHABLE");
      expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    });

    test("should stop only the live send when the caller aborts after an upload observer failed", async () => {
      const controller = new AbortController();
      const fail = observerThatFails("sync", new Error("first send failed"));
      const signals: AbortSignal[] = [];
      const read = readingHandle(false);
      const client = createClient(
        withEndpoint("https://example.com"),
        withHTTPHandle((input, init) => {
          if (!(input instanceof Request)) {
            throw new TypeError("expected Request");
          }
          signals.push(input.signal);
          if (signals.length === 1) return read(input, init);
          const stopped = new Promise<Response>((_resolve, reject) => {
            input.signal.addEventListener(
              "abort",
              () => reject(new Error("second send stopped")),
              { once: true },
            );
          });
          controller.abort();
          return stopped;
        }),
        withInterceptors(
          createHttpInterceptor(async (request, next) => {
            try {
              return await next(request);
            } catch {
              return await next({
                ...request,
                body: createUploadBody(),
                uploadProgress: undefined,
              });
            }
          }),
        ),
      );
      const endpoint = defineRequest({
        builder: () => ({ body: createUploadBody() }),
        method: "POST",
        path: "/",
      });

      const tuple = await endpoint(
        client({
          signal: controller.signal,
          onUploadProgress: fail,
        }),
      );

      expect(tuple[0]?.code).toBe("NET_ABORTED");
      expect(signals.map((signal) => signal.aborted)).toEqual([false, true]);
    });

    test("should succeed on a second transport call when the upload observer no longer throws", async () => {
      let progressCalls = 0;
      let nextCalls = 0;
      const client = createClient(
        withEndpoint("https://example.com"),
        withHTTPHandle(readingHandle(false)),
        withInterceptors(
          createHttpInterceptor(async (request, next) => {
            try {
              nextCalls += 1;
              return await next(request);
            } catch {
              nextCalls += 1;
              return await next({
                ...request,
                body: createUploadBody(),
              });
            }
          }),
        ),
      );
      const endpoint = defineRequest({
        builder: () => ({ body: createUploadBody() }),
        method: "POST",
        output: struct.string(),
        path: "/",
      });

      const tuple = await endpoint(
        client({
          onUploadProgress() {
            progressCalls += 1;
            if (progressCalls === 2) {
              throw new Error("first chunk failed");
            }
          },
        }),
      );

      const [error, result, response] = tuple;
      expect(error).toBeNull();
      expect(result).toBe("ok");
      expect(response?.status).toBe(200);
      expect(nextCalls).toBe(2);
      expect(progressCalls).toBeGreaterThanOrEqual(4);
    });
  });
}

/** The upload observer failures of the platform fetch, on a runtime whose connection takes a stream body. */
export function registerPlatformUploadObserverSuite(): void {
  describe("upload progress observer failures through the platform fetch", () => {
    test.each(observerModes)(
      "should report $mode failure of a later upload chunk via platform fetch as EXT_OBSERVER_FAILED",
      async (mode) => {
        const cause = new Error(`chunk ${mode} platform`);
        const tuple = await executeUpload(createUploadBody(), {
          onUploadProgress: observerThatFails(mode, cause),
        });

        expectObserverFault(tuple, cause);
      },
    );

    test("should report an AbortError thrown on a later upload chunk as EXT_OBSERVER_FAILED", async () => {
      const cause = new DOMException("stop", "AbortError");
      const tuple = await executeUpload(createUploadBody(), {
        onUploadProgress: observerThatFails("sync", cause),
      });

      expectObserverFault(tuple, cause);
    });

    test("should report NET_ABORTED when the caller aborts while the upload observer is pending", async () => {
      const controller = new AbortController();
      let markStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const pending = executeUpload(createUploadBody(), {
        signal: controller.signal,
        onUploadProgress() {
          markStarted();
          return new Promise<void>(() => undefined);
        },
      });

      await started;
      controller.abort();
      const [error, result, response] = await pending;

      expect(error?.code).toBe("NET_ABORTED");
      expect(result).toBeUndefined();
      expect(response).toBeUndefined();
    });

    test("should report NET_ABORTED when the upload observer aborts the caller signal and then throws", async () => {
      const controller = new AbortController();
      const cause = new Error("observer failed after abort");
      const calls = { n: 0 };
      const tuple = await executeUpload(createUploadBody(), {
        signal: controller.signal,
        onUploadProgress() {
          calls.n += 1;
          if (calls.n < 2) {
            return;
          }
          controller.abort();
          throw cause;
        },
      });

      expect(calls.n).toBeGreaterThanOrEqual(2);
      const [error, result, response] = tuple;
      expect(error?.code).toBe("NET_ABORTED");
      expect(result).toBeUndefined();
      expect(response).toBeUndefined();
    });

    test("should fail a partly read source stream of an observed platform send as a build failure", async () => {
      const onUploadProgress = vi.fn();

      const tuple = await executeUpload(await usedSource("partly read"), {
        onUploadProgress,
      });

      expect(tuple[0]?.code).toBe("REQ_BUILD_FAILED");
      expect(tuple[0]?.cause).toBeInstanceOf(TypeError);
      expect(onUploadProgress).not.toHaveBeenCalled();
    });

    test("should release the source stream when a platform send cannot connect", async () => {
      const source = trackedSource();
      const client = createClient(withEndpoint("http://127.0.0.1:1"));
      const endpoint = defineRequest({
        builder: () => ({ body: source.stream }),
        method: "POST",
        path: "/",
      });

      const tuple = await endpoint(client({}));

      expect(tuple[0]?.code).toBe("NET_UNREACHABLE");
      expect(source.stream.locked).toBe(false);
      expect(source.cancelled).toHaveLength(1);
    });
  });
}

/** Chromium streams a request body over HTTP/2 only, so the test server's HTTP/1.1 connection refuses it. */
export function registerUnreachableUploadCase(): void {
  test("should report NET_UNREACHABLE with the fetch TypeError when the platform fetch streams an upload over HTTP/1.1", async () => {
    const calls = { n: 0 };
    const tuple = await executeUpload(createUploadBody(), {
      onUploadProgress() {
        calls.n += 1;
      },
    });

    expectUploadOutcome("unreachable", toAttempt(tuple, calls.n));
  });
}

/** Firefox cannot stream request bodies, so a stream body is refused before anything is sent. */
export function registerUnsupportedUploadCase(): void {
  test("should report ENV_UNSUPPORTED without calling the upload observer when the request body is a stream", async () => {
    const calls = { n: 0 };
    const tuple = await executeUpload(
      createUploadBody(),
      {
        onUploadProgress() {
          calls.n += 1;
        },
      },
      readingHandle(false),
    );

    expectUploadOutcome("unsupported", toAttempt(tuple, calls.n));
  });
}

function toAttempt(
  tuple: readonly [UploadTuple[0], unknown, unknown],
  observerCalls: number,
): UploadAttempt {
  const [error, result, response] = tuple;
  return { error, result, response, observerCalls };
}

function executeUpload(
  body: UploadBody,
  options: HttpExecuteOptions,
  handle?: FetchHandle,
) {
  const client = handle
    ? createClient(withEndpoint("https://example.com"), withHTTPHandle(handle))
    : createClient(withEndpoint(inject("testServerHost")));
  const endpoint = defineRequest({
    builder: () => ({ body }),
    method: "POST",
    // Platform uploads use a route that tolerates the client aborting the body mid-read.
    path: handle ? "/" : "/body/upload",
  });
  return endpoint(client(options));
}

function readingHandle(swallow: boolean): FetchHandle {
  return async (input) => {
    if (!(input instanceof Request)) {
      throw new TypeError("expected Request");
    }

    try {
      await input.arrayBuffer();
    } catch (error) {
      if (!swallow) {
        throw error;
      }
    }

    return new Response("ok", {
      headers: { "content-type": "text/plain" },
      status: 200,
    });
  };
}

async function usedSource(state: (typeof usedSourceStates)[number]) {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.enqueue(new Uint8Array([2]));
      controller.close();
    },
  });
  const reader = source.getReader();
  if (state === "partly read") {
    await reader.read();
  }
  if (state === "already read") {
    while (!(await reader.read()).done);
  }
  if (state !== "locked") {
    reader.releaseLock();
  }
  return source;
}

function trackedSource() {
  const cancelled: unknown[] = [];
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      cancel(reason) {
        cancelled.push(reason);
      },
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([pulls]));
      },
    },
    { highWaterMark: 0 },
  );
  return { cancelled, pulls: () => pulls, stream };
}

function createUploadBody(): UploadBody {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4, 5]));
      controller.close();
    },
  });
}

/** An observer that lets the first chunk through and fails on the next. */
function observerThatFails(mode: ObserverMode, cause: Error) {
  let seen = 0;
  return () => {
    seen += 1;
    if (seen < 2) {
      return undefined;
    }
    return failObserver(mode, cause);
  };
}

function failObserver(mode: ObserverMode, cause: Error): Promise<never> {
  if (mode === "sync") {
    throw cause;
  }
  if (mode === "async") {
    return Promise.resolve().then(() => {
      throw cause;
    });
  }
  return Promise.reject(cause);
}

function expectObserverFault(tuple: UploadTuple, cause: unknown): void {
  const [error, result, response] = tuple;
  expect(error?.code).toBe("EXT_OBSERVER_FAILED");
  expect(error?.cause).toBe(cause);
  expect(error?.response).toBeUndefined();
  expect(result).toBeUndefined();
  expect(response).toBeUndefined();
}
