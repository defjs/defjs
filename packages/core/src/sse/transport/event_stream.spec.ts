import type { Socket } from "bun";
import {
  afterEach,
  describe,
  expect,
  inject,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { method } from "../../../test/method";
import { ERR_ABORTED, ERR_TIMEOUT } from "../../error";
import { struct } from "../../struct";
import type { HttpRequest } from "../../http";
import {
  __resetStreamingRequestBodySupportForTests,
  ERR_STREAMING_REQUEST_UNSUPPORTED,
} from "../../http/transport/fetch_init";
import { simulateUnsupportedStreaming } from "../../../test/streaming-support";
import type {
  EventStreamFailureInfo,
  FetchEventStreamOptions,
} from "./event_stream";
import { fetchEventStream as fetchEventStreamInternal } from "./event_stream";
import type { EventStreamMessage } from "./parser";

const backoff = await import("../../internal/backoff");

const SSE_RESPONSE_HEADERS =
  "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";

function concatBytes(
  left: Uint8Array,
  right: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left);
  joined.set(right, left.byteLength);
  return joined;
}

function chunkedBody(body: string, terminate: boolean): string {
  const length = new TextEncoder().encode(body).byteLength.toString(16);
  return `${length}\r\n${body}\r\n${terminate ? "0\r\n\r\n" : ""}`;
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

type TestOptions<T> = Omit<
  FetchEventStreamOptions<T>,
  "maxBufferSize" | "maxQueueSize" | "transformMessage"
> & {
  maxBufferSize?: number;
  maxQueueSize?: number;
};

/** Streams the raw parsed messages. */
function fetchEventStream(
  request: HttpRequest,
  options: TestOptions<EventStreamMessage> = {},
) {
  return fetchEventStreamInternal(request, {
    maxBufferSize: 1024,
    maxQueueSize: 16,
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
    maxBufferSize: 1024,
    maxQueueSize: 16,
    ...options,
  });
}

// One scripted connection: the chunks it sends, then either a lost connection or a clean end.
function scriptedConnection(
  chunks: readonly string[],
  end: "drop" | "eof",
): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk !== undefined) {
          controller.enqueue(new TextEncoder().encode(chunk));
        } else if (end === "eof") {
          controller.close();
        } else {
          controller.error(new Error("connection lost"));
        }
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("fetchEventStream", () => {
  test("should reset the retry budget and first delay after each successful reconnect handshake", async () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(backoff, "wait");
    const shouldReconnect = vi.fn((_context: { attempt: number }) => true);
    let requests = 0;
    try {
      const stream = await fetchEventStream(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/events",
          method: "GET",
        },
        {
          fetch: () => {
            requests += 1;
            return Promise.resolve(
              scriptedConnection(
                [`data: ${requests}\n\n`],
                requests < 5 ? "drop" : "eof",
              ),
            );
          },
          reconnect: { attempts: 1, delayMs: 10, factor: 2, shouldReconnect },
        },
      );
      const consumed = (async () => {
        const messages: string[] = [];
        for await (const message of stream) messages.push(message.data);
        return messages;
      })();
      void consumed.catch(() => undefined);

      await vi.runAllTimersAsync();

      await expect(consumed).resolves.toEqual(["1", "2", "3", "4", "5"]);
      expect(requests).toBe(5);
      expect(
        shouldReconnect.mock.calls.map(([context]) => context.attempt),
      ).toEqual([1, 1, 1, 1]);
      expect(timer.mock.calls.map((call) => call[0])).toEqual([10, 10, 10, 10]);
      await expect(stream.closed).resolves.toEqual({ kind: "eof" });
    } finally {
      timer.mockRestore();
      vi.useRealTimers();
    }
  });

  test("should reset the retry budget even when a recovered handshake delivers no events", async () => {
    let requests = 0;
    const stream = await fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/events",
        method: "GET",
      },
      {
        fetch: () => {
          requests += 1;
          return Promise.resolve(
            requests < 5
              ? scriptedConnection([], "drop")
              : scriptedConnection(["data: recovered\n\n"], "eof"),
          );
        },
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );
    const messages: string[] = [];
    for await (const message of stream) messages.push(message.data);

    expect(requests).toBe(5);
    expect(messages).toEqual(["recovered"]);
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test.each([
    ["猫", [0xe7, 0x8c, 0xab]],
    ["été", [0xc3, 0xa9, 0x74, 0xc3, 0xa9]],
  ])(
    "should send UTF-8 Last-Event-ID bytes on the wire for %s",
    async (id, expectedBytes) => {
      const sockets = new Set<Socket>();
      const incomingBySocket = new Map<Socket, Uint8Array>();
      const headers: string[] = [];
      const firstSeen = Promise.withResolvers<void>();
      const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) {
            sockets.add(socket);
          },
          close(socket) {
            sockets.delete(socket);
            incomingBySocket.delete(socket);
          },
          data(socket, chunk) {
            const incoming = concatBytes(
              incomingBySocket.get(socket) ?? new Uint8Array(),
              chunk,
            );
            if (!latin1(incoming).includes("\r\n\r\n")) {
              incomingBySocket.set(socket, incoming);
              return;
            }
            headers.push(latin1(incoming));
            const body =
              headers.length === 1
                ? `id: ${id}\ndata: first\n\n`
                : "data: second\n\n";
            const reply =
              SSE_RESPONSE_HEADERS + chunkedBody(body, headers.length > 1);
            if (headers.length === 1) {
              socket.write(reply);
              void firstSeen.promise.then(() => socket.end());
            } else {
              socket.write(reply);
              socket.end();
            }
          },
        },
      });
      try {
        const stream = await fetchTransformedEventStream(
          {
            baseEndpoint: `http://127.0.0.1:${listener.port}`,
            endpoint: "/events",
            method: "GET",
          },
          {
            reconnect: { attempts: 1, delayMs: 0 },
            transformMessage(message) {
              firstSeen.resolve();
              return message;
            },
          },
        );
        const messages: string[] = [];
        for await (const message of stream) messages.push(message.data);

        expect(messages).toEqual(["first", "second"]);
        expect(headers).toHaveLength(2);
        const header = /\r\nlast-event-id: ([^\r\n]*)\r\n/i.exec(
          headers[1] ?? "",
        )?.[1];
        expect(header).toBeDefined();
        if (header === undefined)
          throw new Error("Expected Last-Event-ID on the wire");
        expect([...header].map((character) => character.charCodeAt(0))).toEqual(
          expectedBytes,
        );
        await expect(stream.closed).resolves.toEqual({ kind: "eof" });
      } finally {
        for (const socket of sockets) socket.terminate();
        listener.stop(true);
      }
    },
  );

  test("should reconnect from the committed id after a partial id frame is cut", async () => {
    const sockets = new Set<Socket>();
    const incomingBySocket = new Map<Socket, string>();
    const headers: string[] = [];
    let firstSocket: Socket | undefined;
    const partial = "id: 1\ndata: first\n\nid: 2\n";
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          sockets.add(socket);
        },
        close(socket) {
          sockets.delete(socket);
          incomingBySocket.delete(socket);
        },
        data(socket, chunk) {
          const incoming = (incomingBySocket.get(socket) ?? "") + latin1(chunk);
          if (!incoming.includes("\r\n\r\n")) {
            incomingBySocket.set(socket, incoming);
            return;
          }
          headers.push(incoming);
          const first = headers.length === 1;
          const cursor = /\r\nlast-event-id: ([^\r\n]*)\r\n/i.exec(
            incoming,
          )?.[1];
          const body = first
            ? partial
            : cursor === "1"
              ? "id: 2\ndata: second\n\n"
              : "id: 3\ndata: skipped\n\n";
          const reply = SSE_RESPONSE_HEADERS + chunkedBody(body, !first);
          if (first) {
            firstSocket = socket;
            socket.write(reply);
          } else {
            socket.write(reply);
            socket.end();
          }
        },
      },
    });
    let calls = 0;
    try {
      const stream = await fetchEventStream(
        {
          baseEndpoint: `http://127.0.0.1:${listener.port}`,
          endpoint: "/events",
          method: "GET",
        },
        {
          reconnect: { attempts: 1, delayMs: 0 },
          async fetch(input, init) {
            const response = await globalThis.fetch(input, init);
            if (++calls !== 1) return response;
            const reader = response.body?.getReader();
            if (!reader) throw new Error("Expected response body");
            const partialBytes = new TextEncoder().encode(partial);
            let forwarded = false;
            return new Response(
              new ReadableStream<Uint8Array>(
                {
                  async pull(controller) {
                    if (forwarded) {
                      // Zero prefetch: this pull proves the parser consumed the partial id line.
                      firstSocket?.terminate();
                      await reader.read();
                      return;
                    }
                    let bytes = new Uint8Array();
                    while (bytes.byteLength < partialBytes.byteLength) {
                      const result = await reader.read();
                      if (result.done)
                        throw new Error("Expected partial frame");
                      bytes = concatBytes(bytes, result.value);
                    }
                    forwarded = true;
                    controller.enqueue(bytes);
                  },
                  cancel(reason) {
                    return reader.cancel(reason);
                  },
                },
                { highWaterMark: 0 },
              ),
              { headers: response.headers },
            );
          },
        },
      );
      const messages: EventStreamMessage[] = [];
      for await (const message of stream) messages.push(message);

      expect(headers).toHaveLength(2);
      expect(headers[1]).toMatch(/\r\nlast-event-id: 1\r\n/i);
      expect(messages.map((message) => message.id)).toEqual(["1", "2"]);
      expect(messages.map((message) => message.data)).toEqual([
        "first",
        "second",
      ]);
      await expect(stream.closed).resolves.toEqual({ kind: "eof" });
    } finally {
      for (const socket of sockets) socket.terminate();
      listener.stop(true);
    }
  });

  test("should handle a platform Last-Event-ID header rejection through the per-attempt retry policy", async () => {
    const originalSet = method(Headers.prototype, "set");
    const writeHeader = vi
      .spyOn(Headers.prototype, "set")
      .mockImplementation(function (this: Headers, name, value) {
        if (name === "last-event-id")
          throw new TypeError("Header rejected by the platform");
        originalSet.call(this, name, value);
      });
    onTestFinished(() => writeHeader.mockRestore());
    const policy = vi.fn((_context: { attempt: number }) => true);
    const fetch = vi.fn(() =>
      Promise.resolve(scriptedConnection(["id: 猫\ndata: first\n\n"], "drop")),
    );
    const stream = await fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/events",
        method: "GET",
      },
      {
        fetch,
        reconnect: { attempts: 1, delayMs: 0, shouldReconnect: policy },
      },
    );
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { data: "first" },
    });
    await expect(iterator.next()).rejects.toThrow();
    expect(policy.mock.calls.map(([context]) => context.attempt)).toEqual([
      1, 2,
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    await expect(stream.closed).resolves.toMatchObject({
      kind: "error",
      code: "NET_UNREACHABLE",
    });
  });

  test("should read basic sse messages with open and closed info", async () => {
    const request: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/sse/basic",
      method: "GET",
    };

    const stream = await fetchEventStream(request);
    expect(stream.open.response.ok).toBe(true);
    expect(stream.open.response.status).toBe(200);
    expect(stream.open.response.headers.get("x-request-id")).toBe(
      "trace-sse-basic",
    );

    const messages: EventStreamMessage[] = [];
    for await (const event of stream) {
      messages.push(event);
    }

    expect(messages).toEqual([
      { id: "1", event: "message", data: "first" },
      { id: "2", event: "message", data: "second line 1\nsecond line 2" },
    ]);

    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test("should retry with last-event-id and update open info", async () => {
    const request: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/events",
      method: "GET",
    };
    let attempt = 0;
    const fetch = (input: RequestInfo | URL) => {
      attempt += 1;
      const lastEventId = new Request(input).headers.get("last-event-id");
      if (attempt === 1) {
        expect(lastEventId).toBeNull();
        let pulled = false;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!pulled) {
                  pulled = true;
                  controller.enqueue(
                    new TextEncoder().encode("id: 1\ndata: first\n\n"),
                  );
                  return;
                }
                controller.error(new Error("connection lost"));
              },
            }),
            {
              headers: {
                "content-type": "text/event-stream",
                "x-request-id": "attempt-1",
              },
            },
          ),
        );
      }

      expect(lastEventId).toBe("1");
      return Promise.resolve(
        new Response("id: 2\ndata: second\n\n", {
          headers: {
            "content-type": "text/event-stream",
            "x-request-id": "attempt-2",
          },
        }),
      );
    };

    const stream = await fetchEventStream(request, {
      fetch: fetch,
      onerror() {
        return 0;
      },
      reconnect: { attempts: 3, delayMs: 0 },
    });

    const messages: EventStreamMessage[] = [];
    for await (const event of stream) {
      messages.push(event);
    }

    expect(messages.map((event) => event.data)).toEqual(["first", "second"]);
    expect(stream.open.response.headers.get("x-request-id")).toBe("attempt-2");
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test("should drop last-event-id on reconnect after an empty id field", async () => {
    const request: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/events",
      method: "GET",
    };
    const seen: (string | null)[] = [];
    const fetch = (input: RequestInfo | URL) => {
      seen.push(new Request(input).headers.get("last-event-id"));
      if (seen.length === 1) {
        let pulled = false;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!pulled) {
                  pulled = true;
                  controller.enqueue(
                    new TextEncoder().encode(
                      "id: 1\ndata: first\n\nid:\ndata: second\n\n",
                    ),
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
      return Promise.resolve(
        new Response("data: third\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    };

    const stream = await fetchEventStream(request, {
      fetch: fetch,
      onerror() {
        return 0;
      },
      reconnect: { attempts: 3, delayMs: 0 },
    });
    const messages: string[] = [];
    for await (const event of stream) {
      messages.push(event.data);
    }

    expect(messages).toEqual(["first", "second", "third"]);
    expect(seen).toEqual([null, null]);
  });

  test("should send the latest event id on every one of several reconnects", async () => {
    const request: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/events",
      headers: new Headers({ "Last-Event-ID": "seed" }),
      method: "GET",
    };
    const connections: [chunks: string[], end: "drop" | "eof"][] = [
      // The caller's id goes out until the stream sends one of its own.
      [["data: one\n\n"], "drop"],
      [["id: a\ndata: two\n\n"], "drop"],
      // A connection without an id leaves the last one in place.
      [["data: three\n\n"], "drop"],
      // An id that contains NUL is ignored.
      [["id: b\0\ndata: four\n\n"], "drop"],
      // The last id of a connection is the one that counts.
      [["id: c\ndata: five\n\nid: d\ndata: six\n\n"], "drop"],
      // An empty id clears the stored one, and the header stays off until a real id arrives.
      [["id:\ndata: seven\n\n"], "drop"],
      [["data: eight\n\n"], "drop"],
      [["id: e\ndata: nine\n\n"], "eof"],
    ];
    const seen: (string | null)[] = [];
    const fetch = (input: RequestInfo | URL) => {
      seen.push(new Request(input).headers.get("last-event-id"));
      const [chunks, end] = connections[seen.length - 1] ?? [[], "eof"];
      return Promise.resolve(scriptedConnection(chunks, end));
    };

    const stream = await fetchEventStream(request, {
      fetch: fetch,
      onerror() {
        return 0;
      },
      reconnect: { attempts: 10, delayMs: 0 },
    });
    const messages: string[] = [];
    for await (const event of stream) {
      messages.push(event.data);
    }

    expect(messages).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
    ]);
    expect(seen).toEqual(["seed", "seed", "a", "a", "a", "d", null, null]);
    // The request the caller handed in is not edited to carry the stream's ids.
    expect(request.headers?.get("last-event-id")).toBe("seed");
    await expect(stream.closed).resolves.toEqual({ kind: "eof" });
  });

  test("should close stream manually", async () => {
    const request: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/sse/infinite",
      method: "GET",
    };

    const stream = await fetchEventStream(request, {
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode("event: tick\ndata: 1\n\n"),
                );
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
    });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ event: "tick", data: "1" });

    stream.close("stop");
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(stream.closed).resolves.toEqual({
      kind: "aborted",
      reason: "stop",
      cause: "stop",
    });
  });

  test("should reject when response is not event stream", async () => {
    const request: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/json",
      method: "GET",
    };

    await expect(fetchEventStream(request)).rejects.toThrowError(
      /Expected content-type/,
    );
  });

  test("should reject non-2xx open responses through response.ok without a synthetic error", async () => {
    const request: HttpRequest = {
      baseEndpoint: "https://example.com",
      endpoint: "/events",
      method: "GET",
    };
    let thrown: unknown;
    const failure: EventStreamFailureInfo = {};

    try {
      await fetchEventStream(request, {
        failure,
        fetch: () =>
          Promise.resolve(
            new Response("data: ignored\n\n", {
              headers: { "content-type": "text/event-stream" },
              status: 503,
              statusText: "Service Unavailable",
            }),
          ),
      });
    } catch (error) {
      thrown = error;
    }

    const open = failure.open;
    expect(thrown).toBeInstanceOf(Error);
    expect(open?.response.ok).toBe(false);
  });

  test("should reject with aborted error when aborted before open", async () => {
    const controller = new AbortController();
    controller.abort();

    const request: HttpRequest = {
      baseEndpoint: inject("testServerHost"),
      endpoint: "/sse/infinite",
      method: "GET",
      signal: controller.signal,
    };

    await expect(fetchEventStream(request)).rejects.toBe(ERR_ABORTED);
  });
});

