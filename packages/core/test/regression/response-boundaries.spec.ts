import { expect, test, vi } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  defineEventStream,
  defineRequest,
  makeResponse,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
} from "../../src";

const jsonHeaders = { "content-type": "application/json" };
const JsonError = struct.object({ reason: struct.string() });
const eventOptions = {
  path: "/events",
  events: { message: struct.string() },
  maxBufferSize: 1024,
  maxQueueSize: 4,
};

function rawBody(kind: string, text: string): unknown {
  const bytes = new TextEncoder().encode(text);
  if (kind === "blob") return new Blob([bytes], { type: "application/json" });
  if (kind === "arrayBuffer") return bytes.buffer;
  if (kind === "view") {
    const padded = new Uint8Array(bytes.length + 2);
    padded.set(bytes, 1);
    return new DataView(padded.buffer, 1, bytes.length);
  }
  return bytes;
}

test.each([200, 403])(
  "makeResponse preserves parsed and raw JSON string roots on status %s",
  async (status) => {
    for (const kind of ["parsed", "bytes", "arrayBuffer", "view", "blob"]) {
      const body = kind === "parsed" ? "123" : rawBody(kind, '"123"');
      const client = createClient(
        withEndpoint("https://example.test"),
        withInterceptors(
          createHttpInterceptor(async () =>
            makeResponse({ status, headers: new Headers(jsonHeaders), body }),
          ),
        ),
      );
      const endpoint = defineRequest({
        method: "GET",
        path: "/synthetic",
        output: struct.unknown(),
        error: struct.unknown(),
      });
      const [fault, data] = await client.execute(endpoint());
      expect({ kind, code: fault?.code ?? null }).toEqual({
        kind,
        code: status === 200 ? null : "HTTP_STATUS",
      });
      expect({
        kind,
        data: fault?.code === "HTTP_STATUS" ? fault.data : data,
      }).toEqual({ kind, data: "123" });
    }
  },
);

test.each([200, 403])(
  "malformed synthetic JSON retains representation-failure classification on status %s",
  async (status) => {
    const codes: unknown[] = [];
    for (const kind of ["bytes", "arrayBuffer", "view", "blob"]) {
      const client = createClient(
        withEndpoint("https://example.test"),
        withInterceptors(
          createHttpInterceptor(async () =>
            makeResponse({
              status,
              headers: new Headers(jsonHeaders),
              body: rawBody(kind, "{"),
            }),
          ),
        ),
      );
      const endpoint = defineRequest({
        method: "GET",
        path: "/synthetic",
        output: JsonError,
        error: JsonError,
      });
      const [fault] = await client.execute(endpoint());
      codes.push({ kind, code: fault?.code, status: fault?.response?.status });
    }
    expect(codes).toEqual(
      ["bytes", "arrayBuffer", "view", "blob"].map((kind) => ({
        kind,
        code: "RES_DECODE_FAILED",
        status,
      })),
    );
  },
);

test.each([200, 403])(
  "synthetic JSON responses enforce the declared media type on status %s",
  async (status) => {
    const observed: { code: string | null; message: string | undefined }[] = [];
    const cases = [
      {
        body: { reason: "denied" },
        headers: new Headers({ "content-type": "text/plain" }),
      },
      {
        body: new TextEncoder().encode('{"reason":"denied"}'),
        headers: new Headers({ "content-type": "text/plain" }),
      },
      { body: { reason: "denied" }, headers: new Headers() },
    ];
    for (const { body, headers } of cases) {
      const client = createClient(
        withEndpoint("https://example.test"),
        withInterceptors(
          createHttpInterceptor(async () =>
            makeResponse({ status, headers, body }),
          ),
        ),
      );
      const endpoint = defineRequest({
        method: "GET",
        path: "/synthetic",
        output: JsonError,
        error: JsonError,
      });
      const [fault] = await client.execute(endpoint());
      observed.push({
        code: fault?.code ?? null,
        message:
          fault?.cause instanceof Error ? fault.cause.message : undefined,
      });
    }
    expect(observed).toEqual([
      {
        code: "RES_MEDIA_TYPE_INVALID",
        message: "Expected a JSON media type, received text/plain",
      },
      {
        code: "RES_MEDIA_TYPE_INVALID",
        message: "Expected a JSON media type, received text/plain",
      },
      {
        code: "RES_MEDIA_TYPE_INVALID",
        message: "Expected a JSON media type, received <none>",
      },
    ]);
  },
);

