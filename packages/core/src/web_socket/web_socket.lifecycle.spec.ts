import { afterEach, beforeEach, describe, expect, inject, test } from "vitest";
import {
  createClient,
  withEndpoint,
  withQuerySerializer,
  type Client,
} from "../client";
import { struct } from "../struct";
import { defineWebSocket, type SocketAwaitResult } from "./index";

describe("web socket runtime lifecycle", () => {
  let client: Client;

  beforeEach(() => {
    client = createClient(withEndpoint(inject("testServerHost")));
  });

  afterEach(() => {
    // cleanup only
  });

  async function run(
    command: unknown,
    options?: unknown,
  ): Promise<SocketAwaitResult<unknown, unknown>> {
    return client.execute(command as never, options as never) as Promise<
      SocketAwaitResult<unknown, unknown>
    >;
  }

  test("should allow closing websocket before startup", async () => {
    const useEchoSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({
        type: struct.literal("ready"),
        ok: struct.boolean(),
      }),
      path: "/ws/echo",
    });

    const controller = new AbortController();
    const executePromise = run(useEchoSocket(), { signal: controller.signal });
    controller.abort();

    const [error, socket, connection] = await executePromise;

    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(error?.code.startsWith("NET_")).toBe(true);

    if (!error?.code.startsWith("NET_")) {
      throw new Error("Expected transport error");
    }

    expect(error.code).toBe("NET_ABORTED");
  });

  test("should skip unexpected websocket messages after startup", async () => {
    const useInvalidSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({
        type: struct.literal("message"),
        count: struct.number(),
      }),
      path: "/ws/invalid",
    });

    const [error, socket] = await run(useInvalidSocket());

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }

    const messages: unknown[] = [];
    for await (const message of socket.receive) {
      messages.push(message);
    }

    expect(messages).toEqual([]);
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should use request-level beforeConnect hook and client query serializer", async () => {
    const clientWithSerializer = createClient(
      withEndpoint(inject("testServerHost")),
      withQuerySerializer((query) => {
        return `token=${String(query["token"])}&from=serializer`;
      }),
    );

    const useBeforeConnectSocket = defineWebSocket({
      builder: (input) => ({ query: input }),
      maxIncomingQueueSize: 16,
      input: struct.object({ token: struct.string() }),
      incoming: struct.object({
        type: struct.literal("connected"),
        token: struct.string(),
      }),
      path: "/ws/before-connect",
    });

    let callCount = 0;

    const command = useBeforeConnectSocket({ token: "secret-0" });
    const [error, socket, connection] = await clientWithSerializer.execute(
      command,
      {
        beforeConnect: async () => {
          callCount += 1;
        },
      },
    );

    expect(error).toBeNull();
    expect(callCount).toBe(1);
    expect(connection?.url).toContain("token=secret-0");
    expect(connection?.url).toContain("from=serializer");

    if (!socket) {
      throw new Error("Expected socket session");
    }

    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { token: "secret-0", type: "connected" },
    });

    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });
});
