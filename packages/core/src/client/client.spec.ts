import { beforeEach, describe, expect, test, vi } from "vitest";
import { defineRequest } from "../http";
import { defineEventStream } from "../sse";
import { createHttpInterceptor } from "../interceptor";
import { struct } from "../struct";
import { CLIENT, createClient } from "./client";
import {
  withCredentials,
  withEndpoint,
  withHeaders,
  withHTTPHandle,
  withInterceptors,
  withQuerySerializer,
  withRetry,
  withSSEHandle,
  withSSEOnInvalidEvent,
  withWebSocketBeforeConnect,
  withWebSocketHandle,
  withWebSocketHeartbeat,
  withWebSocketProtocols,
} from "./index";
import type { Client } from "./client";
import type { ClientConfig, FetchHandle } from "./config";
import { createFakeWebSocket } from "../../test/fake_web_socket";

describe("Client", () => {
  let baseClient: Client;

  beforeEach(() => {
    baseClient = createClient(withEndpoint("https://example.com/v1"));
  });

  test("withHeaders apply to an HTTP operation", async () => {
    const seen: { headers: Headers }[] = [];
    const client = createClient(
      withEndpoint("https://example.com"),
      withHeaders({ "X-Tenant": "acme", "X-Override": "default" }),
      withHTTPHandle((input, init) => {
        const request = new Request(input, init);
        seen.push({ headers: new Headers(request.headers) });
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );

    const usePing = defineRequest({
      builder: (input) => ({ headers: { "X-Override": input.override } }),
      method: "GET",
      path: "/ping",
      input: struct.object({ override: struct.string() }),
      output: struct.object({ ok: struct.boolean() }),
    });

    const [headerError] = await usePing(client, { override: "command" });
    expect(headerError).toBeNull();
    expect(seen[0]?.headers.get("X-Tenant")).toBe("acme");
    expect(seen[0]?.headers.get("X-Override")).toBe("command");
  });

  test.each<{
    transport: string;
    withHandle: (handle: FetchHandle) => (config: ClientConfig) => void;
    answer: () => Response;
    open: (client: Client) => Promise<{
      fault: { code: string } | null;
      stream: { close(): void; closed: Promise<unknown> } | undefined;
    }>;
    scope: string;
  }>([
    {
      transport: "HTTP",
      withHandle: withHTTPHandle,
      answer: () => new Response(null, { status: 204 }),
      open: async (client) => {
        const [fault] = await defineRequest({
          builder: () => ({
            headers: [
              ["X-Scope", "first"],
              ["x-scope", "second"],
            ],
          }),
          method: "GET",
          path: "/headers",
        })(client);
        return { fault, stream: undefined };
      },
      // Two pair entries are combined by Headers.
      scope: "first, second",
    },
    {
      transport: "SSE",
      withHandle: withSSEHandle,
      answer: () =>
        new Response(": done\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      open: async (client) => {
        const [fault, stream] = await defineEventStream({
          builder: () => ({ headers: { "x-scope": ["first", "second"] } }),
          events: { message: struct.unknown() },
          path: "/headers",
        })(client);
        return { fault, stream };
      },
      // A record array is one value that JavaScript joins with a comma.
      scope: "first,second",
    },
  ])(
    "$transport array command headers override defaults at the fetch boundary",
    async ({ withHandle, answer, open, scope }) => {
      let sent: Headers | undefined;
      const defaults = { "X-Scope": "default", "X-Keep": "keep" };
      const client = createClient(
        withEndpoint("https://example.test"),
        withHeaders(defaults),
        withHandle((input, init) => {
          sent = new Request(input, init).headers;
          return Promise.resolve(answer());
        }),
      );

      const { fault, stream } = await open(client);
      stream?.close();
      await stream?.closed;

      expect(fault).toBeNull();
      expect(sent?.get("x-scope")).toBe(scope);
      expect(sent?.get("x-keep")).toBe("keep");
      expect(defaults["X-Scope"]).toBe("default");
    },
  );

  test.each(["HTTP", "SSE"] as const)(
    "%s reports REQ_BUILD_FAILED when Headers rejects an array header entry",
    async (transport) => {
      const handle = vi.fn<FetchHandle>(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );
      const client = createClient(
        withEndpoint("https://example.test"),
        withHTTPHandle(handle),
        withSSEHandle(handle),
      );

      const [fault] =
        transport === "HTTP"
          ? await defineRequest({
              // @ts-expect-error A one-item entry is not a [name, value] pair.
              builder: () => ({ headers: [["x-missing"]] }),
              method: "GET",
              path: "/headers",
            })(client)
          : await defineEventStream({
              // @ts-expect-error A one-item entry is not a [name, value] pair.
              builder: () => ({ headers: [["x-missing"]] }),
              events: { message: struct.unknown() },
              path: "/headers",
            })(client);

      expect(fault?.code).toBe("REQ_BUILD_FAILED");
      expect(fault?.cause).toBeInstanceOf(TypeError);
      expect(handle).not.toHaveBeenCalled();
    },
  );

  test.each(["HTTP", "SSE"] as const)(
    "%s reports REQ_BUILD_FAILED when Headers rejects a record header value",
    async (transport) => {
      const handle = vi.fn<FetchHandle>(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );
      const client = createClient(
        withEndpoint("https://example.test"),
        withHTTPHandle(handle),
        withSSEHandle(handle),
      );

      const [fault] =
        transport === "HTTP"
          ? await defineRequest({
              builder: () => ({ headers: { "x-line": "line\nbreak" } }),
              method: "GET",
              path: "/headers",
            })(client)
          : await defineEventStream({
              builder: () => ({ headers: { "x-line": "line\nbreak" } }),
              events: { message: struct.unknown() },
              path: "/headers",
            })(client);

      expect(fault?.code).toBe("REQ_BUILD_FAILED");
      expect(fault?.cause).toBeInstanceOf(TypeError);
      expect(handle).not.toHaveBeenCalled();
    },
  );

  test("withEndpoint is used for the operation URL", async () => {
    const seen: string[] = [];
    const client = createClient(
      withEndpoint("https://original.example"),
      withHTTPHandle((input) => {
        seen.push(input instanceof Request ? input.url : String(input));
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
        );
      }),
    );

    const usePing = defineRequest({
      method: "GET",
      output: struct.object({ ok: struct.boolean() }),
      path: "/ping",
    });
    const [error] = await usePing(client);

    expect(error).toBeNull();
    expect(seen).toEqual(["https://original.example/ping"]);
  });

  test("HTTP handle, credentials, interceptors, and serializer apply when an operation runs", async () => {
    const customFetch = vi.fn<FetchHandle>((input, init) => {
      const request = new Request(input, init);
      expect(request.credentials).toBe("include");
      expect(new URL(request.url).search).toBe("?serialized=zen");
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    });
    const interceptor = createHttpInterceptor(async (request, next) =>
      next(request),
    );
    const serializer = (query: { [key: string]: unknown }) =>
      `serialized=${String(query["q"])}`;

    const client = createClient(
      withEndpoint("https://api.example.com"),
      withCredentials(true),
      withHTTPHandle(customFetch),
      withSSEHandle(customFetch),
      withInterceptors(interceptor),
      withQuerySerializer(serializer),
    );

    const request = defineRequest({
      builder: (input) => ({ query: { q: input.q } }),
      method: "POST",
      path: "/items",
      input: struct.object({ q: struct.string() }),
      output: struct.object({ ok: struct.boolean() }),
    });
    const [error, data] = await request(client, { q: "zen" });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(customFetch).toHaveBeenCalledOnce();
  });

  test("per-field SSE and WebSocket helpers are accepted by createClient", () => {
    const onInvalidEvent = vi.fn();
    const beforeConnect = vi.fn();
    const client = createClient(
      withEndpoint("https://example.com"),
      withSSEOnInvalidEvent(onInvalidEvent),
      withRetry({ maxRetries: 3, delayMs: 1_000 }),
      withWebSocketHandle(createFakeWebSocket().Socket),
      withWebSocketBeforeConnect(beforeConnect),
      withWebSocketProtocols(["json"]),
      withWebSocketHeartbeat({
        intervalMs: 1_000,
        message: () => "ping",
        isAck: () => true,
        timeoutMs: 5_000,
      }),
    );

    expect(typeof client).toBe("function");
    expect(typeof client()).toBe("object");
    expect(client()[CLIENT]).toBeDefined();
  });

  test("unused base client is constructable", () => {
    expect(typeof baseClient).toBe("function");
  });
});
