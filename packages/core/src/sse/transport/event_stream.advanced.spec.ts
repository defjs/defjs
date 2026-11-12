import {
  afterEach,
  describe,
  expect,
  inject,
  onTestFinished,
  test,
  vi,
} from "vitest";

import { resolveRetryPolicy } from "../../internal/retry";
import type { FetchHandle } from "../../client/config";
import { DEFAULT_FETCH } from "../../client/config";
import { ERR_ABORTED, ERR_TIMEOUT } from "../../error";
import type { HttpRequest } from "../../http";
import { struct } from "../../struct";
import type {
  EventStreamFailureInfo,
  EventStreamHandle,
  FetchEventStreamOptions,
} from "./event_stream";
import {
  fetchEventStream as fetchEventStreamInternal,
  getEventStreamFatalCode,
} from "./event_stream";
import type { EventStreamMessage } from "./parser";
import { yieldMacrotask } from "../../../test/macrotask";

type TestOptions<T> = Omit<
  FetchEventStreamOptions<T>,
  "fetch" | "maxBufferSize" | "transformMessage"
> & {
  fetch?: FetchHandle;
  maxBufferSize?: number;
};

// The number of unread events the transport holds before it pauses reading the response.
const QUEUE_SIZE = 1024;

function requireRequest(input: RequestInfo | URL): Request {
  if (!(input instanceof Request)) {
    throw new TypeError("SSE handle received a non-Request");
  }
  return input;
}

function thrownMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    throw new TypeError("expected an Error");
  }
  return error.message;
}

/** Streams the raw parsed messages. */
function fetchEventStream(
  request: HttpRequest,
  options: TestOptions<EventStreamMessage> = {},
) {
  return fetchEventStreamInternal(request, {
    fetch: DEFAULT_FETCH,
    maxBufferSize: 1024,
    transformMessage: (message) => message,
    ...options,
  });
}

