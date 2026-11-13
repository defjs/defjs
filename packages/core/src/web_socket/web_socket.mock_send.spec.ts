import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint } from "../client";
import { ERR_ABORTED } from "../error";
import { struct } from "../struct";
import { defineWebSocket } from "./index";
import { openSession, stubFakeWebSocket } from "../../test/fake_web_socket";
import {
  useFakeClock,
  createDeferred,
  run,
} from "../../test/web_socket_support";

describe("web socket send with a mock handle", () => {
  test("should not send on the captured open socket when outgoing serialization aborts the session", async () => {
    const fake = stubFakeWebSocket();
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        signal: controller.signal,
      }),
      fake,
    );
    const nativeSocket = fake.last();
    const message = {
      get text() {
        controller.abort(ERR_ABORTED);
        return "late";
      },
      type: "message" as const,
    };

    expect(() => socket.send(message)).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.sendCalls).toHaveLength(0);
  });

  test("should reject sends while manual close is pending before serializing or enqueueing", async () => {
    useFakeClock();
    stubFakeWebSocket();
    const useSocket = defineWebSocket({
      maxOutgoingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const pending = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
    );
    await vi.advanceTimersByTimeAsync(0);
    const [, socket] = await pending;
    if (!socket) {
      throw new Error("Expected socket");
    }

    socket.close(1000, "done");
    expect(() => socket.send({ text: "late", type: "message" })).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
    await vi.advanceTimersByTimeAsync(30);
    await socket.closed;
  });

  test("should reject sends after remote close before its reconnect predicate settles", async () => {
    const fake = stubFakeWebSocket();
    const useSocket = defineWebSocket({
      maxOutgoingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 0, shouldRetry: () => false },
      }),
      fake,
    );

    fake.last().peerClose(1012, "restart");
    expect(() => socket.send({ text: "late", type: "message" })).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
  });

  test("should flush a reconnect frame before an open observer can send", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      maxOutgoingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 30 },
      }),
      fake,
    );
    let queued = false;
    let overflowChecked = false;
    socket.onStateChange((state) => {
      if (state === "reconnecting" && !queued) {
        queued = true;
        socket.send({ text: "queued first", type: "message" });
        expect(() =>
          socket.send({ text: "queue overflow", type: "message" }),
        ).toThrow("WebSocket send queue overflow");
        overflowChecked = true;
      }
      if (state === "open" && socket.connection.generation === 2) {
        socket.send({ text: "observer second", type: "message" });
      }
    });

    fake.last().peerClose(1012, "restart");
    // Let the retry decision schedule its delay, then pass it: 30 ms plus at most 20% jitter.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(fake.sockets).toHaveLength(2);
    fake.last().open();
    expect(socket.connection.generation).toBe(2);
    const replacement = fake.last();
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }

    expect(queued).toBe(true);
    expect(overflowChecked).toBe(true);
    expect(replacement.sent[0]).toBe(
      JSON.stringify({ type: "message", text: "queued first" }),
    );
    expect(replacement.sent[1]).toBe(
      JSON.stringify({ type: "message", text: "observer second" }),
    );
    await Promise.resolve();
    expect(replacement.sent).toHaveLength(2);
    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await vi.advanceTimersByTimeAsync(0);
    await socket.closed;
  });

  test("should reject an undefined JSON message before it enters the reconnect queue", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      maxOutgoingQueueSize: 2,
      incoming: struct.unknown(),
      outgoing: struct.string().optional(),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 30 },
      }),
      fake,
    );

    let sendError: unknown;
    socket.onStateChange((state) => {
      if (state === "reconnecting" && sendError === undefined) {
        try {
          socket.send(undefined);
        } catch (error) {
          sendError = error;
        }
      }
    });

    fake.last().peerClose(1012, "restart");
    // Let the retry decision schedule its delay, then pass it: 30 ms plus at most 20% jitter.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(fake.sockets).toHaveLength(2);
    fake.last().open();
    expect(socket.connection.generation).toBe(2);
    const replacement = fake.last();
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }

    expect(sendError).toEqual(
      new TypeError("Outgoing WebSocket message has no JSON representation"),
    );
    expect(replacement.sendCalls).toHaveLength(0);
    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await vi.advanceTimersByTimeAsync(0);
    await socket.closed;
  });

  test.each([
    [
      "non-finite number",
      struct.number(),
      Number.POSITIVE_INFINITY,
      "is not JSON data: Infinity",
    ],
    ["NaN", struct.any(), Number.NaN, "is not JSON data: NaN"],
    ["Map", struct.any(), new Map([["k", 1]]), "is not JSON data: Map"],
    ["Set", struct.any(), new Set([1]), "is not JSON data: Set"],
    ["function", struct.any(), () => 1, "is not JSON data: function"],
    ["symbol", struct.any(), Symbol("wire"), "is not JSON data: symbol"],
    [
      "class instance",
      struct.any(),
      new (class Payload {})(),
      "is not JSON data: Payload",
    ],
  ])(
    "should reject a %s send before the text frame is written",
    async (_label, outgoing, message, fragment) => {
      const fake = stubFakeWebSocket();
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        outgoing,
        path: "/ws/test",
      });
      const { session: socket } = await openSession(
        run(createClient(withEndpoint("http://localhost")), useSocket),
        fake,
      );

      expect(() => socket.send(message)).toThrow(TypeError);
      expect(() => socket.send(message)).toThrow(fragment);
      expect(fake.last().sendCalls).toHaveLength(0);

      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should reject a non-JSON message before it enters the reconnect queue", async () => {
    useFakeClock();
    const fake = stubFakeWebSocket({ handshake: "manual" });
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      maxOutgoingQueueSize: 2,
      outgoing: struct.object({ n: struct.number() }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 30 },
      }),
      fake,
    );

    let sendError: unknown;
    socket.onStateChange((state) => {
      if (state === "reconnecting" && sendError === undefined) {
        try {
          socket.send({ n: Number.NEGATIVE_INFINITY });
        } catch (error) {
          sendError = error;
        }
      }
    });

    fake.last().peerClose(1012, "restart");
    // Let the retry decision schedule its delay, then pass it: 30 ms plus at most 20% jitter.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(fake.sockets).toHaveLength(2);
    fake.last().open();
    expect(socket.connection.generation).toBe(2);
    const replacement = fake.last();
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }

    expect(sendError).toBeInstanceOf(TypeError);
    if (!(sendError instanceof TypeError)) {
      throw new Error("expected a TypeError");
    }
    expect(sendError.message).toContain(
      'Outgoing WebSocket message field "n" is not JSON data: -Infinity',
    );
    expect(replacement.sendCalls).toHaveLength(0);
    socket.close(1000, "done");
    fake.last().peerClose(1000, "done");
    await vi.advanceTimersByTimeAsync(0);
    await socket.closed;
  });

  test("should not enqueue a reconnect frame when outgoing serialization aborts the session", async () => {
    const fake = stubFakeWebSocket();
    const controller = new AbortController();
    const reconnecting = createDeferred<void>();
    const useSocket = defineWebSocket({
      maxOutgoingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        retry: { maxRetries: 1, delayMs: 1_000 },
        signal: controller.signal,
      }),
      fake,
    );
    socket.onStateChange((state) => {
      if (state === "reconnecting") {
        reconnecting.resolve(undefined);
      }
    });

    fake.last().peerClose(1012, "restart");
    await reconnecting.promise;
    const message = {
      get text() {
        controller.abort(ERR_ABORTED);
        return "late";
      },
      type: "message" as const,
    };

    expect(() => socket.send(message)).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    expect(socket.state).toBe("aborted");
    expect(fake.sockets).toHaveLength(1);
    expect(fake.sockets[0]?.sendCalls).toHaveLength(0);
  });

  test("should disable outgoing buffering by default during reconnect preparation", async () => {
    const fake = stubFakeWebSocket();
    const attempts: number[] = [];
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const { session: socket } = await openSession(
      run(createClient(withEndpoint("http://localhost")), useSocket, {
        beforeConnect({ attempt }: { attempt: number }) {
          attempts.push(attempt);
          if (attempt === 1) {
            return new Promise<void>(() => undefined);
          }
        },
        retry: { maxRetries: 1, delayMs: 0 },
      }),
      fake,
    );

    fake.last().peerClose(1012, "restart");
    await vi.waitFor(() => expect(attempts).toEqual([0, 1]));

    expect(socket.state).toBe("reconnecting");
    expect(() =>
      socket.send({ text: "not buffered", type: "message" }),
    ).toThrow("WebSocket outgoing queue is disabled");
    expect(socket.state).toBe("reconnecting");

    socket.close(1000, "owner stopped reconnect");
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner stopped reconnect",
    });
    expect(fake.sockets).toHaveLength(1);
  });
});
