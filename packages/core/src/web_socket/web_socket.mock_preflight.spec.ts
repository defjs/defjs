import { describe, expect, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withQuerySerializer,
  withWebSocketHandle,
} from "../client";
import { ERR_ABORTED, ERR_TIMEOUT } from "../error";
import { struct } from "../struct";
import { defineWebSocket } from "./index";
import {
  countingSocket,
  guardedClient,
  watchAbortListeners,
} from "../../test/mock_web_socket";

describe("web socket preflight precedence", () => {
  test.each([
    ["abort", "caller stopped", "NET_ABORTED", ERR_ABORTED],
    [
      "timeout",
      new DOMException("deadline", "TimeoutError"),
      "NET_TIMEOUT",
      ERR_TIMEOUT,
    ],
  ] as const)(
    "should prefer %s over REQ_INPUT_INVALID when input parsing aborts and throws",
    async (_mode, reason, code, cause) => {
      const controller = new AbortController();
      const listeners = watchAbortListeners(controller.signal);
      const failure = new Error("input exploded after abort");
      let builderCalls = 0;
      const opened = countingSocket();
      const endpoint = defineWebSocket({
        builder: () => {
          builderCalls += 1;
          return {};
        },
        incoming: struct.unknown(),
        input: struct.object({ id: struct.string() }),
        path: "/socket",
      });

      const [error, session, connection] = await endpoint(
        guardedClient(opened, controller.signal),
        {
          get id(): string {
            controller.abort(reason);
            throw failure;
          },
        },
      );

      expect(builderCalls).toBe(0);
      expect(opened.constructed()).toBe(0);
      expect(session).toBeUndefined();
      expect(connection).toBeUndefined();
      expect(error).toMatchObject({ cause, code });
      expect(error?.cause).not.toBe(failure);
      expect(listeners.added()).toBeGreaterThan(0);
      expect(listeners.removed()).toBe(listeners.added());
    },
  );

  test("should report an abort that lands after a successful input read and before endpoint selection", async () => {
    const controller = new AbortController();
    const opened = countingSocket();
    const endpoint = defineWebSocket({
      builder: () => ({}),
      incoming: struct.unknown(),
      input: struct.object({ id: struct.string() }),
      path: "/socket",
    });

    const [error, session] = await endpoint(
      guardedClient(opened, controller.signal),
      {
        get id(): string {
          controller.abort();
          return "room";
        },
      },
    );

    expect(opened.constructed()).toBe(0);
    expect(session).toBeUndefined();
    expect(error?.code).toBe("NET_ABORTED");
  });

  test.each([
    ["abort", "caller stopped", "NET_ABORTED", ERR_ABORTED],
    [
      "timeout",
      new DOMException("deadline", "TimeoutError"),
      "NET_TIMEOUT",
      ERR_TIMEOUT,
    ],
  ] as const)(
    "should prefer %s over REQ_BUILD_FAILED when query serialization aborts and throws",
    async (_mode, reason, code, cause) => {
      const controller = new AbortController();
      const listeners = watchAbortListeners(controller.signal);
      const failure = new Error("query serializer failed after abort");
      let builderCalls = 0;
      const opened = countingSocket();
      const endpoint = defineWebSocket({
        builder: () => {
          builderCalls += 1;
          return { query: { room: "1" } };
        },
        incoming: struct.unknown(),
        path: "/socket",
      });
      const client = createClient(
        withEndpoint("https://example.test"),
        withQuerySerializer(() => {
          controller.abort(reason);
          throw failure;
        }),
        withWebSocketHandle(opened.handle),
      );

      const [error, session, connection] = await endpoint(
        client({ signal: controller.signal }),
      );

      expect(builderCalls).toBe(1);
      expect(opened.constructed()).toBe(0);
      expect(session).toBeUndefined();
      expect(connection).toBeUndefined();
      expect(error).toMatchObject({ cause, code });
      expect(error?.cause).not.toBe(failure);
      expect(listeners.added()).toBeGreaterThan(0);
      expect(listeners.removed()).toBe(listeners.added());
    },
  );

  test("should release caller abort listeners after a preflight build failure", async () => {
    const controller = new AbortController();
    const listeners = watchAbortListeners(controller.signal);
    const failure = new Error("build failed");
    const opened = countingSocket();
    const endpoint = defineWebSocket({
      builder: () => {
        throw failure;
      },
      incoming: struct.unknown(),
      path: "/socket",
    });

    const [error, session, connection] = await endpoint(
      guardedClient(opened, controller.signal),
    );

    expect(opened.constructed()).toBe(0);
    expect(session).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(error).toMatchObject({ cause: failure, code: "REQ_BUILD_FAILED" });
    expect(listeners.added()).toBeGreaterThan(0);
    expect(listeners.removed()).toBe(listeners.added());
  });

  test("should release caller abort listeners after invalid input", async () => {
    const controller = new AbortController();
    const listeners = watchAbortListeners(controller.signal);
    const opened = countingSocket();
    const endpoint = defineWebSocket({
      builder: () => ({}),
      incoming: struct.unknown(),
      input: struct.object({ id: struct.number() }),
      path: "/socket/:id",
    });

    const [error, session] = await endpoint(
      guardedClient(opened, controller.signal),
      // @ts-expect-error id must be a number
      { id: "nope" },
    );

    expect(opened.constructed()).toBe(0);
    expect(session).toBeUndefined();
    expect(error?.code).toBe("REQ_INPUT_INVALID");
    expect(listeners.added()).toBeGreaterThan(0);
    expect(listeners.removed()).toBe(listeners.added());
  });

  test("should release caller abort listeners when the WebSocket constructor is missing", async () => {
    const controller = new AbortController();
    const listeners = watchAbortListeners(controller.signal);
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      path: "/socket",
    });
    vi.stubGlobal("WebSocket", undefined);
    const client = createClient(withEndpoint("https://example.test"));

    const [error, session, connection] = await endpoint(
      client({ signal: controller.signal }),
    );

    expect(session).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(error?.code).toBe("ENV_UNSUPPORTED");
    expect(listeners.added()).toBeGreaterThan(0);
    expect(listeners.removed()).toBe(listeners.added());
  });

  test("should return an aborted call before reading an execution-time heartbeat getter", async () => {
    const controller = new AbortController();
    controller.abort();
    let reads = 0;
    const opened = countingSocket();
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      path: "/socket",
    });

    const [error, session] = await endpoint(
      createClient(
        withEndpoint("https://example.test"),
        withWebSocketHandle(opened.handle),
        (config) => {
          config.webSocket.heartbeat = {
            get intervalMs(): number {
              reads += 1;
              throw new Error("heartbeat should not be read");
            },
            message: () => undefined,
          };
        },
      )({ signal: controller.signal }),
    );

    expect(opened.constructed()).toBe(0);
    expect(session).toBeUndefined();
    expect(error?.code).toBe("NET_ABORTED");
    expect(reads).toBe(0);
  });
});
