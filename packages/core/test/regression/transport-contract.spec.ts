import { expect, test, vi } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  makeResponse,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withQuerySerializer,
  withSSEHandle,
  withWebSocketHandle,
} from "../../src";

const jsonHeaders = { "content-type": "application/json" };
const nullEndpoint = defineRequest({
  method: "GET",
  path: "/null",
  output: struct.null(),
  error: struct.null(),
});

test.each([200, 403])(
  "JSON null survives transparent response reconstruction at status %s",
  async (status) => {
    const observations = [];
    for (const mode of ["identity", "spread", "makeResponse"]) {
      const client = createClient(
        withEndpoint("https://example.test"),
        withHTTPHandle(
          async () => new Response("null", { status, headers: jsonHeaders }),
        ),
        withInterceptors(
          createHttpInterceptor(async (request, next) => {
            const response = await next(request);
            if (mode === "identity") return response;
            if (mode === "spread") return { ...response };
            return makeResponse({ ...response });
          }),
        ),
      );
      const [fault, data] = await client.execute(nullEndpoint());
      observations.push({
        mode,
        code: fault?.code ?? null,
        data: fault?.code === "HTTP_STATUS" ? fault.data : data,
      });
    }
    expect(observations).toEqual(
      ["identity", "spread", "makeResponse"].map((mode) => ({
        mode,
        code: status === 200 ? null : "HTTP_STATUS",
        data: null,
      })),
    );
  },
);

test.each([200, 403])(
  "makeResponse accepts an explicit parsed JSON null at status %s",
  async (status) => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            status,
            headers: new Headers(jsonHeaders),
            body: null,
          }),
        ),
      ),
    );
    const [fault, data] = await client.execute(nullEndpoint());
    expect(fault?.code ?? null).toBe(status === 200 ? null : "HTTP_STATUS");
    expect(fault?.code === "HTTP_STATUS" ? fault.data : data).toBeNull();
  },
);

test.each([200, 403])(
  "raw JSON null and truly absent bodies remain distinct at status %s",
  async (status) => {
    for (const present of [true, false]) {
      const client = createClient(
        withEndpoint("https://example.test"),
        withInterceptors(
          createHttpInterceptor(async () =>
            makeResponse({
              status,
              headers: new Headers(jsonHeaders),
              ...(present ? { body: new TextEncoder().encode("null") } : {}),
            }),
          ),
        ),
      );
      const [fault, data] = await client.execute(nullEndpoint());
      expect(fault?.code ?? null).toBe(
        present ? (status === 200 ? null : "HTTP_STATUS") : "RES_DECODE_FAILED",
      );
      if (present)
        expect(fault?.code === "HTTP_STATUS" ? fault.data : data).toBeNull();
    }
  },
);

test.each([200, 403])(
  "zero-byte JSON is a representation failure at status %s",
  async (status) => {
    const observations = [];
    for (const mode of ["native", "synthetic"]) {
      const client = createClient(
        withEndpoint("https://example.test"),
        ...(mode === "native"
          ? [
              withHTTPHandle(
                async () => new Response("", { status, headers: jsonHeaders }),
              ),
            ]
          : [
              withInterceptors(
                createHttpInterceptor(async () =>
                  makeResponse({
                    status,
                    headers: new Headers(jsonHeaders),
                    body: new Uint8Array(),
                  }),
                ),
              ),
            ]),
      );
      const [fault, data] = await client.execute(nullEndpoint());
      observations.push({
        mode,
        code: fault?.code ?? null,
        data: fault?.code === "HTTP_STATUS" ? fault.data : data,
      });
    }
    expect(observations).toEqual(
      ["native", "synthetic"].map((mode) => ({
        mode,
        code: "RES_DECODE_FAILED",
        data: undefined,
      })),
    );
  },
);

