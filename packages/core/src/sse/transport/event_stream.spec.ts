import {
  afterEach,
  describe,
  expect,
  inject,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { createServer, type Socket } from "node:net";
import { ERR_ABORTED } from "../../error";
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

type TestOptions<T> = Omit<
  FetchEventStreamOptions<T>,
  "maxBufferSize" | "maxQueueSize"
> & {
  maxBufferSize?: number;
  maxQueueSize?: number;
};

function fetchEventStream<T = EventStreamMessage>(
  request: HttpRequest,
  options: TestOptions<T> = {},
) {
  return fetchEventStreamInternal(request, {
    maxBufferSize: 1024,
    maxQueueSize: 16,
    ...options,
  } as FetchEventStreamOptions<T>);
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
          fetch: async () => {
            requests += 1;
            return scriptedConnection(
              [`data: ${requests}\n\n`],
              requests < 5 ? "drop" : "eof",
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
        fetch: async () => {
          requests += 1;
          return requests < 5
            ? scriptedConnection([], "drop")
            : scriptedConnection(["data: recovered\n\n"], "eof");
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
      const headers: Buffer[] = [];
      const firstSeen = Promise.withResolvers<void>();
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        let incoming = Buffer.alloc(0);
        socket.on("data", (chunk: Buffer) => {
          incoming = Buffer.concat([incoming, chunk]);
          if (!incoming.includes("\r\n\r\n")) return;
          headers.push(incoming);
          const body =
            headers.length === 1
              ? `id: ${id}\ndata: first\n\n`
              : "data: second\n\n";
          const payload = Buffer.from(body);
          const reply = Buffer.concat([
            Buffer.from(
              `HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${payload.length.toString(16)}\r\n`,
            ),
            payload,
            Buffer.from(headers.length === 1 ? "\r\n" : "\r\n0\r\n\r\n"),
          ]);
          if (headers.length === 1) {
            socket.write(reply);
            void firstSeen.promise.then(() => socket.end());
          } else {
            socket.end(reply);
          }
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected a loopback port");
      try {
        const stream = await fetchEventStream(
          {
            baseEndpoint: `http://127.0.0.1:${address.port}`,
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
          headers[1]?.toString("latin1") ?? "",
        )?.[1];
        expect(header).toBeDefined();
        if (header === undefined)
          throw new Error("Expected Last-Event-ID on the wire");
        expect([...Buffer.from(header, "latin1")]).toEqual(expectedBytes);
        await expect(stream.closed).resolves.toEqual({ kind: "eof" });
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  test("should handle a platform Last-Event-ID header rejection through the per-attempt retry policy", async () => {
    const originalSet = Headers.prototype.set;
    const writeHeader = vi
      .spyOn(Headers.prototype, "set")
      .mockImplementation(function (this: Headers, name, value) {
        if (name === "last-event-id")
          throw new TypeError("Header rejected by the platform");
        originalSet.call(this, name, value);
      });
    onTestFinished(() => writeHeader.mockRestore());
    const policy = vi.fn((_context: { attempt: number }) => true);
    const fetch = vi.fn(async () =>
      scriptedConnection(["id: 猫\ndata: first\n\n"], "drop"),
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
    const fetch = async (input: RequestInfo | URL) => {
      attempt += 1;
      const lastEventId = new Request(input).headers.get("last-event-id");
      if (attempt === 1) {
        expect(lastEventId).toBeNull();
        let pulled = false;
        return new Response(
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
        );
      }

      expect(lastEventId).toBe("1");
      return new Response("id: 2\ndata: second\n\n", {
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "attempt-2",
        },
      });
    };

    const stream = await fetchEventStream(request, {
      fetch: fetch as typeof globalThis.fetch,
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
    const fetch = async (input: RequestInfo | URL) => {
      seen.push(new Request(input).headers.get("last-event-id"));
      if (seen.length === 1) {
        let pulled = false;
        return new Response(
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
        );
      }
      return new Response("data: third\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    };

    const stream = await fetchEventStream(request, {
      fetch: fetch as typeof globalThis.fetch,
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
    const fetch = async (input: RequestInfo | URL) => {
      seen.push(new Request(input).headers.get("last-event-id"));
      const [chunks, end] = connections[seen.length - 1] ?? [[], "eof"];
      return scriptedConnection(chunks, end);
    };

    const stream = await fetchEventStream(request, {
      fetch: fetch as typeof globalThis.fetch,
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
      fetch: async () =>
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
        fetch: (async () =>
          new Response("data: ignored\n\n", {
            headers: { "content-type": "text/event-stream" },
            status: 503,
            statusText: "Service Unavailable",
          })) as unknown as typeof fetch,
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
      abort: controller.signal,
    };

    await expect(fetchEventStream(request)).rejects.toBe(ERR_ABORTED);
  });
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
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const pending = fetchEventStream(
      {
        baseEndpoint: "https://example.com",
        body,
        endpoint: "/events",
        method: "POST",
      },
      {
        fetch: fetch as unknown as typeof globalThis.fetch,
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
