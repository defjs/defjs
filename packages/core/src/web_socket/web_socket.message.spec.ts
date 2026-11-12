import { beforeEach, describe, expect, inject, test, vi } from "vitest";
import {
  createClient,
  type DerivableClient,
  withEndpoint,
  withWebSocketHandle,
  type Client,
} from "../client";
import { StructError, struct } from "../struct";
import {
  serializeOutgoingWebSocketMessage,
  decodeWebSocketMessage,
} from "./codec";
import { createFakeWebSocket, openSession } from "../../test/fake_web_socket";
import { defineWebSocket, type SocketAwaitResult } from "./index";
import { useFakeClock } from "../../test/web_socket_support";

const ChatIncoming = struct.discriminatedUnion("type", [
  struct.object({
    roomId: struct.string(),
    type: struct.literal("joined"),
    userId: struct.number(),
  }),
  struct.object({
    text: struct.string().alias("message_text"),
    type: struct.literal("message"),
    userId: struct.number(),
  }),
]);

const ChatOutgoing = struct.object({
  text: struct.string().alias("message_text"),
  type: struct.literal("message"),
});

const HeartbeatIncoming = struct.object({
  ok: struct.boolean(),
  type: struct.literal("pong"),
});

const HeartbeatOutgoing = struct.object({
  at: struct.number().alias("sent_at"),
  type: struct.literal("ping"),
});

const BasicIncoming = struct.discriminatedUnion("type", [
  struct.object({
    roomId: struct.string(),
    type: struct.literal("joined"),
    userId: struct.number(),
  }),
  struct.object({
    text: struct.string(),
    type: struct.literal("message"),
    userId: struct.number(),
  }),
]);