describe("SSE final endpoint attribution", () => {
  test.each([
    {
      cause: new TypeError("reader failed"),
      want: { attempted: true, code: "NET_UNREACHABLE" },
    },
    { cause: ERR_TIMEOUT, want: { attempted: true, code: "NET_TIMEOUT" } },
    { cause: ERR_ABORTED, want: { attempted: false } },
  ])("maps a read rejection with cause $cause", async ({ cause, want }) => {
    const done = vi.fn();
    const stream = await fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        endpoint: "/events",
        method: "GET",
      },
      {
        fetch: () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  controller.error(cause);
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            ),
          ),
        endpointAttempt: {
          done,
          pickNext() {
            throw new Error("unexpected reconnect");
          },
        },
      },
    );
    await stream.closed;
    expect(stream.open.response.status).toBe(200);
    expect(done).toHaveBeenCalledExactlyOnceWith(want);
  });

  test.each(["false", "throw", "reject"])(
    "keeps one physical read failure when shouldReconnect returns %s",
    async (policy) => {
      const done = vi.fn();
      const pickNext = vi.fn(() => {
        throw new Error("unexpected reconnect");
      });
      const policyError = new TypeError("application policy");
      const shouldReconnect = vi.fn(() => {
        if (policy === "throw") throw policyError;
        if (policy === "reject") return Promise.reject(policyError);
        return false;
      });
      const stream = await fetchEventStream(
        {
          baseEndpoint: "https://example.com",
          endpoint: "/events",
          method: "GET",
        },
        {
          fetch: () => Promise.resolve(scriptedConnection([], "drop")),
          endpointAttempt: { done, pickNext },
          reconnect: { attempts: 1, delayMs: 0, shouldReconnect },
        },
      );
      expect(await stream.closed).toMatchObject({
        kind: "error",
        code: "NET_UNREACHABLE",
      });
      expect(shouldReconnect).toHaveBeenCalledOnce();
      expect(pickNext).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledExactlyOnceWith({
        attempted: true,
        code: "NET_UNREACHABLE",
      });
    },
  );

  test.each([
    { mode: "eof", code: undefined, startup: false, status: 200 },
    { mode: "onopen", code: "EXT_HOOK_FAILED", startup: true, status: 200 },
    { mode: "onclose", code: "EXT_HOOK_FAILED", startup: false, status: 200 },
    {
      mode: "transform",
      code: "EXT_OBSERVER_FAILED",
      startup: false,
      status: 200,
    },
    {
      mode: "parser",
      code: "CAP_BUFFER_EXCEEDED",
      startup: false,
      status: 200,
    },
    { mode: "queue", code: "CAP_QUEUE_OVERFLOW", startup: false, status: 200 },
    { mode: "getReader", code: "NET_UNREACHABLE", startup: false, status: 200 },
    {
      mode: "error-observer",
      code: "NET_UNREACHABLE",
      startup: false,
      status: 200,
    },
    { mode: "policy", code: "NET_UNREACHABLE", startup: false, status: 200 },
    {
      mode: "media",
      code: "RES_MEDIA_TYPE_INVALID",
      startup: true,
      status: 200,
    },
    {
      mode: "handshake-body",
      code: "RES_DECODE_FAILED",
      startup: true,
      status: 503,
    },
    {
      mode: "handshake-status",
      code: "HTTP_STATUS",
      startup: true,
      status: 503,
    },
  ])(
    "does not misattribute $mode as a new network failure",
    async ({ mode, code, startup, status }) => {
      const done = vi.fn();
      const pickNext = vi.fn(() => {
        throw new Error("unexpected reconnect");
      });
      const cause = new TypeError("not a native read failure");
      const policy = vi.fn(() => {
        if (mode === "policy") throw cause;
        return false;
      });
      const response = new Response(
        mode === "handshake-body"
          ? new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.error(cause);
              },
            })
          : mode === "parser"
            ? `data: ${"x".repeat(32)}`
            : "data: first\n\ndata: second\n\n",
        {
          headers: {
            "content-type":
              mode === "media" ? "text/plain" : "text/event-stream",
          },
          status,
        },
      );
      const owner = ["getReader", "error-observer", "policy"].includes(mode)
        ? response.body?.getReader()
        : undefined;
      try {
        const pending = fetchTransformedEventStream(
          {
            baseEndpoint: "https://example.com",
            endpoint: "/events",
            method: "GET",
          },
          {
            fetch: () => Promise.resolve(response),
            endpointAttempt: { done, pickNext },
            reconnect: { attempts: 1, delayMs: 0, shouldReconnect: policy },
            handshakeError:
              mode === "handshake-body" ? struct.string() : undefined,
            maxBufferSize: mode === "parser" ? 8 : 1024,
            maxQueueSize: mode === "queue" ? 1 : 16,
            onopen() {
              if (mode === "onopen") throw cause;
            },
            onclose() {
              if (mode === "onclose") throw cause;
            },
            onerror() {
              if (mode === "error-observer") throw cause;
            },
            transformMessage(message) {
              if (mode === "transform") throw cause;
              return message;
            },
          },
        );
        if (startup) {
          await expect(pending).rejects.toMatchObject({ code });
        } else {
          const stream = await pending;
          const closed = await stream.closed;
          expect(closed).toMatchObject(
            code ? { kind: "error", code } : { kind: "eof" },
          );
        }
        expect(done).toHaveBeenCalledExactlyOnceWith({
          attempted: true,
          status,
          ...(status === 503 ? { code: "NET_UNAVAILABLE" } : {}),
        });
        expect(pickNext).not.toHaveBeenCalled();
        // A 503 handshake is retryable, so the declining policy is consulted for it too.
        expect(policy).toHaveBeenCalledTimes(
          [
            "getReader",
            "policy",
            "handshake-body",
            "handshake-status",
          ].includes(mode)
            ? 1
            : 0,
        );
      } finally {
        owner?.releaseLock();
      }
    },
  );
});

describe("unsupported streaming request body", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetStreamingRequestBodySupportForTests();
  });

  test("should reject a ReadableStream body with the shared sentinel before onerror or reconnect", async () => {
    simulateUnsupportedStreaming();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
        controller.close();
      },
    });
    const onerror = vi.fn(() => undefined);
    const shouldReconnect = vi.fn(() => false);
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const pending = fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        body,
        endpoint: "/events",
        method: "POST",
      },
      {
        fetch: fetch,
        onerror,
        reconnect: { delayMs: 60_000, shouldReconnect },
      },
    );

    await expect(pending).rejects.toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
    expect(onerror).toHaveBeenCalledTimes(0);
    expect(shouldReconnect).toHaveBeenCalledTimes(0);
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(body.locked).toBe(false);
  });
});
