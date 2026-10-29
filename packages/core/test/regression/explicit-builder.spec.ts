import { expect, test } from "vitest";
import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
  withWebSocketHandle,
  type WebSocketHandleConstructor,
} from "../../src";

const Input = struct
  .object({ query: struct.object({ token: struct.string() }) })
  .optional();

// @ts-expect-error Declared input requires an explicit builder; a field named `query` does not imply placement.
const http = defineRequest({ method: "GET", path: "/resource", input: Input });
// @ts-expect-error Optional input still requires an explicit builder.
const sse = defineEventStream({
  path: "/events",
  input: Input,
  events: {},
  maxBufferSize: 1024,
  maxQueueSize: 4,
});
// @ts-expect-error A WebSocket input field named `query` must not be implicitly placed in the URL.
const socket = defineWebSocket({
  path: "/socket",
  input: Input,
  incoming: struct.string(),
  maxIncomingQueueSize: 4,
});

test.each([true, false])(
  "missing builders fail before dispatch when an input value is present: %s",
  async (present) => {
    let dispatches = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(async () => {
        dispatches += 1;
        return new Response(null, { status: 204 });
      }),
      withSSEHandle(async () => {
        dispatches += 1;
        return new Response("", {
          headers: { "content-type": "text/event-stream" },
        });
      }),
      withWebSocketHandle(
        class {
          constructor() {
            dispatches += 1;
            throw new Error("Unexpected WebSocket dispatch");
          }
        } as unknown as WebSocketHandleConstructor,
      ),
    );
    const value = present
      ? { query: { token: "must-not-be-sent" } }
      : undefined;
    const results = await Promise.all([
      client.execute(http(value)),
      client.execute(sse(value)),
      client.execute(socket(value)),
    ]);

    try {
      expect(results.map(([fault]) => fault?.code)).toEqual([
        "REQ_BUILD_FAILED",
        "REQ_BUILD_FAILED",
        "REQ_BUILD_FAILED",
      ]);
      expect(dispatches).toBe(0);
      for (const [, data, metadata] of results) {
        expect(data).toBeUndefined();
        expect(metadata).toBeUndefined();
      }
    } finally {
      results[1][1]?.close();
      await results[1][1]?.closed;
      results[2][1]?.close();
      await results[2][1]?.closed;
    }
  },
);

test("input field names never imply placement; the builder alone decides", async () => {
  const endpoint = defineRequest({
    method: "POST",
    path: "/resource",
    input: Input,
    builder: (input) => ({ body: { token: input?.query.token ?? "default" } }),
  });
  const sent: { body: unknown; url: string }[] = [];
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async (input, init) => {
      const request = new Request(input, init);
      sent.push({ body: await request.json(), url: request.url });
      return new Response(null, { status: 204 });
    }),
  );

  expect(
    (await client.execute(endpoint({ query: { token: "body-only" } })))[0],
  ).toBeNull();
  expect((await client.execute(endpoint()))[0]).toBeNull();
  expect(sent).toEqual([
    { body: { token: "body-only" }, url: "https://example.test/resource" },
    { body: { token: "default" }, url: "https://example.test/resource" },
  ]);
});
