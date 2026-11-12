import { describe, expect, test, vi } from "vitest";
import { createClient, withEndpoint } from "../client";
import { ERR_ABORTED } from "../error";
import { struct } from "../struct";
import { defineWebSocket } from "./index";
import {
  useFakeClock,
  lastMockInstance,
  mockInstances,
  createMockWebSocketClass,
  createDeferred,
  run,
} from "../../test/mock_web_socket";

describe("web socket send with a mock handle", () => {
  test("should not send on the captured open socket when outgoing serialization aborts the session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      { signal: controller.signal },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
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
    expect(nativeSocket.send).not.toHaveBeenCalled();
  });

  test("should reject sends while manual close is pending before serializing or enqueueing", async () => {
    useFakeClock();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeEventDelayMs: 30 }),
    );
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
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxOutgoingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        retry: { maxRetries: 1, delayMs: 0, shouldRetry: () => false },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
    expect(() => socket.send({ text: "late", type: "message" })).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
  });

  test("should flush a reconnect frame before an open observer can send", async () => {
    useFakeClock();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
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
      {
        retry: { maxRetries: 1, delayMs: 30 },
      },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await pending;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
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

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
    // Let the retry decision schedule its delay, then pass it: 30 ms plus at most 20% jitter.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(mockInstances).toHaveLength(2);
    lastMockInstance?.triggerOpen();
    expect(socket.connection.generation).toBe(2);
    const replacement = lastMockInstance;
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }

    expect(queued).toBe(true);
    expect(overflowChecked).toBe(true);
    expect(replacement.send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ type: "message", text: "queued first" }),
    );
    expect(replacement.send).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({ type: "message", text: "observer second" }),
    );
    await Promise.resolve();
    expect(replacement.send).toHaveBeenCalledTimes(2);
    socket.close(1000, "done");
    await vi.advanceTimersByTimeAsync(0);
    await socket.closed;
  });

  test("should reject an undefined JSON message before it enters the reconnect queue", async () => {
    useFakeClock();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      maxOutgoingQueueSize: 2,
      incoming: struct.unknown(),
      outgoing: struct.string().optional(),
      path: "/ws/test",
    });
    const pending = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        retry: { maxRetries: 1, delayMs: 30 },
      },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await pending;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

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

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
    // Let the retry decision schedule its delay, then pass it: 30 ms plus at most 20% jitter.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(mockInstances).toHaveLength(2);
    lastMockInstance?.triggerOpen();
    expect(socket.connection.generation).toBe(2);
    const replacement = lastMockInstance;
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }

    expect(sendError).toEqual(
      new TypeError("Outgoing WebSocket message has no JSON representation"),
    );
    expect(replacement.send).not.toHaveBeenCalled();
    socket.close(1000, "done");
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
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const useSocket = defineWebSocket({
        incoming: struct.unknown(),
        outgoing,
        path: "/ws/test",
      });
      const [, socket] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket,
      );
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }

      expect(() => socket.send(message)).toThrow(TypeError);
      expect(() => socket.send(message)).toThrow(fragment);
      expect(lastMockInstance.send).not.toHaveBeenCalled();

      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should reject a non-JSON message before it enters the reconnect queue", async () => {
    useFakeClock();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      maxOutgoingQueueSize: 2,
      outgoing: struct.object({ n: struct.number() }),
      path: "/ws/test",
    });
    const pending = run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        retry: { maxRetries: 1, delayMs: 30 },
      },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await pending;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

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

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
    // Let the retry decision schedule its delay, then pass it: 30 ms plus at most 20% jitter.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(mockInstances).toHaveLength(2);
    lastMockInstance?.triggerOpen();
    expect(socket.connection.generation).toBe(2);
    const replacement = lastMockInstance;
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
    expect(replacement.send).not.toHaveBeenCalled();
    socket.close(1000, "done");
    await vi.advanceTimersByTimeAsync(0);
    await socket.closed;
  });

  test("should not enqueue a reconnect frame when outgoing serialization aborts the session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
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
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        retry: { maxRetries: 1, delayMs: 1_000 },
        signal: controller.signal,
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    socket.onStateChange((state) => {
      if (state === "reconnecting") {
        reconnecting.resolve(undefined);
      }
    });

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
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
    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0]?.send).not.toHaveBeenCalled();
  });

  test("should disable outgoing buffering by default during reconnect preparation", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const attempts: number[] = [];
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket,
      {
        beforeConnect({ attempt }: { attempt: number }) {
          attempts.push(attempt);
          if (attempt === 1) {
            return new Promise<void>(() => undefined);
          }
        },
        retry: { maxRetries: 1, delayMs: 0 },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
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
    expect(mockInstances).toHaveLength(1);
  });
});
