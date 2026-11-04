import { expect, test } from "vitest";
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  defineEventStream,
  defineRequest,
  ERR_ABORTED,
  ERR_TIMEOUT,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
} from "../../src";

const request = defineRequest({ method: "GET", path: "/request" });
const events = defineEventStream({
  path: "/events",
  events: { message: struct.string() },
});

test.each(["abort", "timeout"] as const)(
  "HTTP %s cannot mark a sentinel for another client",
  async (mode) => {
    const entered = Promise.withResolvers<void>();
    const controller = new AbortController();
    const first = createClient(
      withEndpoint("https://first.example"),
      withHTTPHandle(async () => {
        entered.resolve();
        return new Promise<Response>(() => {});
      }),
    );
    const cause = mode === "abort" ? ERR_ABORTED : ERR_TIMEOUT;
    const second = createClient(
      withEndpoint("https://second.example"),
      withInterceptors(
        // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
        createSSEInterceptor(async () => {
          throw cause;
        }),
      ),
    );
    try {
      const pending = request(first({ signal: controller.signal }));
      await entered.promise;
      controller.abort(
        mode === "timeout"
          ? new DOMException("deadline", "TimeoutError")
          : undefined,
      );
      expect((await pending)[0]?.code).toBe(
        mode === "abort" ? "NET_ABORTED" : "NET_TIMEOUT",
      );
      const [fault, stream, open] = await events(second);
      expect(fault?.code).toBe("EXT_INTERCEPTOR_FAILED");
      expect(fault?.cause).toBe(cause);
      expect(stream).toBeUndefined();
      expect(open).toBeUndefined();
    } finally {
      controller.abort();
    }
  },
);

test.each(["http", "sse"] as const)(
  "a reused cause retains its %s execution origin only",
  async (transport) => {
    const cause = new Error("shared handle and interceptor cause");
    let transportFailure = true;
    const seen: unknown[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
      withHTTPHandle(async () => {
        throw cause;
      }),
      // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
      withSSEHandle(async () => {
        throw cause;
      }),
      withInterceptors(
        createHttpInterceptor(async (req, next) => {
          if (!transportFailure) throw cause;
          try {
            return await next(req);
          } catch (error) {
            seen.push(error);
            throw error;
          }
        }),
        createSSEInterceptor(async (req, next) => {
          if (!transportFailure) throw cause;
          try {
            return await next(req);
          } catch (error) {
            seen.push(error);
            throw error;
          }
        }),
      ),
    );
    const first =
      transport === "http" ? await request(client) : await events(client);
    expect(first[0]?.code).toBe("NET_UNREACHABLE");
    expect(seen).toEqual([cause]);
    transportFailure = false;
    const second =
      transport === "http" ? await request(client) : await events(client);
    expect(second[0]?.code).toBe("EXT_INTERCEPTOR_FAILED");
    expect(second[0]?.cause).toBe(cause);
  },
);

test.each(["abort", "timeout"] as const)(
  "SSE %s cannot leak open info into another client startup",
  async (mode) => {
    const controller = new AbortController();
    const cause = mode === "abort" ? ERR_ABORTED : ERR_TIMEOUT;
    const first = createClient(
      withEndpoint("https://first.example"),
      withSSEHandle(() =>
        Promise.resolve(
          new Response(new ReadableStream<Uint8Array>(), {
            headers: {
              "content-type": "text/event-stream",
              "x-tenant": "first",
            },
          }),
        ),
      ),
    );
    try {
      const [fault, stream, open] = await events(
        first({ signal: controller.signal }),
      );
      expect(fault).toBeNull();
      expect(open?.response.headers.get("x-tenant")).toBe("first");
      controller.abort(
        mode === "timeout"
          ? new DOMException("deadline", "TimeoutError")
          : undefined,
      );
      await expect(stream?.closed).resolves.toMatchObject(
        mode === "timeout"
          ? { code: "NET_TIMEOUT", kind: "error" }
          : { kind: "aborted" },
      );
      await stream?.[Symbol.asyncDispose]();
      const second = createClient(
        withEndpoint("https://second.example"),
        // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
        withSSEHandle(async () => {
          throw cause;
        }),
      );
      const [nextFault, nextStream, nextOpen] = await events(second);
      expect(nextFault?.code).toBe(
        mode === "abort" ? "NET_ABORTED" : "NET_TIMEOUT",
      );
      expect(nextFault?.cause).toBe(cause);
      expect(nextStream).toBeUndefined();
      expect(nextOpen).toBeUndefined();
      const started = Promise.withResolvers<void>();
      const stalledController = new AbortController();
      const stalled = createClient(
        withEndpoint("https://third.example"),
        withSSEHandle(async () => {
          started.resolve();
          return new Promise<Response>(() => undefined);
        }),
      );
      const pending = events(stalled({ signal: stalledController.signal }));
      await started.promise;
      stalledController.abort(new DOMException("deadline", "TimeoutError"));
      const [timeoutFault, , timeoutOpen] = await pending;
      expect(timeoutFault?.code).toBe("NET_TIMEOUT");
      expect(timeoutOpen).toBeUndefined();
    } finally {
      controller.abort();
    }
  },
);

test("a cancelled 401 handshake cannot classify a later sentinel as HTTP_STATUS", async () => {
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const rejected = Promise.withResolvers<unknown>();
  const first = createClient(
    withEndpoint("https://first.example"),
    withSSEHandle(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                entered.resolve();
              },
            },
            { highWaterMark: 0 },
          ),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
              "x-tenant": "first",
            },
          },
        ),
      ),
    ),
    withInterceptors(
      createSSEInterceptor(async (req, next) => {
        try {
          return await next(req);
        } catch (cause) {
          rejected.resolve(cause);
          throw cause;
        }
      }),
    ),
  );
  const declared = defineEventStream({
    path: "/events",
    error: struct.object({ message: struct.string() }),
    events: { message: struct.string() },
  });
  const pending = declared(first({ signal: controller.signal }));
  await entered.promise;
  await Promise.resolve();
  controller.abort();
  await pending;
  expect(await rejected.promise).toBe(ERR_ABORTED);
  const second = createClient(
    withEndpoint("https://second.example"),
    // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
    withSSEHandle(async () => {
      throw ERR_ABORTED;
    }),
  );
  const [fault, , open] = await events(second);
  expect(fault?.code).toBe("NET_ABORTED");
  expect(open).toBeUndefined();
});
