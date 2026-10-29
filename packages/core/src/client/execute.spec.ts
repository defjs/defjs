import { describe, expect, inject, test } from "vitest";
import { makeResponse } from "../internal/http_response";
import { createHttpInterceptor } from "../interceptor";
import { struct } from "../struct";
import { defineRequest } from "../http";
import { defineEventStream } from "../sse";
import { defineWebSocket } from "../web_socket";
import { createClient } from "./client";
import { withEndpoint, withInterceptors } from "./option";

describe("Client.execute", () => {
  test("client should have execute method", () => {
    const client = createClient(withEndpoint("https://example.com"));
    expect(typeof client.execute).toBe("function");
  });

  test("execute rejects for unsupported command kind", async () => {
    const client = createClient(withEndpoint("https://example.com"));
    await expect(client.execute({ kind: "test" } as never)).rejects.toThrow(
      "Unsupported command",
    );
  });

  test("client.execute dispatches http command", async () => {
    const useGet = defineRequest({
      method: "GET",
      output: struct.object({ ok: struct.boolean() }),
      path: "/ok",
    });

    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: { ok: true },
            headers: new Headers({ "content-type": "application/json" }),
            status: 200,
          }),
        ),
      ),
    );

    const [error, result] = await client.execute(useGet());

    expect(error).toBeNull();
    expect(result).toEqual({ ok: true });
  });

  test("client.execute dispatches event-stream command", async () => {
    const useBasicSse = defineEventStream({
      maxBufferSize: 1024,
      maxQueueSize: 16,
      events: {
        message: struct.string(),
      },
      path: "/sse/basic",
    });

    const client = createClient(withEndpoint(inject("testServerHost")));

    const [error, stream, open] = await client.execute(useBasicSse());

    expect(error).toBeNull();
    if (!stream || !open) {
      throw new Error("Expected stream");
    }

    expect(open.url).toContain("/sse/basic");

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: "first", event: "message", id: "1" },
    });

    stream.close();
    await expect(stream.closed).resolves.toBeDefined();
  });

  test("client.execute dispatches web-socket command", async () => {
    const useChatSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({
        type: struct.literal("joined"),
        roomId: struct.string(),
        userId: struct.number(),
      }),
      path: "/ws/basic",
    });

    const client = createClient(withEndpoint(inject("testServerHost")));

    const [error, socket, connection] = await client.execute(useChatSocket());

    expect(error).toBeNull();
    if (!socket || !connection) {
      throw new Error("Expected socket");
    }

    expect(connection.url).toContain("/ws/basic");

    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { roomId: "default", type: "joined", userId: 1 },
    });

    await expect(socket.closed).resolves.toBeDefined();
  });
});