test("SSE rejects empty JSON but accepts encoded null and empty raw text", async () => {
  for (const mode of ["empty-json", "null-json", "absent-text", "empty-text"]) {
    const text =
      mode === "null-json" ? "null" : mode === "absent-text" ? null : "";
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(
        async () => new Response(text, { status: 403, headers: jsonHeaders }),
      ),
    );
    const endpoint = defineEventStream({
      path: "/events",
      events: { message: struct.string() },
      error: mode.endsWith("json") ? struct.null() : struct.string(),
      maxBufferSize: 1024,
      maxQueueSize: 4,
    });
    const [fault] = await client.execute(endpoint());
    expect(fault?.code).toBe(
      mode === "empty-json" ? "RES_DECODE_FAILED" : "HTTP_STATUS",
    );
    if (fault?.code === "HTTP_STATUS")
      expect(fault.data).toBe(mode === "null-json" ? null : "");
  }
});

test.each(["abort", "timeout"])(
  "SSE classifies a pre-cancelled interceptor signal as %s",
  async (mode) => {
    let fetches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(async () => {
        fetches += 1;
        return new Response("data: test\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }),
      withInterceptors(
        createSSEInterceptor((request, next) =>
          next({
            ...request,
            abort: AbortSignal.abort(
              mode === "timeout"
                ? new DOMException("deadline", "TimeoutError")
                : "stop",
            ),
          }),
        ),
      ),
    );
    const endpoint = defineEventStream({
      path: "/events",
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 4,
    });
    const [fault, stream] = await client.execute(endpoint());
    try {
      expect(fetches).toBe(0);
      expect(fault?.code).toBe(
        mode === "timeout" ? "NET_TIMEOUT" : "NET_ABORTED",
      );
      expect(stream).toBeUndefined();
    } finally {
      stream?.close();
    }
  },
);

test.each(["caller", "replacement"])(
  "WebSocket keeps the %s signal active after delivery",
  async (source) => {
    const instances: Socket[] = [];
    class Socket extends EventTarget {
      static readonly OPEN = 1;
      readyState = 0;
      bufferedAmount = 0;
      protocol = "";
      extensions = "";
      binaryType = "blob";
      readonly url: string;
      constructor(url: string | URL) {
        super();
        this.url = String(url);
        instances.push(this);
        queueMicrotask(() => {
          if (this.readyState !== 0) return;
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
        });
      }
      send(_data: string) {}
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
      }
    }
    const caller = new AbortController();
    const replacement = new AbortController();
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(Socket),
      withInterceptors(
        createWebSocketInterceptor((request, next) =>
          next({ ...request, abort: replacement.signal }),
        ),
      ),
    );
    const endpoint = defineWebSocket({
      path: "/socket",
      incoming: struct.unknown(),
      maxIncomingQueueSize: 4,
    });
    const [fault, session] = await client.execute(endpoint(), {
      signal: caller.signal,
    });
    try {
      expect(fault).toBeNull();
      if (!session) throw new Error("Expected an open session");
      (source === "caller" ? caller : replacement).abort("after delivery");
      expect((await session.closed).kind).toBe("aborted");
      expect(instances[0]?.readyState).toBe(3);
    } finally {
      caller.abort("cleanup");
      for (const socket of instances) socket.close();
    }
  },
);

test.each(["abort", "timeout"])(
  "synthetic error text decoding remains bounded by %s",
  async (mode) => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<string>();
    class SlowBlob extends Blob {
      override text() {
        started.resolve();
        return release.promise;
      }
    }
    const controller = new AbortController();
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({ status: 403, body: new SlowBlob() }),
        ),
      ),
    );
    const endpoint = defineRequest({
      method: "GET",
      path: "/text",
      error: struct.string(),
    });
    const pending = client.execute(endpoint(), {
      signal: controller.signal,
      ...(mode === "timeout" ? { timeout: 100 } : {}),
    });
    try {
      await started.promise;
      if (mode === "abort") controller.abort("stop read");
      else await vi.advanceTimersByTimeAsync(101);
      expect((await pending)[0]?.code).toBe(
        mode === "abort" ? "NET_ABORTED" : "NET_TIMEOUT",
      );
    } finally {
      controller.abort("cleanup");
      release.resolve("late");
      await pending;
      vi.useRealTimers();
    }
  },
);

