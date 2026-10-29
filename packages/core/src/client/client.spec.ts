import { beforeEach, describe, expect, test, vi } from "vitest";
import { defineRequest } from "../http";
import { defineEventStream } from "../sse";
import { createHttpInterceptor } from "../interceptor";
import { struct } from "../struct";
import { createClient } from "./client";
import {
  withCredentials,
  withEndpoint,
  withHeaders,
  withHTTPHandle,
  withInterceptors,
  withQuerySerializer,
  withSSEHandle,
  withSSEOnInvalidEvent,
  withSSEReconnect,
  withTimeout,
  withWebSocketBeforeConnect,
  withWebSocketHandle,
  withWebSocketHeartbeat,
  withWebSocketProtocols,
  withWebSocketReconnect,
  withXSRF,
} from "./index";
import type { Client } from "./client";

describe("Client", () => {
  let baseClient: Client;

  beforeEach(() => {
    baseClient = createClient(withEndpoint("https://example.com/v1"));
  });

  test("withHeaders and withTimeout apply to HTTP execute", async () => {
    const seen: { headers: Headers; timedOut: boolean }[] = [];
    const client = createClient(
      withEndpoint("https://example.com"),
      withHeaders({ "X-Tenant": "acme", "X-Override": "default" }),
      withTimeout(30),
      withHTTPHandle(async (input, init) => {
        const request = new Request(input, init);
        seen.push({ headers: new Headers(request.headers), timedOut: false });
        await new Promise((resolve) => setTimeout(resolve, 200));
        return Response.json({ ok: true });
      }),
    );

    const usePing = defineRequest({
      builder: (input) => ({ headers: { "X-Override": input.override } }),
      method: "GET",
      path: "/ping",
      input: struct.object({ override: struct.string() }),
      output: struct.object({ ok: struct.boolean() }),
    });

    const [headerError] = await client.execute(
      usePing({ override: "command" }),
      { timeout: 5_000 },
    );
    expect(headerError).toBeNull();
    expect(seen[0]?.headers.get("X-Tenant")).toBe("acme");
    expect(seen[0]?.headers.get("X-Override")).toBe("command");

    const [timeoutError] = await client.execute(
      usePing({ override: "command" }),
    );
    expect(timeoutError?.code).toBe("NET_TIMEOUT");
  });

  test.each(["HTTP", "SSE"] as const)(
    "%s array command headers override defaults at the fetch boundary",
    async (transport) => {
      let sent: Headers | undefined;
      const defaults = { "X-Scope": "default", "X-Keep": "keep" };
      const client = createClient(
        withEndpoint("https://example.test"),
        withHeaders(defaults),
        (transport === "HTTP" ? withHTTPHandle : withSSEHandle)(
          async (input, init) => {
            sent = new Request(input, init).headers;
            return transport === "HTTP"
              ? new Response(null, { status: 204 })
              : new Response(": done\n\n", {
                  headers: { "content-type": "text/event-stream" },
                });
          },
        ),
      );
      const pending =
        transport === "HTTP"
          ? client.execute(
              defineRequest({
                builder: () => ({
                  headers: [
                    ["X-Scope", "first"],
                    ["x-scope", "second"],
                  ],
                }),
                method: "GET",
                path: "/headers",
              })(),
            )
          : client.execute(
              defineEventStream({
                builder: () => ({
                  headers: { "x-scope": ["first", "second"] },
                }),
                events: { message: struct.unknown() },
                maxBufferSize: 1024,
                maxQueueSize: 1,
                path: "/headers",
              })(),
            );

      const [fault, stream] = await pending;
      stream?.close();
      await stream?.closed;

      expect(fault).toBeNull();
      expect(sent?.get("x-scope")).toBe("first, second");
      expect(sent?.get("x-keep")).toBe("keep");
      expect(defaults["X-Scope"]).toBe("default");
    },
  );

  test("withTimeout rejects invalid zero", () => {
    expect(() => withTimeout(0)).toThrow(RangeError);
  });

  test("withEndpoint is used for execute URL", async () => {
    const seen: string[] = [];
    const client = createClient(
      withEndpoint("https://original.example"),
      withHTTPHandle(async (input) => {
        seen.push(input instanceof Request ? input.url : String(input));
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }),
    );

    const usePing = defineRequest({
      method: "GET",
      output: struct.object({ ok: struct.boolean() }),
      path: "/ping",
    });
    const [error] = await client.execute(usePing());

    expect(error).toBeNull();
    expect(seen).toEqual(["https://original.example/ping"]);
  });

  test("HTTP handle, credentials, interceptors, serializer, and xsrf apply on execute", async () => {
    const customFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.headers.get("x-custom-xsrf-token")).toBe("xsrf-token");
        expect(request.credentials).toBe("include");
        expect(new URL(request.url).search).toBe("?serialized=zen");
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
    ) as unknown as typeof fetch;
    const interceptor = createHttpInterceptor(async (request, next) =>
      next(request),
    );
    const serializer = (query: { [key: string]: unknown }) =>
      `serialized=${String(query["q"])}`;
    const tokenProvider = vi.fn(() => "xsrf-token");

    const client = createClient(
      withEndpoint("https://api.example.com"),
      withCredentials(true),
      withHTTPHandle(customFetch),
      withSSEHandle(customFetch),
      withInterceptors(interceptor),
      withQuerySerializer(serializer),
      withXSRF({
        cookieName: "CUSTOM-XSRF-TOKEN",
        headerName: "X-CUSTOM-XSRF-TOKEN",
        tokenProvider,
      }),
    );

    const request = defineRequest({
      builder: (input) => ({ query: { q: input.q } }),
      method: "POST",
      path: "/items",
      input: struct.object({ q: struct.string() }),
      output: struct.object({ ok: struct.boolean() }),
    });
    const [error, data] = await client.execute(request({ q: "zen" }));
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(customFetch).toHaveBeenCalledOnce();
    expect(tokenProvider).toHaveBeenCalled();
  });

  test("per-field SSE and WebSocket helpers are accepted by createClient", () => {
    const onInvalidEvent = vi.fn();
    const beforeConnect = vi.fn();
    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
    }

    const client = createClient(
      withEndpoint("https://example.com"),
      withSSEOnInvalidEvent(onInvalidEvent),
      withSSEReconnect({ attempts: 5, delayMs: 500 }),
      withWebSocketHandle(MockWebSocket as unknown as typeof WebSocket),
      withWebSocketBeforeConnect(beforeConnect),
      withWebSocketProtocols(["json"]),
      withWebSocketHeartbeat({ intervalMs: 1_000, timeoutMs: 5_000 }),
      withWebSocketReconnect({ attempts: 3, delayMs: 1_000 }),
    );

    expect(client.execute).toEqual(expect.any(Function));
  });

  test("unused base client is constructable", () => {
    expect(baseClient.execute).toEqual(expect.any(Function));
  });
});
