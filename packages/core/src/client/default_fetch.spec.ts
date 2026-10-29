import { afterEach, describe, expect, test, vi } from "vitest";

// The transform of the whole graph must not be charged to the first test.
await import("../index");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("request-time default fetch", () => {
  test.each(["HTTP", "SSE"] as const)(
    "should honor a replacement after import for %s clients created before and after it",
    async (transport) => {
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response("before", { headers: { "content-type": "text/plain" } }),
      );
      vi.resetModules();
      const {
        createClient,
        defineRequest,
        defineEventStream,
        struct,
        withEndpoint,
      } = await import("../index");
      const clients = [createClient(withEndpoint("https://example.com"))];
      const receivers: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        function (this: unknown, input: RequestInfo | URL) {
          receivers.push(this);
          expect(input).toBeInstanceOf(Request);
          return Promise.resolve(
            transport === "HTTP"
              ? new Response("after", {
                  headers: { "content-type": "text/plain" },
                })
              : new Response("data: after\n\n", {
                  headers: { "content-type": "text/event-stream" },
                }),
          );
        },
      );
      clients.push(createClient(withEndpoint("https://example.com")));

      for (const client of clients) {
        if (transport === "HTTP") {
          const endpoint = defineRequest({
            method: "GET",
            output: struct.string(),
            path: "/",
          });
          const [fault, data] = await client.execute(endpoint());
          expect(fault).toBeNull();
          expect(data).toBe("after");
        } else {
          const endpoint = defineEventStream({
            events: { message: struct.string() },
            maxBufferSize: 1024,
            maxQueueSize: 16,
            path: "/",
          });
          const [fault, stream] = await client.execute(endpoint());
          expect(fault).toBeNull();
          expect(await stream?.[Symbol.asyncIterator]().next()).toEqual({
            done: false,
            value: { data: "after", event: "message", id: undefined },
          });
          stream?.close();
          await stream?.closed;
        }
      }
      expect(receivers).toEqual([globalThis, globalThis]);
    },
  );

  test.each(["HTTP", "SSE"] as const)(
    "should import without fetch and report ENV_UNSUPPORTED on the first %s call",
    async (transport) => {
      vi.stubGlobal("fetch", undefined);
      vi.resetModules();
      const {
        createClient,
        defineRequest,
        defineEventStream,
        struct,
        withEndpoint,
      } = await import("../index");
      expect(struct.parse(struct.string(), "available")).toEqual([
        null,
        "available",
      ]);
      const client = createClient(withEndpoint("https://example.com"));
      const [fault, result, response] =
        transport === "HTTP"
          ? await client.execute(defineRequest({ method: "GET", path: "/" })())
          : await client.execute(
              defineEventStream({
                events: { message: struct.string() },
                maxBufferSize: 1024,
                maxQueueSize: 16,
                path: "/",
              })(),
            );

      expect(fault?.code).toBe("ENV_UNSUPPORTED");
      expect(result).toBeUndefined();
      expect(response).toBeUndefined();
    },
  );

  test.each(["HTTP", "SSE"] as const)(
    "should report ENV_UNSUPPORTED if fetch disappears after import before %s execution",
    async (transport) => {
      vi.resetModules();
      const {
        createClient,
        defineRequest,
        defineEventStream,
        struct,
        withEndpoint,
      } = await import("../index");
      const client = createClient(withEndpoint("https://example.com"));
      vi.stubGlobal("fetch", undefined);
      const [fault] =
        transport === "HTTP"
          ? await client.execute(defineRequest({ method: "GET", path: "/" })())
          : await client.execute(
              defineEventStream({
                events: { message: struct.string() },
                maxBufferSize: 1024,
                maxQueueSize: 16,
                path: "/",
              })(),
            );

      expect(fault?.code).toBe("ENV_UNSUPPORTED");
    },
  );

  test("should use fetch installed after importing without it", async () => {
    vi.stubGlobal("fetch", undefined);
    vi.resetModules();
    const { createClient, defineRequest, struct, withEndpoint } =
      await import("../index");
    const client = createClient(withEndpoint("https://example.com"));
    vi.stubGlobal("fetch", async () => new Response("installed"));
    const [fault, data] = await client.execute(
      defineRequest({ method: "GET", output: struct.string(), path: "/" })(),
    );

    expect(fault).toBeNull();
    expect(data).toBe("installed");
  });

  test("should allow custom HTTP and SSE handles without global fetch", async () => {
    vi.stubGlobal("fetch", undefined);
    vi.resetModules();
    const {
      createClient,
      defineRequest,
      defineEventStream,
      struct,
      withEndpoint,
      withHTTPHandle,
      withSSEHandle,
    } = await import("../index");
    const client = createClient(
      withEndpoint("https://example.com"),
      withHTTPHandle(async () => new Response(null, { status: 204 })),
      withSSEHandle(
        async () =>
          new Response("data: custom\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );
    expect(
      (await client.execute(defineRequest({ method: "GET", path: "/" })()))[0],
    ).toBeNull();
    const [fault, stream] = await client.execute(
      defineEventStream({
        events: { message: struct.string() },
        maxBufferSize: 1024,
        maxQueueSize: 16,
        path: "/",
      })(),
    );
    expect(fault).toBeNull();
    expect(await stream?.[Symbol.asyncIterator]().next()).toEqual({
      done: false,
      value: { data: "custom", event: "message", id: undefined },
    });
    stream?.close();
    await stream?.closed;
  });

  test.each(["HTTP", "SSE"] as const)(
    "should allow a %s interceptor to short-circuit without global fetch",
    async (transport) => {
      vi.stubGlobal("fetch", undefined);
      vi.resetModules();
      const {
        createClient,
        createHttpInterceptor,
        createSSEInterceptor,
        defineRequest,
        defineEventStream,
        makeResponse,
        struct,
        withEndpoint,
        withInterceptors,
      } = await import("../index");
      const { fetchEventStream } =
        await import("../sse/transport/event_stream");
      const client = createClient(
        withEndpoint("https://example.com"),
        withInterceptors(
          createHttpInterceptor(async () =>
            makeResponse({ body: "cached", status: 200 }),
          ),
          createSSEInterceptor((request) =>
            fetchEventStream(request, {
              fetch: async () =>
                new Response("data: cached\n\n", {
                  headers: { "content-type": "text/event-stream" },
                }),
              maxBufferSize: 1024,
              maxQueueSize: 16,
            }),
          ),
        ),
      );
      if (transport === "HTTP") {
        const [fault, data] = await client.execute(
          defineRequest({
            method: "GET",
            output: struct.string(),
            path: "/",
          })(),
        );
        expect(fault).toBeNull();
        expect(data).toBe("cached");
      } else {
        const [fault, stream] = await client.execute(
          defineEventStream({
            events: { message: struct.string() },
            maxBufferSize: 1024,
            maxQueueSize: 16,
            path: "/",
          })(),
        );
        expect(fault).toBeNull();
        expect(await stream?.[Symbol.asyncIterator]().next()).toMatchObject({
          done: false,
          value: { data: "cached" },
        });
        stream?.close();
        await stream?.closed;
      }
    },
  );

  test.each(["HTTP", "SSE"] as const)(
    "should keep a missing-fetch error thrown by a %s interceptor in EXT",
    async (transport) => {
      vi.stubGlobal("fetch", undefined);
      vi.resetModules();
      const {
        createClient,
        createHttpInterceptor,
        createSSEInterceptor,
        defineRequest,
        defineEventStream,
        struct,
        withEndpoint,
        withInterceptors,
      } = await import("../index");
      const { ERR_FETCH_UNSUPPORTED } = await import("./config");
      const run = (client: ReturnType<typeof createClient>) =>
        transport === "HTTP"
          ? client.execute(defineRequest({ method: "GET", path: "/" })())
          : client.execute(
              defineEventStream({
                events: { message: struct.string() },
                maxBufferSize: 1024,
                maxQueueSize: 16,
                path: "/",
              })(),
            );
      expect(
        (await run(createClient(withEndpoint("https://example.com"))))[0]?.code,
      ).toBe("ENV_UNSUPPORTED");
      const client = createClient(
        withEndpoint("https://example.com"),
        withInterceptors(
          createHttpInterceptor(() => {
            throw ERR_FETCH_UNSUPPORTED;
          }),
          createSSEInterceptor(() => {
            throw ERR_FETCH_UNSUPPORTED;
          }),
        ),
      );
      expect((await run(client))[0]?.code).toBe("EXT_INTERCEPTOR_FAILED");
    },
  );
});
