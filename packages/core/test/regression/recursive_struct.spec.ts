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
import { createFakeWebSocket, openSession } from "../fake_web_socket";
import { isRecord } from "../narrow";

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
      path: "/deep",
    });
    const ws = defineWebSocket({
      builder,
      input,
      incoming: Chain,
      path: "/deep",
    });
    const fake = createFakeWebSocket({ handshake: "manual" });
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
      withSSEHandle(handle),
      withWebSocketHandle(fake.Socket),
    );

    const results = [
      await http(client, cycle()),
      await sse(client, cycle()),
      await ws(client, cycle()),
    ];
    for (const [error, value] of results) {
      expect(error?.code).toBe("REQ_INPUT_INVALID");
      expect(error?.cause).toBeInstanceOf(StructError);
      expect(value).toBeUndefined();
    }
    expect(builder).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(fake.sockets).toHaveLength(0);
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
    const handle = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(handle),
    );

    const value: { child: unknown; id: string } = {
      child: null,
      id: "root",
    };
    value.child = value;
    expect(value.child).toBe(value);

    const [error] = await useRequest(client, value);
    expect(error).toBeNull();
    expect(handle).toHaveBeenCalledOnce();
  });

  test("reports an overdeep SSE event as a StructError and still yields the next valid event", async () => {
    const invalid: unknown[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withSSEHandle(() =>
        Promise.resolve(
          new Response(`data: ${deepJson}\n\ndata: {"child":null}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
      withSSEOnInvalidEvent((context) => {
        invalid.push({ cause: context.cause, reason: context.reason });
      }),
    );
    const useStream = defineEventStream({
      events: { message: Chain },
      maxBufferSize: 200_000,
      path: "/deep",
    });
    const [error, stream] = await useStream(client);
    expect(error).toBeNull();
    if (!stream) throw new Error("Expected stream");
    expect(await Array.fromAsync(stream)).toEqual([
      { data: { child: null }, event: "message", id: undefined },
    ]);
    expect(invalid).toHaveLength(1);
    const issue = invalid[0];
    if (!isRecord(issue)) throw new Error("Expected an invalid event");
    expect(issue["reason"]).toBe("validation-failed");
    expect(issue["cause"]).toBeInstanceOf(StructError);
    expect(Object.keys(issue).sort()).toEqual(["cause", "reason"]);
    expect(await stream.closed).toMatchObject({ kind: "eof" });
  });

  test("bounds WebSocket receive and send recursion without closing a healthy session", async () => {
    const fake = createFakeWebSocket({ handshake: "manual" });
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(fake.Socket),
    );
    const useSocket = defineWebSocket({
      incoming: Chain,
      outgoing: Chain,
      path: "/deep",
    });
    const { session, socket: socket } = await openSession(
      useSocket(client),
      fake,
    );
    try {
      const invalid = new Promise<unknown>((resolve) =>
        session.onRuntimeError(resolve),
      );
      socket.receive(deepJson);
      expect(await invalid).toBeInstanceOf(StructError);
      socket.receive('{"child":null}');
      expect(
        (await session.receive[Symbol.asyncIterator]().next()).value,
      ).toEqual({ child: null });
      expect(() => session.send(cycle())).toThrow(StructError);
      expect(socket.sent).toEqual([]);
      session.send({ child: null });
      expect(socket.sent).toEqual(['{"child":null}']);
    } finally {
      session.close();
      socket.peerClose(1000);
      await session.closed;
    }
  });
});
