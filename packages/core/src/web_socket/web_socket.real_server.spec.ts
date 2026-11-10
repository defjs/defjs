import {
  beforeEach,
  describe,
  expect,
  inject,
  onTestFinished,
  test,
} from "vitest";

import {
  createClient,
  type DerivableClient,
  withEndpoint,
  type Client,
  type RequestOptions,
} from "../client";
import { struct, StructError } from "../struct";
import {
  defineWebSocket,
  type SocketAwaitResult,
  type WebSocketSession,
  type WebSocketState,
} from "./index";

const terminalWebSocketStates = {
  aborted: true,
  closed: true,
  error: true,
  closing: false,
  connecting: false,
  idle: false,
  open: false,
  reconnecting: false,
} as const satisfies Record<WebSocketState, boolean>;

describe("web socket browser runtime", () => {
  let client: DerivableClient;

  beforeEach(() => {
    client = createClient(withEndpoint(inject("testServerHost")));
  });

  async function run(
    operation: (client: Client) => Promise<SocketAwaitResult<unknown, unknown>>,
    options?: RequestOptions,
  ): Promise<SocketAwaitResult<unknown, unknown>> {
    const controller = new AbortController();
    let pending: Promise<SocketAwaitResult<unknown, unknown>> | undefined;
    let session: WebSocketSession<unknown, unknown> | undefined;
    onTestFinished(async () => {
      try {
        if (!session) {
          controller.abort();
          session = (await pending)?.[1];
        }
        const stateAtReturn = session?.state;
        await session?.[Symbol.asyncDispose]();
        // A live session at return makes teardown dispose race a one-second close budget.
        if (
          stateAtReturn !== undefined &&
          !terminalWebSocketStates[stateAtReturn]
        ) {
          throw new Error(
            `test returned while the session was "${stateAtReturn}": wait for socket.closed in the test body; teardown dispose is bounded at one second`,
          );
        }
      } finally {
        controller.abort();
      }
    });
    const signal = options?.signal;
    const callerSignal = signal instanceof AbortSignal ? signal : undefined;
    pending = operation(
      client({
        ...options,
        signal: callerSignal
          ? AbortSignal.any([controller.signal, callerSignal])
          : controller.signal,
      }),
    ).then((result) => {
      session = result[1];
      return result;
    });
    return pending;
  }

  test("should connect and exchange typed messages in real browsers", async () => {
    const useEchoSocket = defineWebSocket({
      incoming: struct.discriminatedUnion("type", [
        struct.object({
          type: struct.literal("message"),
          text: struct.string(),
        }),
        struct.object({ type: struct.literal("ready"), ok: struct.boolean() }),
      ]),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/echo",
      protocols: ["json"],
    });

    const [error, socket, connection] = await run(useEchoSocket);

    expect(error).toBeNull();
    expect(connection?.protocol).toBe("json");
    if (!socket) {
      throw new Error("Expected socket session");
    }

    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, type: "ready" },
    });

    socket.send({
      text: "hello-browser",
      type: "message",
    });

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "hello-browser", type: "message" },
    });

    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should receive binary websocket frames as typed messages", async () => {
    const useBinarySocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/binary",
      protocols: ["json"],
    });

    const [error, socket] = await run(useBinarySocket);

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }

    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "hello-binary", type: "message" },
    });

    // Wait in the body: teardown dispose only allows one second for the close event.
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      reason: "done",
    });
  });

  test("should report incoming Struct failures in real browsers", async () => {
    const useInvalidSocket = defineWebSocket({
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/error-before-close",
    });

    const [error, socket] = await run(useInvalidSocket);

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }

    let runtimeError: unknown;
    const unsubscribe = socket.onRuntimeError((error: unknown) => {
      runtimeError = error;
    });

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      reason: "done",
    });
    unsubscribe();
    expect(runtimeError).toBeInstanceOf(StructError);
    if (!(runtimeError instanceof StructError)) {
      throw new Error("Expected StructError");
    }
    expect(runtimeError.issues[0]).toMatchObject({
      code: "invalid_type",
      path: ["text"],
    });
  });

  test("should reconnect in real browsers", async () => {
    const [error, socket] = await run(
      (client) =>
        defineWebSocket({
          builder: (input) => ({ query: input }),
          incoming: struct.object({
            type: struct.literal("reconnected"),
            attempt: struct.number(),
          }),
          input: struct.object({
            key: struct.string(),
          }),
          outgoing: struct.object({
            text: struct.string(),
            type: struct.literal("message"),
          }),
          path: "/ws/reconnect",
        })(client, { key: `browser-reconnect-${crypto.randomUUID()}` }),
      {
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }

    socket.send({ text: "seen-open", type: "message" });
    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { attempt: 2, type: "reconnected" },
    });

    // Wait in the body: teardown dispose only allows one second for the close event.
    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should abort an open session in real browsers", async () => {
    const controller = new AbortController();
    const [error, socket] = await run(
      defineWebSocket({
        incoming: struct.object({
          type: struct.literal("ready"),
          ok: struct.boolean(),
        }),
        path: "/ws/echo",
      }),
      { signal: controller.signal },
    );

    expect(error).toBeNull();
    if (!socket) {
      throw new Error("Expected socket session");
    }
    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, type: "ready" },
    });
    const pendingReceive = iterator.next();

    controller.abort();

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    await expect(pendingReceive).rejects.toBeDefined();
    expect(socket.state).toBe("aborted");
  });
});