describe("web socket single struct messages", () => {
  let client: DerivableClient;

  beforeEach(() => {
    client = createClient(withEndpoint(inject("testServerHost")));
  });

  async function run(
    operation: (client: Client) => Promise<SocketAwaitResult<unknown, unknown>>,
    options?: Record<string, unknown>,
  ): Promise<SocketAwaitResult<unknown, unknown>> {
    return operation(client(options));
  }

  test("decodes a discriminated incoming frame as the struct value", () => {
    const decoded = decodeWebSocketMessage(
      ChatIncoming,
      JSON.stringify({ message_text: "hi", type: "message", userId: 7 }),
    );

    expect(decoded).toEqual({ text: "hi", type: "message", userId: 7 });
  });

  test("delivers discriminated incoming frames from the socket as decoded values", async () => {
    const useChat = defineWebSocket({
      incoming: BasicIncoming,
      path: "/ws/basic",
    });

    const [error, socket] = await run(useChat);
    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }

    const messages: unknown[] = [];
    for await (const message of socket.receive) {
      messages.push(message);
    }

    expect(messages).toEqual([
      { roomId: "default", type: "joined", userId: 1 },
      { text: "welcome:default", type: "message", userId: 1 },
    ]);
  });

  test("reports an incoming assertion failure to the runtime error listener without closing the session", async () => {
    const useSocket = defineWebSocket({
      incoming: struct.object({
        text: struct.string(),
        type: struct.literal("message"),
      }),
      path: "/ws/error-before-close",
    });
    const [error, socket] = await run(useSocket);
    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }

    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError);
    });
    const messages: unknown[] = [];
    for await (const message of socket.receive) {
      messages.push(message);
    }

    expect(messages).toEqual([]);
    expect(runtimeErrors).toHaveLength(1);
    expect(runtimeErrors[0]).toBeInstanceOf(StructError);
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
  });

  test("encodes an outgoing struct with aliases before JSON.stringify", () => {
    const wire = serializeOutgoingWebSocketMessage(ChatOutgoing, {
      text: "hello",
      type: "message",
    });

    expect(JSON.parse(wire)).toEqual({
      message_text: "hello",
      type: "message",
    });
  });

  test("echoes an alias-encoded outgoing frame and decodes it back", async () => {
    const useEcho = defineWebSocket({
      incoming: struct.discriminatedUnion("type", [
        struct.object({
          ok: struct.boolean(),
          type: struct.literal("ready"),
        }),
        struct.object({
          text: struct.string().alias("message_text"),
          type: struct.literal("message"),
        }),
      ]),
      outgoing: ChatOutgoing,
      path: "/ws/echo",
    });
    const [error, socket] = await run(useEcho);
    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }

    const iterator = socket.receive[Symbol.asyncIterator]();
    await iterator.next();
    socket.send({ text: "hello", type: "message" });

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "hello", type: "message" },
    });
    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
    });
  });

  test("sends a heartbeat through the outgoing struct and classifies the decoded ack", async () => {
    useFakeClock();
    const fake = createFakeWebSocket({ handshake: "manual" });
    const useHeartbeat = defineWebSocket({
      incoming: HeartbeatIncoming,
      outgoing: HeartbeatOutgoing,
      path: "/ws/heartbeat",
    });
    const acks: Array<{ ok: boolean; type: "pong" }> = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(fake.Socket),
    );
    const pending = useHeartbeat(
      client({
        heartbeat: {
          intervalMs: 10,
          isAck(message: unknown) {
            if (
              typeof message === "object" &&
              message !== null &&
              "type" in message &&
              message.type === "pong" &&
              "ok" in message &&
              message.ok === true
            ) {
              acks.push({ ok: true, type: "pong" });
              return true;
            }
            return false;
          },
          message: () => ({ at: 1, type: "ping" as const }),
          timeoutMs: 1_000,
        },
      }),
    );
    const { session: socket, socket: native } = await openSession(
      pending,
      fake,
    );

    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError);
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(native.sentText(0))).toEqual({
      sent_at: 1,
      type: "ping",
    });
    native.receive('{"ok":true,"type":"pong"}');
    await vi.advanceTimersByTimeAsync(0);
    expect(acks).toEqual([{ ok: true, type: "pong" }]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(runtimeErrors).toEqual([]);
    expect(socket.state).toBe("open");
    const iterator = socket.receive[Symbol.asyncIterator]();
    socket.close(1000, "heartbeat-ok");
    native.peerClose(1000, "heartbeat-ok");
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "heartbeat-ok",
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  test("sends a nullable object field as JSON null", async () => {
    const fake = createFakeWebSocket({ handshake: "manual" });
    const profile = struct.object({
      name: struct.string().alias("display_name"),
    });
    const endpoint = defineWebSocket({
      incoming: struct.string(),
      outgoing: struct.object({ profile: profile.nullable() }),
      path: "/socket",
    });
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(fake.Socket),
    );
    const { session: session, socket: native } = await openSession(
      endpoint(client),
      fake,
    );

    session.send({ profile: null });
    expect(native.sent).toEqual(['{"profile":null}']);
    session.close(1000, "done");
    native.peerClose(1000, "done");
    await session.closed;
  });

  test("send rejects non-JSON fields with advice that applies to WebSocket messages", async () => {
    const fake = createFakeWebSocket({ handshake: "manual" });
    const endpoint = defineWebSocket({
      incoming: struct.string(),
      outgoing: struct.object({ n: struct.number() }),
      path: "/socket",
    });
    const client = createClient(
      withEndpoint("https://example.test"),
      withWebSocketHandle(fake.Socket),
    );
    const { session: session, socket: native } = await openSession(
      endpoint(client),
      fake,
    );

    try {
      expect(() => session.send({ n: Infinity })).toThrow(
        new TypeError(
          'Outgoing WebSocket message field "n" is not JSON data: Infinity. Send JSON data.',
        ),
      );
      expect(native.sent).toEqual([]);
    } finally {
      session.close(1000, "done");
      native.peerClose(1000, "done");
      await session.closed;
    }
  });
});
