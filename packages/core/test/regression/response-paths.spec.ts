import { expect, test, vi } from "vitest";
import {
  createClient,
  defineEventStream,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
} from "../../src";

const jsonHeaders = { "content-type": "application/json" };

test.each([200, 403])(
  "preserves a JSON root string under an unknown declaration on HTTP %s",
  async (status) => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(
        async () =>
          new Response(JSON.stringify("123"), { status, headers: jsonHeaders }),
      ),
    );
    const endpoint = defineRequest({
      method: "GET",
      path: "/root-string",
      output: struct.unknown(),
      error: struct.unknown(),
    });

    const [fault, data] = await client.execute(endpoint());

    expect(fault?.code ?? null).toBe(status === 200 ? null : "HTTP_STATUS");
    expect(fault?.code === "HTTP_STATUS" ? fault.data : data).toBe("123");
  },
);

test.each([200, 403])(
  "accepts a JSON root string literal on HTTP %s",
  async (status) => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(
        async () =>
          new Response(JSON.stringify("ready"), {
            status,
            headers: jsonHeaders,
          }),
      ),
    );
    const endpoint = defineRequest({
      method: "GET",
      path: "/literal",
      output: struct.literal("ready"),
      error: struct.literal("ready"),
    });

    const [fault, data] = await client.execute(endpoint());

    expect(fault?.code ?? null).toBe(status === 200 ? null : "HTTP_STATUS");
    expect(fault?.code === "HTTP_STATUS" ? fault.data : data).toBe("ready");
  },
);

test.each([200, 403])(
  "rejects a JSON string masquerading as an object on HTTP %s",
  async (status) => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(
        async () =>
          new Response(JSON.stringify('{"role":"admin"}'), {
            status,
            headers: jsonHeaders,
          }),
      ),
    );
    const payload = struct.object({ role: struct.string() });
    const endpoint = defineRequest({
      method: "GET",
      path: "/object",
      output: payload,
      error: payload,
    });

    const [fault, data] = await client.execute(endpoint());

    expect(fault?.code).toBe("RES_STRUCT_MISMATCH");
    expect(data).toBeUndefined();
  },
);

test("preserves a decoded null SSE handshake error body", async () => {
  const client = createClient(
    withEndpoint("https://example.test"),
    withSSEHandle(
      async () => new Response("null", { status: 403, headers: jsonHeaders }),
    ),
  );
  const endpoint = defineEventStream({
    path: "/events",
    events: { message: struct.string() },
    error: struct.null(),
    maxBufferSize: 1024,
    maxQueueSize: 4,
  });

  const [fault] = await client.execute(endpoint());

  expect(fault?.code).toBe("HTTP_STATUS");
  if (fault?.code !== "HTTP_STATUS") throw new Error("Expected HTTP_STATUS");
  expect(fault.data).toBeNull();
  expect(fault.response).toHaveProperty("body", null);
});

test("reports an unreadable declared SSE handshake body as a decode fault", async () => {
  const client = createClient(
    withEndpoint("https://example.test"),
    withSSEHandle(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("incomplete handshake body"));
        },
      });
      return new Response(body, { status: 403, headers: jsonHeaders });
    }),
  );
  const endpoint = defineEventStream({
    path: "/events",
    events: { message: struct.string() },
    error: struct.object({ code: struct.string() }),
    maxBufferSize: 1024,
    maxQueueSize: 4,
  });

  const [fault, stream] = await client.execute(endpoint());

  // The published handshake contract requires RES_DECODE_FAILED. HTTP_STATUS with
  // undefined data also violates the public contract for the declared error struct.
  expect(fault?.code).toBe("RES_DECODE_FAILED");
  expect(fault?.response?.status).toBe(403);
  expect(stream).toBeUndefined();
});

test("cancels an in-progress declared SSE handshake body when the caller aborts", async () => {
  const readStarted = Promise.withResolvers<void>();
  const cancel = vi.fn();
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        source = controller;
      },
      pull() {
        readStarted.resolve();
        return new Promise<void>(() => undefined);
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const client = createClient(
    withEndpoint("https://example.test"),
    withSSEHandle(
      async () => new Response(body, { status: 403, headers: jsonHeaders }),
    ),
  );
  const endpoint = defineEventStream({
    path: "/events",
    events: { message: struct.string() },
    error: struct.object({ code: struct.string() }),
    maxBufferSize: 1024,
    maxQueueSize: 4,
  });
  const controller = new AbortController();
  const pending = client.execute(endpoint(), { signal: controller.signal });

  try {
    await readStarted.promise;
    controller.abort("caller stopped");
    const [fault, stream] = await pending;
    expect(fault?.code).toBe("NET_ABORTED");
    expect(stream).toBeUndefined();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce(), {
      timeout: 500,
    });
  } finally {
    // Release the stalled read only after measuring transport cancellation.
    controller.abort("test cleanup");
    source?.error(new Error("test cleanup"));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});
