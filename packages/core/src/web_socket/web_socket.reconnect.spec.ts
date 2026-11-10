import { afterEach, beforeEach, describe, expect, inject, test } from "vitest";
import {
  createClient,
  type DerivableClient,
  withEndpoint,
  type Client,
} from "../client";
import { struct } from "../struct";
import { defineWebSocket, type SocketAwaitResult } from "./index";

describe("web socket runtime reconnect", () => {
  let client: DerivableClient;

  beforeEach(() => {
    client = createClient(withEndpoint(inject("testServerHost")));
  });

  afterEach(() => {
    // cleanup only
  });

  async function run(
    operation: (client: Client) => Promise<SocketAwaitResult<unknown, unknown>>,
    options?: Record<string, unknown>,
  ): Promise<SocketAwaitResult<unknown, unknown>> {
    return operation(client(options));
  }

  test("should reconnect and flush queued messages", async () => {
    const useReconnectSocket = defineWebSocket({
      builder: (input) => ({ query: input }),
      maxOutgoingQueueSize: 2,
      incoming: struct.discriminatedUnion("type", [
        struct.object({
          type: struct.literal("message"),
          text: struct.string(),
        }),
        struct.object({
          type: struct.literal("reconnected"),
          attempt: struct.number(),
        }),
      ]),
      input: struct.object({
        key: struct.string(),
      }),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/reconnect",
    });

    const states: string[] = [];

    const executePromise = run(
      (client) =>
        useReconnectSocket(client, {
          key: `queue-case-${crypto.randomUUID()}`,
        }),
      {
        retry: { maxRetries: 1, delayMs: 0 },
      },
    );

    const [error, socket] = await executePromise;

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }

    socket.onStateChange((state: string) => {
      states.push(state);
      if (state === "reconnecting") {
        socket.send({
          text: "after-reconnect",
          type: "message",
        });
      }
    });
    socket.send({ text: "seen-open", type: "message" });

    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { attempt: 2, type: "reconnected" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "after-reconnect", type: "message" },
    });

    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
    expect(states).toContain("reconnecting");
  });

  test("should pass actual reconnect attempt count to shouldRetry", async () => {
    const retryClient = createClient(withEndpoint("http://127.0.0.1:1"));

    const useRetrySocket = defineWebSocket({
      incoming: struct.unknown(),
      path: "/ws/reconnect",
    });

    const attempts: number[] = [];

    const [error, socket, connection] = await useRetrySocket(
      retryClient({
        retry: {
          maxRetries: 2,
          delayMs: 0,
          shouldRetry(context: { attempt: number }) {
            attempts.push(context.attempt);
            return context.attempt < 2;
          },
        },
      }),
    );

    expect(socket).toBeUndefined();
    expect(connection?.url).toBe("ws://127.0.0.1:1/ws/reconnect");
    expect(error?.code.startsWith("NET_")).toBe(true);
    expect(attempts).toEqual([1, 2]);
  });

  test("should not consider manual session close for reconnect", async () => {
    const useSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("ready"),
        ok: struct.boolean(),
      }),
      path: "/ws/echo",
    });

    const attempts: number[] = [];
    const [error, socket] = await run(useSocket, {
      retry: {
        maxRetries: 1,
        delayMs: 0,
        shouldRetry(context: { attempt: number }) {
          attempts.push(context.attempt);
          return false;
        },
      },
    });

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket");
    }

    socket.close(1000, "manual");

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      reason: "manual",
    });
    expect(attempts).toEqual([]);
  });
});
