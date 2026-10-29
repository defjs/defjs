import { describe, expect, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
  withSSEOnInvalidEvent,
  withWebSocketHandle,
} from "../../src/client";
import { defineRequest } from "../../src/http";
import { defineEventStream } from "../../src/sse";
import { StructError, struct, type StructLike } from "../../src/struct";
import { defineWebSocket } from "../../src/web_socket";
import {
  createControllableSocketClass,
  openControllableSocket,
} from "./controllable_socket";

const Chain = struct.object({
  get child(): StructLike {
    return Chain.null();
  },
});
const deepJson = '{"child":'.repeat(10_000) + "null" + "}".repeat(10_000);

function cycle(): { child: unknown } {
  const value: { child: unknown } = { child: null };
  value.child = value;
  return value;
}

describe("recursive structs at transport boundaries", () => {
  test("rejects cyclic HTTP, SSE and WebSocket startup inputs before the builder or transport", async () => {
    const builder = vi.fn(() => ({}));
    const input = Chain;
    const http = defineRequest({
      builder,
      input,
      method: "GET",
      path: "/deep",
    });
    const sse = defineEventStream({
      builder,
      input,
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: "/deep",
    });
    const ws = defineWebSocket({
      builder,
      input,
      incoming: Chain,
      maxIncomingQueueSize: 4,
      path: "/deep",
    });
    const { Socket, latest } = createControllableSocketClass();
    const handle = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
      withSSEHandle(handle),
      withWebSocketHandle(Socket as unknown as typeof WebSocket),
    );

    const results = [
      await client.execute(http(cycle())),
      await client.execute(sse(cycle())),
      await client.execute(ws(cycle())),
    ];
    for (const [error, value] of results) {
      expect(error?.code).toBe("REQ_INPUT_INVALID");
      expect(error?.cause).toBeInstanceOf(StructError);
      expect(value).toBeUndefined();
    }
    expect(builder).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(latest()).toBeUndefined();
  });

  test("does not revisit an unbounded union candidate while tagging a parsed intersection", async () => {
    const Recursive: StructLike = struct.object({
      get child(): StructLike {
        return struct.or(Recursive, struct.any());
      },
    });
    const input = struct.intersection(
      struct.or(Recursive, struct.any()),
      struct.object({ id: struct.string().optional() }),
    );
    const useRequest = defineRequest({
      builder: () => ({}),
      input,
      method: "GET",
      path: "/ignored-input",
    });
    const handle = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );

    const [error] = await client.execute(
      useRequest(Object.assign(cycle(), { id: "root" })),
    );
    expect(error).toBeNull();
    expect(handle).toHaveBeenCalledOnce();
  });

  test("reports an overdeep SSE event as a StructError and still yields the next valid event", async () => {
    const invalid: unknown[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(
        async () =>
          new Response(`data: ${deepJson}\n\ndata: {"child":null}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
      withSSEOnInvalidEvent((context) => {
        invalid.push({ cause: context.cause, reason: context.reason });
      }),
    );
    const useStream = defineEventStream({
      events: { message: Chain },
      maxBufferSize: 200_000,
      maxQueueSize: 4,
      path: "/deep",
    });
    const [error, stream] = await client.execute(useStream());
    expect(error).toBeNull();
    if (!stream) throw new Error("Expected stream");
    expect(await Array.fromAsync(stream)).toEqual([
      { data: { child: null }, event: "message", id: undefined },
    ]);
    expect(invalid).toEqual([
      { cause: expect.any(StructError), reason: "validation-failed" },
    ]);
    expect(await stream.closed).toMatchObject({ kind: "eof" });
  });

  test("bounds WebSocket receive and send recursion without closing a healthy session", async () => {
    const { Socket, latest } = createControllableSocketClass();
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(Socket as unknown as typeof WebSocket),
    );
    const useSocket = defineWebSocket({
      incoming: Chain,
      outgoing: Chain,
      maxIncomingQueueSize: 4,
      path: "/deep",
    });
    const [error, session] = await openControllableSocket(
      client.execute(useSocket()),
      latest,
    );
    expect(error).toBeNull();
    if (!session) throw new Error("Expected session");
    const socket = latest();
    if (!socket) throw new Error("Expected socket");
    try {
      const invalid = new Promise<unknown>((resolve) =>
        session.onRuntimeError(resolve),
      );
      socket.triggerMessage(deepJson);
      expect(await invalid).toBeInstanceOf(StructError);
      socket.triggerMessage('{"child":null}');
      expect(
        (await session.receive[Symbol.asyncIterator]().next()).value,
      ).toEqual({ child: null });
      expect(() => session.send(cycle())).toThrow(StructError);
      expect(socket.sent).toEqual([]);
      session.send({ child: null });
      expect(socket.sent).toEqual(['{"child":null}']);
    } finally {
      session.close();
      socket.triggerClose({ code: 1000, reason: "", wasClean: true });
      await session.closed;
    }
  });
});