/** Streams what `transformMessage` returns for each parsed message. */
function fetchTransformedEventStream<T>(
  request: HttpRequest,
  options: TestOptions<T> &
    Pick<FetchEventStreamOptions<T>, "transformMessage">,
) {
  return fetchEventStreamInternal(request, {
    fetch: DEFAULT_FETCH,
    maxBufferSize: 1024,
    ...options,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// Liveness guard, not a timing assertion: the awaited promise must settle while the test holds a dependency pending. The budget does not depend on machine speed.
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

describe("fetchEventStream advanced", () => {
  function createRequest(endpoint: string): HttpRequest {
    return {
      baseEndpoint: inject("testServerHost"),
      endpoint,
      method: "GET",
    };
  }

  test("should skip messages when transformMessage returns undefined", async () => {
    const stream = await fetchTransformedEventStream(
      createRequest("/sse/basic"),
      {
        transformMessage() {
          return undefined;
        },
      },
    );

    const events: undefined[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events).toEqual([]);
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test("should preserve an undefined network rejection", async () => {
    await expect(
      fetchEventStream(createRequest("/events"), {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the fetch under test rejects with undefined, which the stream must surface unchanged
        fetch: () => Promise.reject(undefined),
      }),
    ).rejects.toBeUndefined();
  });

  test("should keep retry fields out of dispatched messages", async () => {
    const stream = await fetchEventStream(createRequest("/sse/retry"));

    const events: EventStreamMessage[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events[0]).not.toHaveProperty("retry");
  });

  test("should close gracefully when close is called after already closed", async () => {
    const stream = await fetchEventStream(createRequest("/sse/basic"));
    stream.close();
    stream.close(); // should not throw

    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
  });

  test("should throw for non-ok response with error body", async () => {
    await expect(
      fetchEventStream(createRequest("/sse/500-always")),
    ).rejects.toThrow();
  });

  test("should provide execution-owned failure open info", async () => {
    let unexpectedHandle: EventStreamHandle<EventStreamMessage> | undefined;
    onTestFinished(async () => {
      await unexpectedHandle?.[Symbol.asyncDispose]();
    });
    const failure: EventStreamFailureInfo = {};
    try {
      unexpectedHandle = await fetchEventStream(
        createRequest("/sse/500-always"),
        { failure },
      );
    } catch {
      // The invocation reports its own response snapshot alongside the unchanged rejection.
    }
    expect(failure.open?.response.status).toBe(500);
  });

  test("failure info stays empty for non-object errors before a response", async () => {
    for (const cause of ["string error", null, 42]) {
      const failure: EventStreamFailureInfo = {};
      await expect(
        fetchEventStream(createRequest("/events"), {
          failure,
          fetch: () => {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the fetch under test rejects with a string, null or number, which must pass through unchanged
            return Promise.reject(cause);
          },
        }),
      ).rejects.toBe(cause);
      expect(failure.open).toBeUndefined();
    }
  });

  test("should throw when transformMessage throws", async () => {
    const stream = await fetchTransformedEventStream(
      createRequest("/sse/basic"),
      {
        transformMessage() {
          throw new Error("transform failed");
        },
      },
    );

    const iter = stream[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(
      "Failed to process event stream message",
    );
  });

  test("should work with default options", async () => {
    const stream = await fetchEventStream(createRequest("/sse/basic"));

    const events: EventStreamMessage[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
  });

  test("should close with non-error reason", async () => {
    const stream = await fetchEventStream(createRequest("/sse/basic"));
    stream.close("custom-reason");

    await expect(stream.closed).resolves.toMatchObject({
      kind: "aborted",
      reason: "custom-reason",
    });
  });

  test("should not override existing Accept header", async () => {
    const request: HttpRequest = {
      ...createRequest("/sse/basic"),
      headers: new Headers({ Accept: "application/json" }),
    };

    const accepts: (string | null)[] = [];
    const stream = await fetchEventStream(request, {
      fetch: (input) => {
        accepts.push(requireRequest(input).headers.get("accept"));
        return Promise.resolve(
          new Response("data: a\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
    });
    for await (const _ of stream) {
      // consume
    }
    expect(accepts).toEqual(["application/json"]);
  });

  test("should close with TimeoutError reason", async () => {
    const stream = await fetchEventStream(createRequest("/sse/basic"));
    const timeoutError = new Error("timeout");
    timeoutError.name = "TimeoutError";
    stream.close(timeoutError);

    await expect(stream.closed).resolves.toMatchObject({
      kind: "aborted",
      reason: "timeout",
    });
  });

  test("should abort via request signal during fetch", async () => {
    const controller = new AbortController();
    const request: HttpRequest = {
      ...createRequest("/sse/slow"),
      signal: controller.signal,
    };

    const fetchSpy = vi.fn<FetchHandle>((input, init) =>
      globalThis.fetch(input, init),
    );
    const opening = fetchEventStream(request, { fetch: fetchSpy });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce(), 10_000);
    controller.abort(ERR_ABORTED);

    await expect(opening).rejects.toBe(ERR_ABORTED);
  });

  test.each([
    ["does not settle", () => new Promise<void>(() => undefined)],
    ["rejects", () => Promise.reject(new Error("cancel failed"))],
  ])(
    "should settle an ignored fetch abort when late response cancellation %s",
    async (_label, cancelBody) => {
      const controller = new AbortController();
      const cancel = vi.fn((_reason?: unknown) => cancelBody());
      let resolveFetch!: (response: Response) => void;
      const fetch = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const opening = fetchEventStream(
        { ...createRequest("/events"), signal: controller.signal },
        { fetch: fetch },
      );

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      controller.abort(ERR_ABORTED);

      await expect(settleWithin(opening)).rejects.toBe(ERR_ABORTED);
      resolveFetch(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "content-type": "text/event-stream" },
        }),
      );
      await vi.waitFor(() => {
        expect(cancel).toHaveBeenCalledOnce();
        expect(cancel.mock.calls[0]?.[0]).toBe(ERR_ABORTED);
      });
    },
  );

  test("should normalize TimeoutError from request abort signal", async () => {
    const controller = new AbortController();
    const timeoutError = new Error("timeout");
    timeoutError.name = "TimeoutError";
    const request: HttpRequest = {
      ...createRequest("/sse/slow"),
      signal: controller.signal,
    };

    let unexpectedHandle: EventStreamHandle<EventStreamMessage> | undefined;
    onTestFinished(async () => {
      await unexpectedHandle?.[Symbol.asyncDispose]();
    });
    const fetchSpy = vi.fn<FetchHandle>((input, init) =>
      globalThis.fetch(input, init),
    );

    const opening = fetchEventStream(request, { fetch: fetchSpy }).then(
      (handle) => {
        unexpectedHandle = handle;
        return handle;
      },
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce(), 10_000);
    controller.abort(timeoutError);

    await expect(opening).rejects.toBe(ERR_TIMEOUT);
  });

  test("should throw for non-event-stream content type", async () => {
    await expect(fetchEventStream(createRequest("/json"))).rejects.toThrow(
      /Expected content-type/,
    );
  });

  test("should throw for empty content type", async () => {
    await expect(
      fetchEventStream(createRequest("/no-content-type")),
    ).rejects.toThrow(/Expected content-type/);
  });

  test.each([
    "text/event-stream",
    "Text/Event-Stream; charset=utf-8",
    'text/event-stream; note="a;b"',
    'text/event-stream; note="a\\\tb"',
    'text/event-stream; note="a\\ b"',
    'text/event-stream; note="a\\;b"',
    'text/event-stream; note="a\\éb"',
    'text/event-stream; note="café"',
    "text/event-stream; charset",
    'text/event-stream; note="unterminated',
  ])("should accept event-stream content type %s", async (contentType) => {
    const stream = await fetchEventStream(createRequest("/events"), {
      fetch: () =>
        Promise.resolve(
          new Response("data: ok\n\n", {
            headers: { "content-type": contentType },
          }),
        ),
    });

    await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { data: "ok" },
    });
  });

  test.each([
    undefined,
    "",
    "application/json",
    "text/event-streaming",
    "text/",
    "text/event-stream nope",
  ])("should reject content type %s", async (contentType) => {
    const bytes = new TextEncoder().encode("data: ignored\n\n");
    await expect(
      fetchEventStream(createRequest("/events"), {
        fetch: () =>
          Promise.resolve(
            new Response(bytes, {
              headers:
                contentType === undefined
                  ? undefined
                  : { "content-type": contentType },
            }),
          ),
      }),
    ).rejects.toThrow(
      contentType === undefined || contentType === ""
        ? /Expected content-type.*\(empty\)/
        : /Expected content-type/,
    );
  });

  test("should never retry a fatal open-validation error", async () => {
    const cancel = vi.fn();
    const shouldRetry = vi.fn(() => true);
    const fetch = vi.fn(() => {
      const body = new ReadableStream<Uint8Array>({ cancel });
      return Promise.resolve(
        new Response(body, { headers: { "content-type": "text/plain" } }),
      );
    });

    const error = await fetchEventStream(createRequest("/events"), {
      fetch,
      retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0, shouldRetry }),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(thrownMessage(error)).toMatch(/Expected content-type/);
    expect(getEventStreamFatalCode(error)).toBe("RES_MEDIA_TYPE_INVALID");
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  test("should not wait for response cancellation after fatal open validation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    await expect(
      settleWithin(
        fetchEventStream(createRequest("/events"), {
          fetch,
        }),
      ),
    ).rejects.toThrow(/Expected content-type/);

    expect(cancel).toHaveBeenCalledOnce();
  });

  test("should preserve a media type failure when response cancellation rejects", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    const error = await fetchEventStream(createRequest("/events"), {
      fetch,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(thrownMessage(error)).toMatch(/Expected content-type/);
    expect(getEventStreamFatalCode(error)).toBe("RES_MEDIA_TYPE_INVALID");
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("should use the stable fallback when shouldRetry throws a non-Error value", async () => {
    const error = await fetchEventStream(createRequest("/events"), {
      fetch: () => Promise.reject(new Error("network failure")),
      retry: resolveRetryPolicy({
        shouldRetry() {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- shouldRetry under test throws a string primitive to exercise handling of a non-Error failure
          throw "non-error failure";
        },
      }),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(thrownMessage(error)).toBe("Retry policy failed");
    expect(getEventStreamFatalCode(error)).toBe("EXT_HOOK_FAILED");
  });

  test.each([200, 204, 205])(
    "should end a %i response without a body as an empty stream",
    async (status) => {
      const stream = await fetchEventStream(createRequest("/events"), {
        fetch: () =>
          Promise.resolve(
            new Response(null, {
              status,
              headers: { "content-type": "text/event-stream" },
            }),
          ),
      });

      const events: EventStreamMessage[] = [];
      for await (const event of stream) events.push(event);

      expect(events).toEqual([]);
      await expect(stream.closed).resolves.toEqual({ kind: "eof" });
    },
  );

  test("should cancel upstream and terminate on a parser limit even when callbacks request retry", async () => {
    const cancel = vi.fn();
    const shouldRetry = vi.fn(() => true);
    const fetch = vi.fn(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${"x".repeat(100)}`),
          );
        },
        cancel,
      });
      return Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    });

    const stream = await fetchEventStream(createRequest("/events"), {
      fetch,
      maxBufferSize: 16,
      retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0, shouldRetry }),
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow(
      "SSE parser buffer exceeded maxBufferSize",
    );
    await expect(stream.closed).resolves.toMatchObject({
      kind: "error",
      code: "CAP_BUFFER_EXCEEDED",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  test("should cancel upstream and terminate when message transformation fails", async () => {
    const cancel = vi.fn();
    const shouldRetry = vi.fn(() => true);
    const fetch = vi.fn(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: value\n\n"));
        },
        cancel,
      });
      return Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    });

    const stream = await fetchTransformedEventStream(createRequest("/events"), {
      fetch,
      retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0, shouldRetry }),
      transformMessage() {
        throw new Error("transform failed");
      },
    });

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Failed to process event stream message",
    );
    await expect(stream.closed).resolves.toMatchObject({
      kind: "error",
      code: "EXT_OBSERVER_FAILED",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  test("should abort during retry wait via request signal", async () => {
    // Unit-level reconnect delay: fake timers, so the retry wait never elapses unless the test advances it.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const controller = new AbortController();
    const request: HttpRequest = {
      ...createRequest("/events"),
      signal: controller.signal,
    };
    const fetch = vi.fn(() => Promise.reject(new Error("network error")));

    const opening = fetchEventStream(request, {
      fetch,
      retry: resolveRetryPolicy({ maxRetries: 3, delayMs: 10_000 }),
    });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    // Lets the failed attempt reach its retry wait without elapsing it.
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(ERR_ABORTED);

    await expect(opening).rejects.toBe(ERR_ABORTED);
  });

  test("should close infinite stream", async () => {
    const stream = await fetchEventStream(createRequest("/sse/infinite"));

    // The server is still pushing: close only after the first tick has arrived.
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: { event: "tick" },
    });
    stream.close();

    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
  });

  test("should cancel active response body when stream is closed", async () => {
    const cancel = vi.fn();
    const mockFetch = vi.fn(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
        },
        cancel,
      });

      return Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        }),
      );
    });

    const stream = await fetchEventStream(createRequest("/sse/basic"), {
      fetch: mockFetch,
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { data: "first", event: "", id: "" },
    });

    stream.close("stop");

    await vi.waitFor(() => {
      expect(cancel.mock.calls[0]?.[0]).toBe("stop");
    });
    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
  });

  test("should dispose an active stream once without waiting for a stuck provider cancel", async () => {
    const pull = vi.fn(() => new Promise<void>(() => undefined));
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    const stream = await fetchEventStream(createRequest("/events"), {
      fetch,
      retry: resolveRetryPolicy({ maxRetries: 3, delayMs: 0 }),
    });
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());

    let first: PromiseLike<void> | undefined;
    expect(() => {
      first = stream[Symbol.asyncDispose]();
    }).not.toThrow();
    if (!first) {
      throw new Error("Expected disposal promise");
    }

    const second = stream[Symbol.asyncDispose]();
    expect(second).toBe(first);
    await expect(settleWithin(Promise.resolve(first))).resolves.toBeUndefined();

    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });

    const pullCount = pull.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pull).toHaveBeenCalledTimes(pullCount);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("should preserve an error terminal state when disposed", async () => {
    const failure = new Error("provider failed");
    let sourceController:
      ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });
    const stream = await fetchEventStream(createRequest("/events"), {
      fetch: () =>
        Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    });

    sourceController?.error(failure);
    const terminal = await stream.closed;
    expect(terminal).toEqual({
      kind: "error",
      code: "NET_UNREACHABLE",
      cause: failure,
      reason: failure.message,
    });

    await expect(
      Promise.resolve(stream[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(stream.closed).resolves.toBe(terminal);
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBe(failure);
  });

  test("should close and cancel the active response when iteration returns early", async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: first\n\n"));
            },
            cancel,
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    const stream = await fetchEventStream(createRequest("/events"), { fetch });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { data: "first" },
    });
    await expect(iterator.return?.()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(iterator.return?.()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    await expect(stream.closed).resolves.toMatchObject({
      kind: "aborted",
      reason: "iterator-return",
    });
    await vi.waitFor(() => {
      expect(cancel.mock.calls[0]?.[0]).toBe("iterator-return");
    });
  });

  test("should abort while transformMessage never settles", async () => {
    const abortController = new AbortController();
    const cancel = vi.fn();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let transformSignal: AbortSignal | undefined;
    const stream = await fetchTransformedEventStream(
      { ...createRequest("/events"), signal: abortController.signal },
      {
        fetch: () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode("data: value\n\n"),
                  );
                },
                cancel,
              }),
              { headers: { "content-type": "text/event-stream" } },
            ),
          ),
        transformMessage(_message, signal) {
          transformSignal = signal;
          markStarted?.();
          return new Promise<EventStreamMessage>(() => undefined);
        },
      },
    );
    const next = stream[Symbol.asyncIterator]().next();

    await started;
    abortController.abort(ERR_ABORTED);

    await expect(next).resolves.toEqual({ done: true, value: undefined });
    await expect(stream.closed).resolves.toMatchObject({
      kind: "aborted",
      cause: ERR_ABORTED,
    });
    expect(transformSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test.each([
    ["a TimeoutError", new DOMException("deadline expired", "TimeoutError")],
    ["the canonical timeout error", ERR_TIMEOUT],
  ])(
    "should fail an open stream when request abort uses %s",
    async (_label, timeoutError) => {
      const controller = new AbortController();
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>(
        {
          cancel,
          pull() {
            return new Promise<void>(() => undefined);
          },
        },
        { highWaterMark: 0 },
      );
      const stream = await fetchEventStream(
        { ...createRequest("/events"), signal: controller.signal },
        {
          fetch: () =>
            Promise.resolve(
              new Response(body, {
                headers: { "content-type": "text/event-stream" },
              }),
            ),
        },
      );
      const next = stream[Symbol.asyncIterator]().next();

      controller.abort(timeoutError);

      await expect(next).rejects.toBe(ERR_TIMEOUT);
      await expect(stream.closed).resolves.toEqual({
        kind: "error",
        code: "NET_TIMEOUT",
        cause: ERR_TIMEOUT,
        reason: ERR_TIMEOUT.message,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel.mock.calls[0]?.[0]).toBe(timeoutError);
    },
  );

  test("should keep an explicit close with a TimeoutError classified as owner abort", async () => {
    const timeoutError = new DOMException(
      "owner chose this reason",
      "TimeoutError",
    );
    const stream = await fetchEventStream(createRequest("/sse/infinite"));

    stream.close(timeoutError);

    await expect(stream.closed).resolves.toEqual({
      kind: "aborted",
      cause: timeoutError,
      reason: timeoutError.message,
    });
  });

  test("should abort while shouldRetry never settles", async () => {
    const abortController = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const opening = fetchEventStream(
      { ...createRequest("/events"), signal: abortController.signal },
      {
        fetch: () => Promise.reject(new Error("network failure")),
        retry: resolveRetryPolicy({
          shouldRetry() {
            markStarted?.();
            return new Promise<boolean>(() => undefined);
          },
        }),
      },
    );

    await started;
    abortController.abort(ERR_ABORTED);

    await expect(opening).rejects.toBe(ERR_ABORTED);
  });

  test("should prefer a queued abort over a synchronous shouldRetry result", async () => {
    const abortController = new AbortController();
    const opening = fetchEventStream(
      { ...createRequest("/events"), signal: abortController.signal },
      {
        fetch: () => Promise.reject(new Error("network failure")),
        retry: resolveRetryPolicy({
          shouldRetry() {
            queueMicrotask(() => abortController.abort(ERR_ABORTED));
            return false;
          },
        }),
      },
    );

    await expect(opening).rejects.toBe(ERR_ABORTED);
  });

  test("should reject a second event-stream iterator", async () => {
    const stream = await fetchEventStream(createRequest("/sse/infinite"));

    stream[Symbol.asyncIterator]();
    expect(() => stream[Symbol.asyncIterator]()).toThrow(
      "AsyncQueue supports one consumer",
    );

    stream.close("test complete");
    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
  });

  test("should retry when fetch throws a network error", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: ok\n\n"));
              controller.close();
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
      );

    const stream = await fetchEventStream(createRequest("/sse/basic"), {
      fetch: mockFetch,
      retry: resolveRetryPolicy({ maxRetries: 3, delayMs: 0 }),
    });

    const events: EventStreamMessage[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events).toEqual([{ data: "ok", event: "", id: "" }]);
  });

  test.each([
    [
      "string",
      "hello" as const,
      async (request: Request) => request.text(),
      "hello" as const,
    ],
    [
      "bytes",
      Uint8Array.from([1, 2, 3]),
      async (request: Request) => new Uint8Array(await request.arrayBuffer()),
      Uint8Array.from([1, 2, 3]),
    ],
    [
      "form",
      (() => {
        const form = new FormData();
        form.append("a", "1");
        return form;
      })(),
      async (request: Request) => Object.fromEntries(await request.formData()),
      { a: "1" },
    ],
  ])(
    "resends a replayable %s body with the last event id",
    async (_name, body, read, expected) => {
      const failure = new TypeError("network down");
      const recorded: unknown[] = [];
      const lastEventIds: Array<string | null> = [];
      const fetch = vi.fn<FetchHandle>(async (input) => {
        const request = requireRequest(input);
        recorded.push(await read(request));
        lastEventIds.push(request.headers.get("last-event-id"));
        if (recorded.length === 1) {
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
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: b\n\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        );
      });

      const stream = await fetchEventStream(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/events",
          method: "PUT",
          body,
        },
        { fetch, retry: resolveRetryPolicy({ maxRetries: 1, delayMs: 0 }) },
      );
      const events: EventStreamMessage[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events.map((event) => event.data)).toEqual(["a", "b"]);
      expect(recorded).toEqual([expected, expected]);
      expect(lastEventIds).toEqual([null, "1"]);
    },
  );

  test("should not retry when retry is omitted", async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn(() => {
      fetchCount += 1;
      return Promise.reject(new Error("network error"));
    });

    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/fail",
      method: "GET",
    };

    await expect(
      fetchEventStream(request, { fetch: mockFetch }),
    ).rejects.toThrow("network error");
    expect(fetchCount).toBe(1);
  });

  test("should not retry when retry.maxRetries = 0", async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn(() => {
      fetchCount += 1;
      return Promise.resolve(new Response(null, { status: 503 }));
    });

    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/fail",
      method: "GET",
    };

    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        retry: resolveRetryPolicy({ maxRetries: 0 }),
      }),
    ).rejects.toThrow();
    expect(fetchCount).toBe(1);
  });

  test("should retry up to the retry.maxRetries limit", async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn(() => {
      fetchCount += 1;
      // Throw a network error (not EventStreamFatalError) to trigger retry path
      return Promise.reject(new Error("network error"));
    });

    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/fail",
      method: "GET",
    };

    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0 }),
      }),
    ).rejects.toThrow();
    expect(fetchCount).toBe(3); // initial + 2 retries
  });

  test("should succeed when retry eventually works", async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn(() => {
      fetchCount += 1;
      if (fetchCount < 3) {
        // Throw network error to trigger retry path
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: ok\n\n"));
              controller.close();
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
      );
    });

    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/flaky",
      method: "GET",
    };

    const stream = await fetchEventStream(request, {
      fetch: mockFetch,
      retry: resolveRetryPolicy({ maxRetries: 5, delayMs: 0 }),
    });

    expect(fetchCount).toBe(3);
    const events: unknown[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events.length).toBe(1);
  });

  test("should stop retry when shouldRetry returns false", async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn(() => {
      fetchCount += 1;
      // Throw network error so we reach the shouldRetry check
      return Promise.reject(new Error("network error"));
    });

    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/fail",
      method: "GET",
    };

    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        retry: resolveRetryPolicy({
          shouldRetry: () => Promise.resolve(false),
          delayMs: 0,
        }),
      }),
    ).rejects.toThrow();
    expect(fetchCount).toBe(1);
  });

  test("should preserve a reconnect policy exception instead of retrying", async () => {
    const cause = new Error("reconnect policy failed");
    const fetch = vi.fn(() => Promise.reject(new Error("network error")));

    const error = await fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/events",
        method: "GET",
      },
      {
        fetch,
        retry: resolveRetryPolicy({
          shouldRetry() {
            throw cause;
          },
        }),
      },
    ).catch((rejection: unknown) => rejection);
    expect(getEventStreamFatalCode(error)).toBe("EXT_HOOK_FAILED");
    expect(error).toHaveProperty("cause", cause);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("should continue retry when shouldRetry returns true", async () => {
    let fetchCount = 0;
    const mockFetch = vi.fn(() => {
      fetchCount += 1;
      if (fetchCount < 2) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: ok\n\n"));
              controller.close();
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
      );
    });

    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/flaky",
      method: "GET",
    };

    const stream = await fetchEventStream(request, {
      fetch: mockFetch,
      retry: resolveRetryPolicy({
        shouldRetry: () => Promise.resolve(true),
        delayMs: 0,
      }),
    });

    const events: unknown[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events.length).toBe(1);
    expect(fetchCount).toBe(2);
  });

  test("should use exponential backoff with factor", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    const mockFetch = vi.fn(() => {
      fetchCount += 1;
      return Promise.reject(new Error("network error"));
    });

    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/fail",
      method: "GET",
    };

    const rejected = fetchEventStream(request, {
      fetch: mockFetch,
      retry: resolveRetryPolicy({
        maxRetries: 2,
        delayMs: 10,
        factor: 2,
        jitter: 0,
      }),
    }).catch((error: unknown) => error);
    for (const [retried, delay] of [10, 20].entries()) {
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchCount).toBe(retried + 1);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetchCount).toBe(retried + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchCount).toBe(retried + 2);
    }
    expect(await rejected).toBeInstanceOf(Error);
  });

  test("should clamp the final retry delay after applying a factor to a wire retry value", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    const mockFetch = vi.fn(() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        let pulled = false;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!pulled) {
                  pulled = true;
                  controller.enqueue(
                    new TextEncoder().encode("retry: 1500000000\n\n"),
                  );
                  return;
                }
                controller.error(new Error("connection lost"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        );
      }
      return Promise.reject(new Error("network error"));
    });

    const stream = await fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/events",
        method: "GET",
      },
      {
        fetch: mockFetch,
        retry: resolveRetryPolicy({
          maxRetries: 2,
          factor: 2,
          jitter: 0,
          maxDelayMs: Infinity,
        }),
      },
    );

    // The wire value is the first delay; the second one, doubled, is clamped to the largest timer delay.
    for (const [retried, delay] of [1_500_000_000, 2_147_483_647].entries()) {
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchCount).toBe(retried + 1);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetchCount).toBe(retried + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchCount).toBe(retried + 2);
    }

    // The last retry is spent: the stream ends with the network error.
    await expect(stream.closed).resolves.toMatchObject({ kind: "error" });
  });

  test("should enforce maxBufferSize in parser", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              // Send a very long partial line without newline to exceed buffer
              controller.enqueue(
                new TextEncoder().encode(`data: ${"x".repeat(100)}`),
              );
              controller.enqueue(
                new TextEncoder().encode(`data: ${"y".repeat(100)}`),
              );
              controller.close();
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
      ),
    );

    const request = {
      baseEndpoint: "https://example.com",
      endpoint: "/huge",
      method: "GET",
    };

    // maxBufferSize error happens after stream is open (200 response),
    // so fetchEventStream resolves the handle. The error propagates
    // through the async iterator.
    const stream = await fetchEventStream(request, {
      fetch: mockFetch,
      maxBufferSize: 50,
    });

    const iter = stream[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(
      "SSE parser buffer exceeded maxBufferSize",
    );
  });
});

describe("fetchEventStream message path", () => {
  const request: HttpRequest = {
    baseEndpoint: "https://example.com",
    endpoint: "/events",
    method: "GET",
  };

  // The whole text arrives as one chunk.
  function respondWith(text: string) {
    return vi.fn(() =>
      Promise.resolve(
        new Response(text, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
  }

  test("should transform every message of a chunk in one synchronous pass", async () => {
    const order: string[] = [];
    const stream = await fetchTransformedEventStream(request, {
      fetch: respondWith("data: a\n\ndata: b\n\ndata: c\n\n"),
      transformMessage(message) {
        if (order.length === 0) {
          queueMicrotask(() => order.push("microtask"));
        }
        order.push(`transform ${message.data}`);
        return message;
      },
    });
    for await (const _ of stream) {
      // consume
    }

    // The microtask queued by the first transform runs only after the whole chunk has been handled.
    expect(order).toEqual([
      "transform a",
      "transform b",
      "transform c",
      "microtask",
    ]);
  });

  test.each([
    { expected: ["a", "b!", "c"], settled: { data: "b!", event: "", id: "" } },
    { expected: ["a", "c"], settled: undefined },
  ])(
    "should hold later messages back until a pending transform settles ($expected)",
    async ({ expected, settled }) => {
      const gate = Promise.withResolvers<EventStreamMessage | undefined>();
      const transformed: string[] = [];
      const stream = await fetchTransformedEventStream(request, {
        fetch: respondWith("data: a\n\ndata: b\n\ndata: c\n\n"),
        transformMessage(message) {
          transformed.push(message.data);
          return message.data === "b" ? gate.promise : message;
        },
      });
      // The body takes an unknown number of turns to arrive. The extra turn lets an out-of-order "c" show up.
      await vi.waitFor(() => expect(transformed).toEqual(["a", "b"]));
      await yieldMacrotask();

      // "b" is pending, so "c" is neither transformed nor delivered ahead of it.
      expect(transformed).toEqual(["a", "b"]);

      gate.resolve(settled);
      const received: string[] = [];
      for await (const event of stream) {
        received.push(event.data);
      }

      expect(transformed).toEqual(["a", "b", "c"]);
      expect(received).toEqual(expected);
    },
  );

  test.each(["throws", "rejects"] as const)(
    "should fail with EXT_OBSERVER_FAILED when a transform %s",
    async (mode) => {
      const failure = new Error("transform failed");
      const transformed: string[] = [];
      const fetch = respondWith("data: a\n\ndata: b\n\n");
      const stream = await fetchTransformedEventStream(request, {
        fetch,
        retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0 }),
        transformMessage(message) {
          transformed.push(message.data);
          if (mode === "throws") {
            throw failure;
          }
          return Promise.reject(failure);
        },
      });

      const error = await stream[Symbol.asyncIterator]()
        .next()
        .catch((reason: unknown) => reason);

      expect(getEventStreamFatalCode(error)).toBe("EXT_OBSERVER_FAILED");
      expect(error).toMatchObject({ cause: failure });
      await expect(stream.closed).resolves.toMatchObject({
        cause: error,
        code: "EXT_OBSERVER_FAILED",
        kind: "error",
      });
      // The failing message ends the stream: nothing after it is read, and a fatal error is not retried.
      expect(transformed).toEqual(["a"]);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  test("should wait for room after a pending transform", async () => {
    // One event per chunk, read on demand. The queue holds 1024 events, so the 1025th event
    // has to wait for room after its pending transform.
    const total = QUEUE_SIZE + 1;
    const chunks = Array.from(
      { length: total },
      (_, i) => `data: ${i + 1}\n\n`,
    );
    let transforms = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk === undefined) {
            controller.close();
            return;
          }
          controller.enqueue(new TextEncoder().encode(chunk));
        },
      },
      { highWaterMark: 0 },
    );
    const stream = await fetchTransformedEventStream(request, {
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
      transformMessage: (message) => {
        transforms += 1;
        return Promise.resolve(message.data);
      },
    });
    await vi.waitFor(() => expect(transforms).toBe(total));
    await yieldMacrotask();

    const received: string[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual(
      Array.from({ length: total }, (_, i) => String(i + 1)),
    );
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test("should keep an abort as the outcome when a transform throws after aborting", async () => {
    const controller = new AbortController();
    const fetch = respondWith("data: a\n\n");
    const stream = await fetchTransformedEventStream(
      { ...request, signal: controller.signal },
      {
        fetch,
        retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0 }),
        transformMessage() {
          controller.abort(ERR_ABORTED);
          throw new Error("transform failed after the abort");
        },
      },
    );

    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(stream.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("should observe a transform promise rejection after the transform aborts", async () => {
    const controller = new AbortController();
    const lateFailure = new Error("late transform failure");

    const stream = await fetchTransformedEventStream(
      { ...request, signal: controller.signal },
      {
        fetch: respondWith("data: a\n\n"),
        transformMessage() {
          controller.abort(ERR_ABORTED);
          return Promise.reject(lateFailure);
        },
      },
    );

    await expect(stream.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    await yieldMacrotask();
  });

  test("should not transform the remaining messages of a chunk once the request is aborted", async () => {
    const controller = new AbortController();
    const transformed: string[] = [];
    const stream = await fetchTransformedEventStream(
      { ...request, signal: controller.signal },
      {
        fetch: respondWith("data: a\n\ndata: b\n\ndata: c\n\n"),
        transformMessage(message) {
          transformed.push(message.data);
          controller.abort(ERR_ABORTED);
          return message;
        },
      },
    );

    await expect(stream.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    expect(transformed).toEqual(["a"]);
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});

describe("reconnect method policy", () => {
  function rejectingFetch(failure: TypeError): FetchHandle {
    return vi.fn<FetchHandle>(() => Promise.reject(failure));
  }

  test("should not reconnect POST without shouldRetry", async () => {
    const failure = new TypeError("network down");
    const fetch = rejectingFetch(failure);

    await expect(
      fetchEventStream(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/events",
          method: "POST",
        },
        { fetch, retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0 }) },
      ),
    ).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(["PATCH", "post"])(
    "should not reconnect %s without shouldRetry",
    async (method) => {
      const failure = new TypeError("network down");
      const fetch = rejectingFetch(failure);

      await expect(
        fetchEventStream(
          { baseEndpoint: "https://example.com", endpoint: "/events", method },
          { fetch, retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0 }) },
        ),
      ).rejects.toBe(failure);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["GET", "HEAD", "OPTIONS", "PUT", "DELETE", "delete"])(
    "should reconnect idempotent %s without shouldRetry",
    async (method) => {
      const failure = new TypeError("network down");
      const fetch = rejectingFetch(failure);

      await expect(
        fetchEventStream(
          { baseEndpoint: "https://example.com", endpoint: "/events", method },
          { fetch, retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0 }) },
        ),
      ).rejects.toBe(failure);
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );

  test("should reconnect POST when shouldRetry returns true and report the method", async () => {
    const failure = new TypeError("network down");
    const fetch = rejectingFetch(failure);
    const shouldRetry = vi.fn(() => true);

    await expect(
      fetchEventStream(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/events",
          method: "POST",
        },
        {
          fetch,
          retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0, shouldRetry }),
        },
      ),
    ).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(shouldRetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attempt: 1, lastEventId: "", method: "POST" }),
    );
  });

  test("should stop POST when shouldRetry returns false", async () => {
    const failure = new TypeError("network down");
    const fetch = rejectingFetch(failure);

    await expect(
      fetchEventStream(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/events",
          method: "POST",
        },
        {
          fetch,
          retry: resolveRetryPolicy({
            maxRetries: 2,
            delayMs: 0,
            shouldRetry: () => false,
          }),
        },
      ),
    ).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("should end an opened POST stream with the original read error when shouldRetry is absent", async () => {
    const failure = new TypeError("network down");
    const fetch = vi.fn(() => {
      return Promise.resolve(
        new Response(
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
        ),
      );
    });

    const stream = await fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        body: "prompt",
        endpoint: "/events",
        method: "POST",
      },
      { fetch, retry: resolveRetryPolicy({ maxRetries: 2, delayMs: 0 }) },
    );
    const closed = await stream.closed;

    expect(closed).toMatchObject({ kind: "error", code: "NET_UNREACHABLE" });
    expect(closed.cause).toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("raw transport handshake decoding", () => {
  test.each([
    {
      body: '{"value":3}',
      schema: struct.object({ value: struct.number() }),
      contentType: "application/json",
      expected: { value: 3 },
    },
    {
      body: "denied",
      schema: struct.string(),
      contentType: "text/plain",
      expected: "denied",
    },
    {
      body: null,
      schema: struct.string(),
      contentType: "text/plain",
      expected: "",
    },
  ])(
    "decodes $contentType handshake bodies without an operation decoder",
    async ({ body, schema, contentType, expected }) => {
      const failure: EventStreamFailureInfo = {};
      await expect(
        fetchEventStream(
          {
            baseEndpoint: "https://example.test",
            endpoint: "/events",
            method: "GET",
          },
          {
            fetch: () =>
              Promise.resolve(
                new Response(body, {
                  status: 403,
                  headers: { "content-type": contentType },
                }),
              ),
            handshakeError: schema,
            failure,
          },
        ),
      ).rejects.toMatchObject({
        code: "HTTP_STATUS",
        data: expected,
        status: 403,
      });
      expect(failure.open?.response.body).toEqual(expected);
    },
  );

  test("keeps cancellation while a declared handshake body is being read", async () => {
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    const pending = fetchEventStream(
      {
        baseEndpoint: "https://example.test",
        endpoint: "/events",
        method: "GET",
        signal: controller.signal,
      },
      {
        fetch: () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(target) {
                  target.enqueue(new Uint8Array([100]));
                },
                pull() {
                  started.resolve();
                },
              }),
              { status: 403, headers: { "content-type": "text/plain" } },
            ),
          ),
        handshakeError: struct.string(),
      },
    );
    await started.promise;
    controller.abort(ERR_ABORTED);
    await expect(pending).rejects.toBe(ERR_ABORTED);
  });
});

describe("fetchEventStream queue bound", () => {
  const request: HttpRequest = {
    baseEndpoint: "https://example.com",
    endpoint: "/events",
    method: "GET",
  };

  function events(count: number): string {
    return Array.from({ length: count }, (_, i) => `data: ${i + 1}\n\n`).join(
      "",
    );
  }

  /** One chunk, then a body that stays open, so the only way out is a close or an abort. */
  function openBody(text: string, cancel: () => void) {
    let sent = false;
    return new ReadableStream<Uint8Array>(
      {
        cancel,
        pull(controller) {
          if (sent) {
            return new Promise<void>(() => undefined);
          }
          sent = true;
          controller.enqueue(new TextEncoder().encode(text));
          return undefined;
        },
      },
      { highWaterMark: 0 },
    );
  }

  function respondWithBody(body: ReadableStream<Uint8Array>) {
    return vi.fn(() =>
      Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
  }

  test("should deliver every event of one chunk that exceeds the queue size", async () => {
    const total = QUEUE_SIZE + 6;
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(events(total), {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    const stream = await fetchTransformedEventStream(request, {
      fetch,
      transformMessage: (message) => message.data,
    });

    const received: string[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual(
      Array.from({ length: total }, (_, i) => String(i + 1)),
    );
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("should stop parsing while the queue is full", async () => {
    const total = QUEUE_SIZE + 4;
    const parsed: string[] = [];
    const stream = await fetchTransformedEventStream(request, {
      fetch: respondWithBody(openBody(events(total), () => undefined)),
      transformMessage(message) {
        parsed.push(message.data);
        return message.data;
      },
    });

    // The queue fills up and one more event waits for room.
    await vi.waitFor(() => expect(parsed).toHaveLength(QUEUE_SIZE + 1));
    await yieldMacrotask();
    expect(parsed).toHaveLength(QUEUE_SIZE + 1);

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: "1" });
    await vi.waitFor(() => expect(parsed).toHaveLength(QUEUE_SIZE + 2));

    const rest: string[] = [];
    for (let i = 0; i < total - 1; i += 1) {
      const result = await iterator.next();
      if (result.done) {
        throw new Error("the stream ended early");
      }
      rest.push(result.value);
    }
    expect(rest).toEqual(
      Array.from({ length: total - 1 }, (_, i) => String(i + 2)),
    );
    expect(parsed).toHaveLength(total);
    stream.close();
    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
  });

  test("should release a producer waiting for room and discard unread events when the stream is closed", async () => {
    const parsed: string[] = [];
    const cancel = vi.fn();
    const stream = await fetchTransformedEventStream(request, {
      fetch: respondWithBody(openBody(events(QUEUE_SIZE + 4), cancel)),
      transformMessage(message) {
        parsed.push(message.data);
        return message.data;
      },
    });
    await vi.waitFor(() => expect(parsed).toHaveLength(QUEUE_SIZE + 1));

    stream.close();

    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    const received: string[] = [];
    for await (const event of stream) {
      received.push(event);
    }
    expect(received).toEqual([]);
    expect(parsed).toHaveLength(QUEUE_SIZE + 1);
  });

  test("should release a producer waiting for room and discard unread events when the request signal aborts", async () => {
    const controller = new AbortController();
    const parsed: string[] = [];
    const cancel = vi.fn();
    const stream = await fetchTransformedEventStream(
      { ...request, signal: controller.signal },
      {
        fetch: respondWithBody(openBody(events(QUEUE_SIZE + 4), cancel)),
        transformMessage(message) {
          parsed.push(message.data);
          return message.data;
        },
      },
    );
    await vi.waitFor(() => expect(parsed).toHaveLength(QUEUE_SIZE + 1));

    controller.abort(ERR_ABORTED);

    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
    expect(cancel).toHaveBeenCalledOnce();
    const received: string[] = [];
    for await (const event of stream) {
      received.push(event);
    }
    expect(received).toEqual([]);
    expect(parsed).toHaveLength(QUEUE_SIZE + 1);
  });
});

describe("fetchEventStream failure delivery", () => {
  const request: HttpRequest = {
    baseEndpoint: "https://example.com",
    endpoint: "/events",
    method: "GET",
  };

  const THREE = "data: 1\n\ndata: 2\n\ndata: 3\n\n";

  /** Sends the text, then ends the body, errors it, or stays open until the request is aborted. */
  function bodyThen(text: string, ending: "eof" | "error" | "open") {
    let sent = false;
    return new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new TextEncoder().encode(text));
            return undefined;
          }
          if (ending === "eof") {
            controller.close();
            return undefined;
          }
          if (ending === "error") {
            controller.error(new TypeError("connection reset"));
            return undefined;
          }
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
  }

  function respondOnce(body: ReadableStream<Uint8Array>) {
    return vi.fn(() =>
      Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
  }

  async function drain(stream: EventStreamHandle<string>) {
    const received: string[] = [];
    const rejection = await (async () => {
      try {
        for await (const event of stream) {
          received.push(event);
        }
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    return { received, rejection };
  }

  test("should deliver queued events before rejecting after a network error", async () => {
    const parsed: string[] = [];
    const stream = await fetchTransformedEventStream(request, {
      fetch: respondOnce(bodyThen(THREE, "error")),
      transformMessage(message) {
        parsed.push(message.data);
        return message.data;
      },
    });
    await vi.waitFor(() => expect(parsed).toHaveLength(3));

    const closed = await stream.closed;
    if (closed.kind !== "error") {
      throw new Error("expected the stream to end with an error");
    }
    expect(closed.code).toBe("NET_UNREACHABLE");
    const { received, rejection } = await drain(stream);

    expect(received).toEqual(["1", "2", "3"]);
    expect(rejection).toBe(closed.cause);
  });

  test("should deliver queued events before rejecting after reconnects run out", async () => {
    const parsed: string[] = [];
    let calls = 0;
    const fetch = vi.fn(() => {
      calls += 1;
      if (calls > 1) {
        return Promise.reject(new TypeError("still down"));
      }
      return Promise.resolve(
        new Response(bodyThen(THREE, "error"), {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    });
    const stream = await fetchTransformedEventStream(request, {
      fetch,
      retry: resolveRetryPolicy({ maxRetries: 1, delayMs: 0 }),
      transformMessage(message) {
        parsed.push(message.data);
        return message.data;
      },
    });
    await vi.waitFor(() => expect(parsed).toHaveLength(3));

    const closed = await stream.closed;
    expect(closed).toMatchObject({ kind: "error" });
    const { received, rejection } = await drain(stream);

    expect(received).toEqual(["1", "2", "3"]);
    expect(rejection).toBeInstanceOf(Error);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("should deliver queued events before rejecting after a timeout", async () => {
    const controller = new AbortController();
    const parsed: string[] = [];
    const stream = await fetchTransformedEventStream(
      { ...request, signal: controller.signal },
      {
        fetch: respondOnce(bodyThen(THREE, "open")),
        transformMessage(message) {
          parsed.push(message.data);
          return message.data;
        },
      },
    );
    await vi.waitFor(() => expect(parsed).toHaveLength(3));

    controller.abort(new DOMException("deadline expired", "TimeoutError"));

    await expect(stream.closed).resolves.toMatchObject({
      code: "NET_TIMEOUT",
      kind: "error",
    });
    const { received, rejection } = await drain(stream);

    expect(received).toEqual(["1", "2", "3"]);
    expect(rejection).toBe(ERR_TIMEOUT);
  });

  test("should discard queued events for a read made right after a manual abort", async () => {
    const controller = new AbortController();
    const parsed: string[] = [];
    const stream = await fetchTransformedEventStream(
      { ...request, signal: controller.signal },
      {
        fetch: respondOnce(bodyThen(THREE, "open")),
        transformMessage(message) {
          parsed.push(message.data);
          return message.data;
        },
      },
    );
    await vi.waitFor(() => expect(parsed).toHaveLength(3));

    // The transport learns of the abort only when its read fails; the read below comes first.
    controller.abort(ERR_ABORTED);
    const { received, rejection } = await drain(stream);

    expect(received).toEqual([]);
    expect(rejection).toBeUndefined();
    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
  });

  test("should deliver queued events for a read made right after a timeout abort", async () => {
    const controller = new AbortController();
    const parsed: string[] = [];
    const stream = await fetchTransformedEventStream(
      { ...request, signal: controller.signal },
      {
        fetch: respondOnce(bodyThen(THREE, "open")),
        transformMessage(message) {
          parsed.push(message.data);
          return message.data;
        },
      },
    );
    await vi.waitFor(() => expect(parsed).toHaveLength(3));

    controller.abort(new DOMException("deadline expired", "TimeoutError"));
    const { received, rejection } = await drain(stream);

    expect(received).toEqual(["1", "2", "3"]);
    expect(rejection).toBe(ERR_TIMEOUT);
  });

  describe("a stop after the stream ended", () => {
    const stops: [
      string,
      (stream: EventStreamHandle<string>, controller: AbortController) => void,
    ][] = [
      ["close()", (stream) => stream.close()],
      ["an abort", (_stream, controller) => controller.abort(ERR_ABORTED)],
      [
        "a timeout abort",
        (_stream, controller) =>
          controller.abort(new DOMException("deadline", "TimeoutError")),
      ],
    ];

    async function endedStream(ending: "eof" | "error") {
      const controller = new AbortController();
      const parsed: string[] = [];
      const stream = await fetchTransformedEventStream(
        { ...request, signal: controller.signal },
        {
          fetch: respondOnce(bodyThen(THREE, ending)),
          transformMessage(message) {
            parsed.push(message.data);
            return message.data;
          },
        },
      );
      await vi.waitFor(() => expect(parsed).toHaveLength(3));
      const closed = await stream.closed;
      expect(closed.kind).toBe(ending);
      return { closed, controller, stream };
    }

    test.each(stops)(
      "should discard unread events and end after %s on a stream that reached eof",
      async (_name, stop) => {
        const { closed, controller, stream } = await endedStream("eof");

        stop(stream, controller);
        const { received, rejection } = await drain(stream);

        expect(received).toEqual([]);
        expect(rejection).toBeUndefined();
        await expect(stream.closed).resolves.toBe(closed);
      },
    );

    test.each(stops)(
      "should discard unread events and still reject with the cause after %s on a stream that failed",
      async (_name, stop) => {
        const { closed, controller, stream } = await endedStream("error");
        if (closed.kind !== "error") {
          throw new Error("expected an error ending");
        }

        stop(stream, controller);
        const { received, rejection } = await drain(stream);

        expect(received).toEqual([]);
        expect(rejection).toBe(closed.cause);
        await expect(stream.closed).resolves.toBe(closed);
      },
    );

    test.each(["eof", "error"] as const)(
      "should discard unread events after disposal on a stream that ended with %s",
      async (ending) => {
        const { closed, stream } = await endedStream(ending);

        await stream[Symbol.asyncDispose]();
        const { received, rejection } = await drain(stream);

        expect(received).toEqual([]);
        expect(rejection).toBe(
          closed.kind === "error" ? closed.cause : undefined,
        );
        await expect(stream.closed).resolves.toBe(closed);
      },
    );
  });

  test("should discard unread events and end after close()", async () => {
    const parsed: string[] = [];
    const stream = await fetchTransformedEventStream(request, {
      fetch: respondOnce(bodyThen(THREE, "open")),
      transformMessage(message) {
        parsed.push(message.data);
        return message.data;
      },
    });
    await vi.waitFor(() => expect(parsed).toHaveLength(3));

    stream.close();
    // Read before anything asynchronous runs, so only close() itself can have discarded the events.
    const { received, rejection } = await drain(stream);

    expect(received).toEqual([]);
    expect(rejection).toBeUndefined();
    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
  });

  test("should discard queued events and end at once after a manual abort", async () => {
    const controller = new AbortController();
    const parsed: string[] = [];
    const stream = await fetchTransformedEventStream(
      { ...request, signal: controller.signal },
      {
        fetch: respondOnce(bodyThen(THREE, "open")),
        transformMessage(message) {
          parsed.push(message.data);
          return message.data;
        },
      },
    );
    await vi.waitFor(() => expect(parsed).toHaveLength(3));

    controller.abort(ERR_ABORTED);

    await expect(stream.closed).resolves.toMatchObject({ kind: "aborted" });
    const { received, rejection } = await drain(stream);

    expect(received).toEqual([]);
    expect(rejection).toBeUndefined();
  });
});