test("native malformed JSON and wrong media provide response classification controls", async () => {
  for (const [text, contentType, expected] of [
    ["{", "application/json", "RES_DECODE_FAILED"],
    ['{"reason":"denied"}', "text/plain", "RES_MEDIA_TYPE_INVALID"],
  ]) {
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(
        async () =>
          new Response(text, {
            headers: { "content-type": String(contentType) },
          }),
      ),
    );
    const endpoint = defineRequest({
      method: "GET",
      path: "/native",
      output: JsonError,
    });
    const [fault] = await client.execute(endpoint());
    expect(fault?.code).toBe(expected);
  }
});

test.each(["abort", "timeout"])(
  "synthetic HTTP Blob decoding remains cancellable by %s",
  async (mode) => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<string>();
    class SlowBlob extends Blob {
      override text(): Promise<string> {
        started.resolve();
        return release.promise;
      }
    }
    const controller = new AbortController();
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            status: 200,
            headers: new Headers(jsonHeaders),
            body: new SlowBlob(),
          }),
        ),
      ),
    );
    const endpoint = defineRequest({
      method: "GET",
      path: "/slow-blob",
      output: struct.unknown(),
    });
    let settled = false;
    const pending = client
      .execute(endpoint(), {
        signal: controller.signal,
        ...(mode === "timeout" ? { timeout: 100 } : {}),
      })
      .then((result) => {
        settled = true;
        return result;
      });
    try {
      await started.promise;
      if (mode === "abort") controller.abort("cancel decode");
      await vi.advanceTimersByTimeAsync(101);
      expect(settled).toBe(true);
      const [fault] = await pending;
      expect(fault?.code).toBe(
        mode === "abort" ? "NET_ABORTED" : "NET_TIMEOUT",
      );
    } finally {
      controller.abort("cleanup");
      release.resolve('"done"');
      await pending;
      vi.useRealTimers();
    }
  },
);

test.each([200, 403])(
  "an absent declared HTTP body follows the representation on status %s",
  async (status) => {
    const cases = [
      {
        body: null as BodyInit | null,
        output: JsonError,
        error: JsonError,
        code: "RES_DECODE_FAILED",
        data: undefined,
      },
      {
        body: null,
        output: struct.null(),
        error: struct.null(),
        code: "RES_DECODE_FAILED",
        data: undefined,
      },
      {
        body: "null",
        output: struct.null(),
        error: struct.null(),
        code: status === 200 ? null : "HTTP_STATUS",
        data: null,
      },
      {
        body: null,
        output: struct.string(),
        error: struct.string(),
        code: status === 200 ? null : "HTTP_STATUS",
        data: "",
      },
      {
        body: "",
        output: struct.string(),
        error: struct.string(),
        code: status === 200 ? null : "HTTP_STATUS",
        data: "",
      },
    ];
    for (const item of cases) {
      const client = createClient(
        withEndpoint("https://example.test"),
        withHTTPHandle(
          async () => new Response(item.body, { status, headers: jsonHeaders }),
        ),
      );
      const endpoint = defineRequest({
        method: "GET",
        path: "/absent",
        output: item.output,
        error: item.error,
      });
      const [fault, data] = await client.execute(endpoint());
      expect({
        body: item.body,
        code: fault?.code ?? null,
        status: fault?.response?.status,
      }).toEqual({
        body: item.body,
        code: item.code,
        status: item.code === null ? undefined : status,
      });
      expect({
        body: item.body,
        data: fault?.code === "HTTP_STATUS" ? fault.data : data,
      }).toEqual({ body: item.body, data: item.data });
    }
  },
);