test("equivalent union guides ignore object key order and preserve extras", async () => {
  const First = struct.object({ a: struct.string(), b: struct.number() });
  const Second = struct.object({ b: struct.number(), a: struct.string() });
  let sent: unknown;
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async (request) => {
      sent = await new Request(request).json();
      return new Response(null, { status: 204 });
    }),
  );
  const endpoint = defineRequest({
    method: "POST",
    path: "/union",
    input: struct.object({ row: struct.or(First, Second) }),
    builder: (input) => ({
      body: {
        ...input,
        row: { a: input.row.a, b: input.row.b, extra: "kept" },
      },
    }),
  });
  expect(
    (await client.execute(endpoint({ row: { a: "A", b: 2 } })))[0],
  ).toBeNull();
  expect(sent).toEqual({ row: { a: "A", b: 2, extra: "kept" } });
});

test("union agreement must preserve numeric differences seen by a custom query serializer", async () => {
  const First = struct.object({
    x: struct.number().alias("a"),
    y: struct.number().alias("b"),
  });
  const Second = struct.object({
    x: struct.number().alias("b"),
    y: struct.number().alias("a"),
  });
  const serialized: string[] = [];
  const requests: string[] = [];
  const client = createClient(
    withEndpoint("https://example.test"),
    withQuerySerializer((query) => {
      const wire = JSON.stringify(query, (_key, value: unknown) =>
        typeof value === "number" ? String(value) : value,
      );
      serialized.push(wire);
      return `filter=${encodeURIComponent(wire)}`;
    }),
    withHTTPHandle(async (request) => {
      requests.push(new Request(request).url);
      return new Response(null, { status: 204 });
    }),
  );
  const endpoint = defineRequest({
    method: "GET",
    path: "/query",
    input: struct.object({ row: struct.or(First, Second) }),
    builder: (input) => ({
      query: { ...input, row: { x: input.row.x, y: input.row.y } },
    }),
  });
  const [fault] = await client.execute(
    endpoint({ row: { x: Infinity, y: -Infinity } }),
  );
  expect({ code: fault?.code ?? null, serialized, requests }).toEqual({
    code: "REQ_BUILD_FAILED",
    serialized: [],
    requests: [],
  });
});

test("the documented maintenance response supplies a decoded declared error", async () => {
  const client = createClient(
    withEndpoint("https://example.test"),
    withInterceptors(
      createHttpInterceptor(async () =>
        makeResponse({
          status: 503,
          statusText: "Service Unavailable",
          headers: new Headers({ "content-type": "application/json" }),
          body: { message: "Temporarily unavailable" },
        }),
      ),
    ),
  );
  const endpoint = defineRequest({
    method: "GET",
    path: "/maintenance",
    error: struct.object({ message: struct.string() }),
  });
  const [fault] = await client.execute(endpoint());
  expect(fault?.code).toBe("HTTP_STATUS");
  expect(fault?.code === "HTTP_STATUS" ? fault.data : undefined).toEqual({
    message: "Temporarily unavailable",
  });
});

test("a WebSocket endpoint retains its definition when the configuration object is reused", async () => {
  const definition = {
    path: "/first",
    incoming: struct.unknown(),
    maxIncomingQueueSize: 4,
  };
  const first = defineWebSocket(definition);
  definition.path = "/second";
  const second = defineWebSocket(definition);
  const paths: string[] = [];
  const client = createClient(
    withEndpoint("https://example.test"),
    withInterceptors(
      createWebSocketInterceptor(async (request) => {
        paths.push(request.endpoint);
        throw new Error("Audit capture before constructing a socket");
      }),
    ),
  );
  expect((await client.execute(first()))[0]?.code).toBe(
    "EXT_INTERCEPTOR_FAILED",
  );
  expect((await client.execute(second()))[0]?.code).toBe(
    "EXT_INTERCEPTOR_FAILED",
  );
  expect(paths).toEqual(["/first", "/second"]);
});