test.each([200, 403])(
  "an absent synthetic HTTP body uses the same representation rule on status %s",
  async (status) => {
    const client = createClient(
      withEndpoint("https://example.test"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({ status, headers: new Headers(jsonHeaders) }),
        ),
      ),
    );
    const endpoint = defineRequest({
      method: "GET",
      path: "/absent-synthetic",
      output: JsonError,
      error: JsonError,
    });
    const [fault] = await client.execute(endpoint());
    expect(fault?.code).toBe("RES_DECODE_FAILED");
    expect(fault?.response?.status).toBe(status);
  },
);

test("a bodiless declared string SSE error decodes to an empty string", async () => {
  for (const body of [null, ""]) {
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(
        async () =>
          new Response(body, {
            status: 403,
            headers: { "content-type": "text/plain" },
          }),
      ),
    );
    const endpoint = defineEventStream({
      ...eventOptions,
      error: struct.string(),
    });
    const [fault, stream] = await client.execute(endpoint());
    expect({ body, code: fault?.code, stream }).toEqual({
      body,
      code: "HTTP_STATUS",
      stream: undefined,
    });
    expect(fault?.code === "HTTP_STATUS" ? fault.data : undefined).toBe("");
    expect(fault?.response?.status).toBe(403);
  }
});

test("a bodiless SSE response cannot return typed HTTP_STATUS with missing data", async () => {
  const client = createClient(
    withEndpoint("https://example.test"),
    withSSEHandle(
      async () => new Response(null, { status: 403, headers: jsonHeaders }),
    ),
  );
  const endpoint = defineEventStream({ ...eventOptions, error: JsonError });
  const [fault, stream] = await client.execute(endpoint());
  const unsafeRead = () =>
    fault?.code === "HTTP_STATUS" ? fault.data.reason : undefined;
  expect(unsafeRead).not.toThrow();
  expect(fault?.code).toBe("RES_DECODE_FAILED");
  expect(fault?.response?.status).toBe(403);
  expect(stream).toBeUndefined();
});

test.each(["json", "text", "blob", "arrayBuffer"] as const)(
  "SSE %s handshake readers cancel and release locks on abort and timeout",
  async (kind) => {
    for (const mode of ["abort", "timeout"]) {
      vi.useFakeTimers();
      const started = Promise.withResolvers<void>();
      const cancelled = Promise.withResolvers<void>();
      const cancel = vi.fn(() => cancelled.resolve());
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            started.resolve();
            return new Promise<void>(() => undefined);
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const errors = {
        json: JsonError,
        text: struct.string(),
        blob: struct.blob(),
        arrayBuffer: struct.arrayBuffer(),
      };
      const client = createClient(
        withEndpoint("https://example.test"),
        withSSEHandle(
          async () => new Response(body, { status: 403, headers: jsonHeaders }),
        ),
      );
      const endpoint = defineEventStream({
        ...eventOptions,
        error: errors[kind],
      });
      const controller = new AbortController();
      const pending = client.execute(endpoint(), {
        signal: controller.signal,
        ...(mode === "timeout" ? { timeout: 100 } : {}),
      });
      try {
        await started.promise;
        if (mode === "abort") controller.abort("round7");
        else await vi.advanceTimersByTimeAsync(101);
        const [fault, stream] = await pending;
        await cancelled.promise;
        await vi.advanceTimersByTimeAsync(0);
        expect(fault?.code).toBe(
          mode === "abort" ? "NET_ABORTED" : "NET_TIMEOUT",
        );
        expect(stream).toBeUndefined();
        expect(cancel).toHaveBeenCalledOnce();
        expect(body.locked).toBe(false);
      } finally {
        controller.abort("cleanup");
        await pending;
        vi.useRealTimers();
      }
    }
  },
);
