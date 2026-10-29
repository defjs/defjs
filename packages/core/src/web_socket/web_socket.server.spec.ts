import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createClient,
  withEndpoint,
  withInterceptors,
  withWebSocketHandle,
  withWebSocketReconnect,
  type Client,
} from "../client";
import {
  createNetworkFault,
  createPreflightFault,
  createUndecodedHttpStatusFault,
  ERR_ABORTED,
} from "../error";
import {
  createWebSocketInterceptor,
  type WebSocketSessionLike,
} from "../interceptor";
import { StructError, struct } from "../struct";
import { defineWebSocket, type SocketAwaitResult } from "./index";

let lastMockInstance: MockWebSocketInstance | undefined;
let mockInstances: MockWebSocketInstance[] = [];

interface MockWebSocketInstance {
  bufferedAmount: number;
  readyState: number;
  url: string;
  protocol: string;
  extensions: string;
  binaryType: string;
  close: (code?: number, reason?: string) => void;
  send: (data: string) => void;
  addEventListener: (type: string, fn: (event: unknown) => void) => void;
  removeEventListener: (type: string, fn: (event: unknown) => void) => void;
  triggerOpen: () => void;
  triggerClose: (event: {
    code: number;
    reason: string;
    wasClean: boolean;
  }) => void;
  triggerError: () => void;
  triggerMessage: (data: unknown) => void;
  listenerCount: (type?: string) => number;
  listenerRefs: (type?: string) => ReadonlyArray<(event: unknown) => void>;
}

function createMockWebSocketClass(
  options: {
    autoOpen?: boolean;
    autoCloseDelay?: number;
    closeEventDelayMs?: number;
    closeErrors?: readonly unknown[];
    emitCloseEvent?: boolean;
    onListenerRegistered?: (type: string) => void;
    onSend?: (data: string) => void;
    sendError?: Error;
    throwOnConstruct?: Error;
  } = {},
) {
  const {
    autoOpen = true,
    autoCloseDelay = -1,
    closeEventDelayMs = 0,
    closeErrors = [],
    emitCloseEvent = true,
    onListenerRegistered,
    onSend,
    sendError,
    throwOnConstruct,
  } = options;
  let closeCall = 0;

  return class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    bufferedAmount: number;
    readyState: number;
    url: string;
    protocol: string;
    extensions: string;
    binaryType: string;
    close: MockWebSocketInstance["close"];
    send: MockWebSocketInstance["send"];
    addEventListener: MockWebSocketInstance["addEventListener"];
    removeEventListener: MockWebSocketInstance["removeEventListener"];
    triggerOpen: MockWebSocketInstance["triggerOpen"];
    triggerClose: MockWebSocketInstance["triggerClose"];
    triggerError: MockWebSocketInstance["triggerError"];
    triggerMessage: MockWebSocketInstance["triggerMessage"];
    listenerCount: MockWebSocketInstance["listenerCount"];
    listenerRefs: MockWebSocketInstance["listenerRefs"];

    private listeners: { [key: string]: Array<(event: unknown) => void> };

    constructor(url: string, protocols?: string | string[]) {
      if (throwOnConstruct) {
        throw throwOnConstruct;
      }

      this.readyState = MockWebSocket.CONNECTING;
      this.bufferedAmount = 0;
      this.url = url;
      this.protocol = Array.isArray(protocols)
        ? (protocols[0] ?? "")
        : (protocols ?? "");
      this.extensions = "";
      this.binaryType = "blob";
      this.listeners = {};
      this.close = vi.fn((code?: number, reason?: string) => {
        const hasCloseError = closeCall in closeErrors;
        const closeError = closeErrors[closeCall];
        closeCall += 1;
        if (hasCloseError) {
          throw closeError;
        }
        this.readyState = MockWebSocket.CLOSING;
        if (!emitCloseEvent) {
          return;
        }
        setTimeout(() => {
          this.readyState = MockWebSocket.CLOSED;
          this.listeners["close"]?.forEach((fn) => {
            fn({ code: code ?? 1000, reason: reason ?? "", wasClean: true });
          });
        }, closeEventDelayMs);
      });
      this.send = vi.fn((data: string) => {
        onSend?.(data);
        if (sendError) {
          throw sendError;
        }
      });
      this.addEventListener = (type: string, fn: (event: unknown) => void) => {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(fn);
        onListenerRegistered?.(type);
      };
      this.removeEventListener = (
        type: string,
        fn: (event: unknown) => void,
      ) => {
        this.listeners[type] =
          this.listeners[type]?.filter((listener) => listener !== fn) || [];
      };
      this.triggerOpen = () => {
        this.readyState = MockWebSocket.OPEN;
        this.listeners["open"]?.forEach((fn) => fn(new Event("open")));
      };
      this.triggerClose = (event: {
        code: number;
        reason: string;
        wasClean: boolean;
      }) => {
        this.readyState = MockWebSocket.CLOSED;
        this.listeners["close"]?.forEach((fn) => fn(event));
      };
      this.triggerError = () => {
        this.listeners["error"]?.forEach((fn) => fn(new Event("error")));
      };
      this.triggerMessage = (data: unknown) => {
        this.listeners["message"]?.forEach((fn) => fn({ data }));
      };
      this.listenerCount = (type?: string) =>
        typeof type === "string"
          ? (this.listeners[type]?.length ?? 0)
          : Object.values(this.listeners).reduce(
              (count, listeners) => count + listeners.length,
              0,
            );
      this.listenerRefs = (type?: string) => {
        const groups =
          typeof type === "string"
            ? [this.listeners[type] ?? []]
            : Object.values(this.listeners);
        return groups.flat();
      };

      // Type boundary: capture the constructed mock instance so tests can trigger events on it.
      // oxlint-disable-next-line typescript/no-this-alias
      lastMockInstance = this;
      mockInstances.push(this);

      if (autoOpen) {
        setTimeout(() => this.triggerOpen(), 0);
      }
      if (autoCloseDelay >= 0) {
        setTimeout(
          () =>
            this.triggerClose({ code: 1000, reason: "done", wasClean: true }),
          autoCloseDelay,
        );
      }
    }
  };
}

function createDeferred<T>() {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

type AbortListener = (event: Event) => void;

/**
 * Records abort callbacks by function identity.
 * A merged session signal also carries forwarding listeners, so a generation is the set captured
 * while that attempt is open — not "whatever count happens to remain".
 */
function instrumentAbortListeners(signal: AbortSignal): {
  listeners(): readonly AbortListener[];
  assertReleased(generation: readonly AbortListener[]): void;
} {
  const live = new Set<AbortListener>();
  const removed = new Set<AbortListener>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((
    ...args: Parameters<AbortSignal["addEventListener"]>
  ) => {
    const [type, listener] = args;
    if (type === "abort" && typeof listener === "function") {
      live.add(listener);
    }
    add(...args);
  }) as AbortSignal["addEventListener"];
  signal.removeEventListener = ((
    ...args: Parameters<AbortSignal["removeEventListener"]>
  ) => {
    const [type, listener] = args;
    if (type === "abort" && typeof listener === "function") {
      live.delete(listener);
      removed.add(listener);
    }
    remove(...args);
  }) as AbortSignal["removeEventListener"];
  return {
    listeners: () => [...live],
    assertReleased(generation) {
      expect(generation.length).toBeGreaterThan(0);
      for (const listener of generation) {
        expect(live.has(listener)).toBe(false);
        expect(removed.has(listener)).toBe(true);
      }
      for (const listener of live) {
        expect(generation).not.toContain(listener);
      }
    },
  };
}

function soleListener(
  socket: MockWebSocketInstance,
  type: string,
): (event: unknown) => void {
  const listeners = socket.listenerRefs(type);
  expect(listeners).toHaveLength(1);
  const listener = listeners[0];
  if (!listener) {
    throw new Error(`Expected one ${type} listener`);
  }
  return listener;
}

function expectListenerReleased(
  socket: MockWebSocketInstance,
  type: string,
  listener: (event: unknown) => void,
): void {
  expect(socket.listenerRefs(type)).not.toContain(listener);
  expect(socket.listenerCount(type)).toBe(0);
}

function clientObservingAbortListeners(): {
  client: Client;
  observed: {
    current: ReturnType<typeof instrumentAbortListeners> | undefined;
  };
} {
  const observed: {
    current: ReturnType<typeof instrumentAbortListeners> | undefined;
  } = { current: undefined };
  const client = createClient(
    withEndpoint("http://localhost"),
    withInterceptors(
      createWebSocketInterceptor((request, next) => {
        const signal = request.abort;
        if (!signal) {
          throw new Error("Expected session signal");
        }
        observed.current = instrumentAbortListeners(signal);
        return next(request);
      }),
    ),
  );
  return { client, observed };
}

function encodeMessage(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
}

describe("web socket runtime environment edge cases", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    lastMockInstance = undefined;
    mockInstances = [];
  });

  async function run(
    client: Client,
    command: unknown,
    options?: unknown,
  ): Promise<SocketAwaitResult<unknown, unknown>> {
    return client.execute(command as never, options as never) as Promise<
      SocketAwaitResult<unknown, unknown>
    >;
  }

  test("should return transport error when WebSocket constructor throws", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        throwOnConstruct: new Error("connection refused"),
      }),
    );

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket, connection] = await run(client, useSocket());

    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(error?.code.startsWith("NET_")).toBe(true);
  });

  test("should report invalid incoming frames without tearing down the session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({
        ok: struct.boolean(),
        type: struct.literal("known"),
      }),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket] = await run(client, useSocket());
    expect(error).toBeNull();
    if (!socket || !lastMockInstance) {
      throw new Error("Expected open session");
    }

    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError);
    });

    lastMockInstance.triggerMessage('{"ok":true}');
    lastMockInstance.triggerMessage('{"type":"unknown","ok":true}');
    await vi.waitFor(() => expect(runtimeErrors).toHaveLength(2));
    expect(runtimeErrors[0]).toBeInstanceOf(StructError);
    expect(runtimeErrors[1]).toBeInstanceOf(StructError);

    lastMockInstance.triggerMessage('{"type":"known","ok":true}');
    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, type: "known" },
    });

    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should ignore non-text frames without notifying runtime errors", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({
        ok: struct.boolean(),
        type: struct.literal("known"),
      }),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket] = await run(client, useSocket());
    expect(error).toBeNull();
    if (!socket || !lastMockInstance) {
      throw new Error("Expected open session");
    }

    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError);
    });

    lastMockInstance.triggerMessage(123);
    lastMockInstance.triggerMessage({ ok: true, type: "known" });
    lastMockInstance.triggerMessage('{"type":"known","ok":true}');

    const iterator = socket.receive[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, type: "known" },
    });
    expect(runtimeErrors).toEqual([]);

    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should return transport error when WebSocket constructor throws non-Error", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        // @ts-expect-error testing runtime defensive behavior when constructor throws a non-Error value
        throwOnConstruct: "connection refused",
      }),
    );

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket, connection] = await run(client, useSocket());

    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(error?.code).toBe("NET_UNREACHABLE");
    expect(error?.message).toBe("connection refused");
  });

  test("should finish startup with aborted transport error when aborted before open", async () => {
    const listening = createDeferred<void>();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        autoOpen: false,
        onListenerRegistered(type) {
          if (type === "open") {
            listening.resolve(undefined);
          }
        },
      }),
    );

    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const executePromise = run(client, useSocket(), {
      signal: controller.signal,
    });

    await listening.promise;
    controller.abort(ERR_ABORTED);

    const [error, socket, connection] = await executePromise;

    expect(socket).toBeUndefined();
    expect(connection?.url).toBe("ws://localhost/ws/test");
    expect(error?.code.startsWith("NET_")).toBe(true);
    expect(error?.code).toBe("NET_ABORTED");
  });

  test("should preserve a pre-aborted timeout without constructing a physical socket", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    controller.abort(new DOMException("deadline expired", "TimeoutError"));
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        signal: controller.signal,
      },
    );

    expect(error).toMatchObject({
      code: "NET_TIMEOUT",
      message: "Request timed out",
    });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should prefer invalid timeout validation over an already aborted signal", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    controller.abort("caller stopped");
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        signal: controller.signal,
        timeout: 0,
      },
    );

    expect(error).toMatchObject({ code: "REQ_OPTIONS_INVALID" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should treat a plain timeout-message Error abort reason as an abort", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    controller.abort(new Error("Request timed out"));
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        signal: controller.signal,
      },
    );

    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should read the timeout option once before any asynchronous work", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    let timeoutReads = 0;
    const options = {
      get timeout() {
        timeoutReads += 1;
        return timeoutReads === 1 ? undefined : Number.POSITIVE_INFINITY;
      },
    };
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      options,
    );

    expect(error).toBeNull();
    expect(timeoutReads).toBe(1);
    expect(mockInstances).toHaveLength(1);
    socket?.close(1000, "done");
    await socket?.closed;
  });

  test("should return a definition error when snapshotting the abort option throws", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const getterFailure = new Error("abort getter failed");
    const options = {
      get abort(): AbortSignal | undefined {
        throw getterFailure;
      },
    };
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const result = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      options,
    );

    expect(result).toEqual([
      expect.objectContaining({
        cause: getterFailure,
        code: "REQ_OPTIONS_INVALID",
      }),
      undefined,
      undefined,
    ]);
    expect(mockInstances).toHaveLength(0);
  });

  test.each(["heartbeat", "reconnect"] as const)(
    "should return a definition error when reading the top-level %s option throws",
    async (option) => {
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const getterFailure = new Error(`${option} getter failed`);
      const options = Object.defineProperty({}, option, {
        get() {
          throw getterFailure;
        },
      });
      const useSocket = defineWebSocket({
        maxIncomingQueueSize: 1,
        incoming: struct.unknown(),
        path: "/ws/test",
      });

      const [error, socket, connection] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
        options,
      );

      expect(error).toMatchObject({
        cause: getterFailure,
        code: "REQ_OPTIONS_INVALID",
      });
      expect(socket).toBeUndefined();
      expect(connection).toBeUndefined();
      expect(mockInstances).toHaveLength(0);
    },
  );

  test("should snapshot configured protocols before beforeConnect mutates their source", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const protocols = ["snapshot-protocol"];
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        beforeConnect() {
          protocols[0] = "mutated-protocol";
        },
        protocols,
      },
    );

    expect(error).toBeNull();
    expect(lastMockInstance?.protocol).toBe("snapshot-protocol");
    socket?.close(1000, "done");
    await socket?.closed;
  });

  test.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    "should reject invalid websocket timeout %s before constructing a physical socket",
    async (timeout) => {
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const useSocket = defineWebSocket({
        maxIncomingQueueSize: 1,
        incoming: struct.unknown(),
        path: "/ws/test",
      });

      const result = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
        { timeout },
      );

      expect(result).toEqual([
        expect.objectContaining({ code: "REQ_OPTIONS_INVALID" }),
        undefined,
        undefined,
      ]);
      expect(mockInstances).toHaveLength(0);
    },
  );

  test("should observe an abort issued by an interceptor before the transport handler starts", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const abortingInterceptor = createWebSocketInterceptor((request, next) => {
      controller.abort(ERR_ABORTED);
      return next(request);
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(abortingInterceptor),
      ),
      useSocket(),
      { signal: controller.signal },
    );

    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should settle a hanging websocket interceptor when externally aborted", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const entered = createDeferred<void>();
    const hangingInterceptor = createWebSocketInterceptor(() => {
      entered.resolve(undefined);
      return new Promise<WebSocketSessionLike>(() => undefined);
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(hangingInterceptor),
      ),
      useSocket(),
      {
        signal: controller.signal,
      },
    );

    await entered.promise;
    controller.abort(ERR_ABORTED);
    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should settle a hanging websocket interceptor on timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const entered = createDeferred<void>();
    let settled = false;
    const hangingInterceptor = createWebSocketInterceptor(() => {
      entered.resolve(undefined);
      return new Promise<WebSocketSessionLike>(() => undefined);
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(hangingInterceptor),
      ),
      useSocket(),
      {
        timeout: 5,
      },
    );
    void executePromise.then(() => {
      settled = true;
    });

    await entered.promise;
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5);
    expect(settled).toBe(true);
    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({ code: "NET_TIMEOUT" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should not construct a physical socket when abort follows transport handler invocation", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const abortingInterceptor = createWebSocketInterceptor((request, next) => {
      const pendingSession = next(request);
      controller.abort(ERR_ABORTED);
      return pendingSession;
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(abortingInterceptor),
      ),
      useSocket(),
      { signal: controller.signal },
    );

    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should prefer an abort that follows a pre-open close in the same turn", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerClose({
      code: 1006,
      reason: "early close",
      wasClean: false,
    });
    controller.abort(ERR_ABORTED);

    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({ code: "NET_ABORTED" });
    expect(socket).toBeUndefined();
    expect(connection).toMatchObject({ generation: 0 });
  });

  test("should report a transport error when the peer closes before open without a native cause", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerClose({
      code: 1006,
      reason: "early close",
      wasClean: false,
    });

    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({
      code: "NET_UNREACHABLE",
      message: "WebSocket closed before open",
    });
    expect(socket).toBeUndefined();
    expect(connection).toMatchObject({ generation: 0 });
  });

  test("should surface a startup timeout while waiting for the physical socket to open", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    let settled = false;
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      { timeout: 10 },
    );
    void executePromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(lastMockInstance).toBeDefined();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true);

    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({ code: "NET_TIMEOUT" });
    expect(socket).toBeUndefined();
    expect(connection).toMatchObject({ generation: 0 });
  });

  test("should report a missing WebSocket constructor as an environment fault", async () => {
    const originalWebSocket = globalThis.WebSocket;
    vi.stubGlobal("WebSocket", undefined);

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [error, socket, connection] = await run(client, useSocket());

    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(error?.code).toBe("ENV_UNSUPPORTED");

    vi.stubGlobal("WebSocket", originalWebSocket);
  });

  test("should set duplicate open state only once", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));

    const states: string[] = [];
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    const nativeSocket = lastMockInstance;
    nativeSocket?.triggerOpen();
    const [, socket] = await executePromise;

    if (!socket || !nativeSocket) {
      throw new Error("Expected socket");
    }

    socket.onStateChange((state: string) => {
      states.push(state);
    });
    nativeSocket.triggerOpen();
    nativeSocket.triggerOpen();

    // The listener is attached after the session is already open, so the first open is not
    // observable. Duplicate open events on that live session must not emit more open states.
    expect(states.filter((state) => state === "open")).toHaveLength(0);
    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 });
  });

  test("should emit runtime error when send throws during queued flush", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        autoOpen: false,
        sendError: new Error("send failed"),
      }),
    );

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      maxOutgoingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("msg"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });

    const client = createClient(
      withEndpoint("http://localhost"),
      withWebSocketHandle(globalThis.WebSocket),
      withWebSocketReconnect({ attempts: 1, delayMs: 0 }),
    );
    const executePromise = run(client, useSocket());
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    const firstSocket = lastMockInstance;
    firstSocket?.triggerOpen();
    const [error, socket] = await executePromise;

    expect(error).toBeNull();
    if (!socket || !firstSocket) {
      throw new Error("Expected socket");
    }

    let runtimeError: unknown;
    socket.onRuntimeError((err: unknown) => {
      runtimeError = err;
    });
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);
    const reconnecting = createDeferred<void>();
    socket.onStateChange((state) => {
      if (state !== "reconnecting") {
        return;
      }
      socket.send({ type: "msg", text: "queued" });
      reconnecting.resolve(undefined);
    });

    firstSocket.triggerClose({ code: 1000, reason: "", wasClean: true });
    await reconnecting.promise;
    await vi.waitFor(() => expect(mockInstances).toHaveLength(2));
    const replacement = mockInstances[1];
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }
    replacement.triggerOpen();

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(runtimeError).toBeDefined();
    await expect(pendingReceive).resolves.toMatchObject({
      message: "send failed",
    });
    expect(socket.state).toBe("error");
  });

  test("should set binaryType to arraybuffer on socket creation", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoCloseDelay: 50 }),
    );

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const client = createClient(withEndpoint("http://localhost"));
    const [, socket] = await run(client, useSocket());

    expect(socket).toBeDefined();
    expect(lastMockInstance?.binaryType).toBe("arraybuffer");
  });

  test("should run heartbeat through an injected handle without global WebSocket", async () => {
    vi.useFakeTimers();
    const InjectedWebSocket = createMockWebSocketClass({
      autoOpen: false,
      emitCloseEvent: false,
    });
    vi.stubGlobal("WebSocket", undefined);
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const client = createClient(
      withEndpoint("http://localhost"),
      withWebSocketHandle(InjectedWebSocket),
    );
    const executePromise = run(client, useSocket(), {
      heartbeat: { intervalMs: 5, message: () => ({ type: "ping" }) },
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;

    await vi.advanceTimersByTimeAsync(5);
    expect(nativeSocket.send).toHaveBeenCalled();
    socket.close(1000, "done");
    nativeSocket.triggerClose({ code: 1000, reason: "done", wasClean: true });
    await socket.closed;
  });

  test("F062 should keep an injected socket open when send synchronously delivers every heartbeat pong", async () => {
    vi.useFakeTimers();
    const isAck = vi.fn((message: { type: string }) => message.type === "pong");
    const InjectedWebSocket = createMockWebSocketClass({
      autoOpen: false,
      emitCloseEvent: false,
      onSend() {
        lastMockInstance?.triggerMessage('{"type":"pong"}');
      },
    });
    vi.stubGlobal("WebSocket", undefined);
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({ type: struct.literal("pong") }),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const client = createClient(
      withEndpoint("http://localhost"),
      withWebSocketHandle(InjectedWebSocket),
    );
    const executePromise = run(client, useSocket(), {
      heartbeat: {
        intervalMs: 100,
        timeoutMs: 50,
        isAck,
        message: () => ({ type: "ping" }),
      },
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [error, socket] = await executePromise;
    if (!socket || !lastMockInstance) throw new Error("Expected open socket");
    const nativeSocket = lastMockInstance;
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => runtimeErrors.push(runtimeError));

    try {
      expect(error).toBeNull();
      await vi.advanceTimersByTimeAsync(450);

      expect(runtimeErrors).toEqual([]);
      expect(socket.state).toBe("open");
      expect(nativeSocket.readyState).toBe(InjectedWebSocket.OPEN);
      expect(nativeSocket.send).toHaveBeenCalledTimes(4);
      expect(nativeSocket.send).toHaveBeenLastCalledWith('{"type":"ping"}');
      expect(isAck).toHaveBeenCalledTimes(4);
      expect(isAck).toHaveBeenLastCalledWith({ type: "pong" });
      expect(nativeSocket.close).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      socket.close(1000, "test complete");
      nativeSocket.triggerClose({
        code: 1000,
        reason: "test complete",
        wasClean: true,
      });
      await socket.closed;
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  test("should send the next heartbeat after a decoded pong acknowledges the open cycle", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    let ackChecks = 0;
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 4,
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        heartbeat: {
          intervalMs: 20,
          isAck(message: { type: string }) {
            ackChecks += 1;
            return message.type === "pong";
          },
          message: () => ({ type: "ping" }),
          timeoutMs: 200,
        },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError);
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(nativeSocket.send).toHaveBeenCalledTimes(1);
    nativeSocket.triggerMessage(JSON.stringify({ ok: true, type: "pong" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(ackChecks).toBe(1);
    await vi.advanceTimersByTimeAsync(20);

    expect(nativeSocket.send).toHaveBeenCalledTimes(2);
    expect(runtimeErrors).toEqual([]);
    expect(socket.state).toBe("open");
    socket.close(1000, "done");
    nativeSocket.triggerClose({ code: 1000, reason: "done", wasClean: true });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
  });

  test("should stop a heartbeat callback that aborts the logical session before send or timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        heartbeat: {
          intervalMs: 10,
          message() {
            controller.abort(ERR_ABORTED);
            return { type: "ping" };
          },
          timeoutMs: 1_000,
        },
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;

    await vi.advanceTimersByTimeAsync(10);

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should stop heartbeat timers only after accepting a valid manual close request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        heartbeat: { intervalMs: 100 },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;

    expect(vi.getTimerCount()).toBe(1);
    expect(() => socket.close(200, "invalid")).toThrow(
      expect.objectContaining({ name: "InvalidAccessError" }),
    );
    expect(vi.getTimerCount()).toBe(1);

    socket.close(1000, "owner closed");
    expect(socket.state).toBe("closing");
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    nativeSocket.triggerClose({
      code: 1000,
      reason: "owner closed",
      wasClean: true,
    });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner closed",
    });
  });

  test("should preserve an external abort triggered by a closing observer", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ emitCloseEvent: false }),
    );
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        signal: controller.signal,
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const states: string[] = [];
    socket.onStateChange((state) => {
      states.push(state);
      if (state === "closing") {
        controller.abort(ERR_ABORTED);
      }
    });

    socket.close(1000, "owner closed");

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    expect(socket.state).toBe("aborted");
    expect(states).toEqual(["closing", "aborted"]);
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
  });

  test("should not acknowledge through a heartbeat runtime removed by its isAck callback", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck() {
            controller.abort(ERR_ABORTED);
            return true;
          },
        },
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    nativeSocket.triggerMessage(JSON.stringify({ ok: true, type: "pong" }));
    await vi.advanceTimersByTimeAsync(0);

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    await expect(pendingReceive).resolves.toBe(ERR_ABORTED);
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should ignore an isAck rejection after the callback aborts its heartbeat session", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck() {
            controller.abort(ERR_ABORTED);
            throw new Error("late classifier failure");
          },
        },
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    nativeSocket.triggerMessage(JSON.stringify({ ok: true, type: "pong" }));
    await vi.advanceTimersByTimeAsync(0);

    await expect(socket.closed).resolves.toMatchObject({
      cause: ERR_ABORTED,
      kind: "aborted",
    });
    await expect(pendingReceive).resolves.toBe(ERR_ABORTED);
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should snapshot heartbeat config before beforeConnect can mutate it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    let configuredInterval = 20;
    let intervalReads = 0;
    const heartbeat = {
      get intervalMs() {
        intervalReads += 1;
        return intervalReads === 1
          ? configuredInterval
          : Number.POSITIVE_INFINITY;
      },
      message: () => ({ type: "ping" as const }),
    };
    let socketExistedDuringHook = false;
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });

    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        beforeConnect() {
          socketExistedDuringHook = typeof lastMockInstance !== "undefined";
          configuredInterval = Number.POSITIVE_INFINITY;
        },
        heartbeat,
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    expect(socketExistedDuringHook).toBe(false);
    expect(intervalReads).toBe(1);
    expect(() => lastMockInstance?.triggerOpen()).not.toThrow();
    const [error, socket] = await executePromise;
    expect(error).toBeNull();
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    // The snapshotted 20ms interval must fire even though the live config is now infinite.
    await vi.advanceTimersByTimeAsync(20);
    expect(lastMockInstance.send).toHaveBeenCalled();
    socket.close(1000, "done");
    lastMockInstance.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await socket.closed;
  });

  describe.each(["synchronous", "asynchronous"] as const)(
    "%s native close",
    (closeMode) => {
      test.each(["open", "message", "close", "error"] as const)(
        "cleans all listeners when abort fires during %s registration",
        async (registrationPoint) => {
          vi.useFakeTimers();
          const controller = new AbortController();
          let abortedDuringRegistration = false;
          vi.stubGlobal(
            "WebSocket",
            createMockWebSocketClass({
              autoOpen: false,
              onListenerRegistered(type) {
                if (type === registrationPoint && !abortedDuringRegistration) {
                  abortedDuringRegistration = true;
                  const nativeSocket = lastMockInstance;
                  if (!nativeSocket)
                    throw new Error("Expected physical socket");
                  if (closeMode === "synchronous") {
                    nativeSocket.close = vi.fn(() =>
                      nativeSocket.triggerClose({
                        code: 1000,
                        reason: "",
                        wasClean: true,
                      }),
                    );
                  }
                  controller.abort(ERR_ABORTED);
                }
              },
            }),
          );
          const useSocket = defineWebSocket({
            maxIncomingQueueSize: 1,
            incoming: struct.unknown(),
            path: "/ws/test",
          });

          const [error, socket, connection] = await run(
            createClient(withEndpoint("http://localhost")),
            useSocket(),
            { signal: controller.signal, heartbeat: { intervalMs: 20 } },
          );

          expect(abortedDuringRegistration).toBe(true);
          expect(error).toMatchObject({ code: "NET_ABORTED" });
          expect(socket).toBeUndefined();
          expect(connection).toMatchObject({ generation: 0 });
          const nativeSocket = lastMockInstance;
          if (!nativeSocket) throw new Error("Expected physical socket");
          expect(nativeSocket.close).toHaveBeenCalledTimes(1);
          expect(nativeSocket.listenerCount()).toBe(0);

          nativeSocket.triggerOpen();
          nativeSocket.triggerMessage("null");
          nativeSocket.triggerError();
          nativeSocket.triggerClose({
            code: 1000,
            reason: "late",
            wasClean: true,
          });
          await vi.runAllTimersAsync();

          expect(nativeSocket.listenerCount()).toBe(0);
          expect(nativeSocket.close).toHaveBeenCalledTimes(1);
          expect(mockInstances).toHaveLength(1);
          expect(vi.getTimerCount()).toBe(0);
        },
      );
    },
  );

  test("cleans the physical socket when its constructor aborts before listener registration", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const BaseSocket = createMockWebSocketClass({ autoOpen: false });
    class AbortingSocket extends BaseSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        controller.abort(ERR_ABORTED);
      }
    }
    vi.stubGlobal("WebSocket", AbortingSocket);
    const endpoint = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, session] = await run(
      createClient(withEndpoint("http://localhost")),
      endpoint(),
      { signal: controller.signal },
    );
    const nativeSocket = lastMockInstance;
    if (!nativeSocket) throw new Error("Expected physical socket");
    expect(error?.code).toBe("NET_ABORTED");
    expect(session).toBeUndefined();
    expect(nativeSocket.close).toHaveBeenCalledOnce();
    expect(nativeSocket.listenerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should return a definition error when a heartbeat snapshot getter throws", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const snapshotFailure = new Error("heartbeat getter failed");
    const heartbeat = {
      intervalMs: 20,
      get message(): () => never {
        throw snapshotFailure;
      },
    };
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      { heartbeat },
    );

    expect(error).toMatchObject({
      cause: snapshotFailure,
      code: "REQ_OPTIONS_INVALID",
    });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(lastMockInstance).toBeUndefined();
  });

  test("should surface runtime cause on error event before close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    const nativeSocket = lastMockInstance;
    nativeSocket?.triggerOpen();
    const [error, socket] = await executePromise;

    expect(error).toBeNull();
    if (!socket || !nativeSocket) {
      throw new Error("Expected socket");
    }

    nativeSocket.triggerError();

    await expect(socket.closed).resolves.toMatchObject({
      cause: expect.objectContaining({ message: "WebSocket connection error" }),
      kind: "error",
    });
  });

  test("should wait for the errored physical socket close before constructing its replacement", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const firstSocket = lastMockInstance;

    firstSocket.triggerError();

    expect(mockInstances).toHaveLength(1);
    expect(firstSocket.close).toHaveBeenCalledTimes(1);
    // Close stays withheld. A premature replacement queued on a timer would appear on this turn,
    // which is still short of the close grace.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockInstances).toHaveLength(1);

    firstSocket.triggerClose({
      code: 1006,
      reason: "transport",
      wasClean: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockInstances).toHaveLength(2);
    // autoOpen is off, so the replacement stays connecting until this turn opens it.
    mockInstances[1]?.triggerOpen();
    expect(socket.connection.generation).toBe(2);

    socket.close(1000, "done");
    lastMockInstance?.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await socket.closed;
  });

  test("should keep the replacement open after the errored socket close grace elapses", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const firstSocket = lastMockInstance;

    firstSocket.triggerError();
    firstSocket.triggerClose({
      code: 1006,
      reason: "transport",
      wasClean: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockInstances).toHaveLength(2);
    mockInstances[1]?.triggerOpen();
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(2);

    socket.close(1000, "done");
    lastMockInstance?.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await socket.closed;
  });

  test("releases the same message listener reference on reconnect, failure, close, and dispose", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 4,
      incoming: struct.object({
        n: struct.number(),
        type: struct.literal("tick"),
      }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      { reconnect: { attempts: 2, delayMs: 0 } },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [error, socket] = await executePromise;
    expect(error).toBeNull();
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const iterator = socket.receive[Symbol.asyncIterator]();
    const opened = [lastMockInstance];
    const messageListeners = [soleListener(lastMockInstance, "message")];
    lastMockInstance.triggerMessage(JSON.stringify({ n: 1, type: "tick" }));
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { n: 1, type: "tick" },
    });
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(1);

    const retire = async (
      index: number,
      how: "reconnect" | "failure",
    ): Promise<void> => {
      const nativeSocket = opened[index];
      const listener = messageListeners[index];
      if (!nativeSocket || !listener) {
        throw new Error("Expected the generation being retired");
      }
      if (how === "failure") {
        nativeSocket.triggerError();
        expect(nativeSocket.listenerRefs("message")).toContain(listener);
      }
      nativeSocket.triggerClose({
        code: how === "failure" ? 1006 : 1012,
        reason: how,
        wasClean: how !== "failure",
      });
      expectListenerReleased(nativeSocket, "message", listener);
      nativeSocket.triggerMessage(JSON.stringify({ n: 99, type: "tick" }));
      await vi.waitFor(() => expect(mockInstances).toHaveLength(index + 2));
      const replacement = mockInstances[index + 1];
      if (!replacement) throw new Error("Expected replacement socket");
      replacement.triggerOpen();
      await vi.waitFor(() =>
        expect(socket.connection.generation).toBe(index + 2),
      );
      const replacementListener = soleListener(replacement, "message");
      expect(replacementListener).not.toBe(listener);
      opened.push(replacement);
      messageListeners.push(replacementListener);
      replacement.triggerMessage(
        JSON.stringify({ n: index + 2, type: "tick" }),
      );
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { n: index + 2, type: "tick" },
      });
    };

    await retire(0, "reconnect");
    await retire(1, "failure");

    const current = opened[2];
    const currentListener = messageListeners[2];
    if (!current || !currentListener) {
      throw new Error("Expected the open generation");
    }
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(3);
    socket.close(1000, "done");
    current.triggerClose({ code: 1000, reason: "done", wasClean: true });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
    expect(socket.state).toBe("closed");
    expect(socket.connection.generation).toBe(3);
    expectListenerReleased(current, "message", currentListener);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    expect(socket.state).toBe("closed");
    for (const nativeSocket of opened) {
      expect(nativeSocket.listenerCount("message")).toBe(0);
    }
  });

  test("releases each reconnect generation's abort listeners before the next generation listens", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const { client, observed } = clientObservingAbortListeners();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 4,
      incoming: struct.object({
        n: struct.number(),
        type: struct.literal("tick"),
      }),
      path: "/ws/test",
    });
    const executePromise = run(client, useSocket(), {
      reconnect: { attempts: 3, delayMs: 0 },
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [error, socket] = await executePromise;
    expect(error).toBeNull();
    const abortListeners = observed.current;
    if (!socket || !abortListeners) {
      throw new Error("Expected socket");
    }
    const iterator = socket.receive[Symbol.asyncIterator]();
    let generation = abortListeners.listeners();
    expect(generation.length).toBeGreaterThan(0);
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(1);

    for (let drop = 0; drop < 3; drop += 1) {
      const previous = generation;
      mockInstances[drop]?.triggerClose({
        code: 1012,
        reason: "drop",
        wasClean: true,
      });
      await vi.waitFor(() => expect(mockInstances).toHaveLength(drop + 2));
      abortListeners.assertReleased(previous);
      const replacement = mockInstances[drop + 1];
      if (!replacement) throw new Error("Expected replacement socket");
      replacement.triggerOpen();
      await vi.waitFor(() =>
        expect(socket.connection.generation).toBe(drop + 2),
      );
      expect(socket.state).toBe("open");
      generation = abortListeners.listeners();
      expect(generation.length).toBeGreaterThan(0);
      abortListeners.assertReleased(previous);
      replacement.triggerMessage(JSON.stringify({ n: drop + 2, type: "tick" }));
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { n: drop + 2, type: "tick" },
      });
    }

    expect(mockInstances).toHaveLength(4);
    expect(socket.connection.generation).toBe(4);
    socket.close(1000, "done");
    lastMockInstance?.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
    expect(socket.state).toBe("closed");
    expect(socket.connection.generation).toBe(4);
    abortListeners.assertReleased(generation);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  test("releases the open generation's abort listeners when the caller cancels", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const controller = new AbortController();
    const { client, observed } = clientObservingAbortListeners();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(client, useSocket(), {
      reconnect: { attempts: 1, delayMs: 0 },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [error, socket] = await executePromise;
    expect(error).toBeNull();
    const abortListeners = observed.current;
    if (!socket || !lastMockInstance || !abortListeners) {
      throw new Error("Expected socket");
    }
    lastMockInstance.triggerClose({
      code: 1012,
      reason: "drop",
      wasClean: true,
    });
    await vi.waitFor(() => expect(mockInstances).toHaveLength(2));
    mockInstances[1]?.triggerOpen();
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    expect(socket.state).toBe("open");
    const generation = abortListeners.listeners();
    expect(generation.length).toBeGreaterThan(0);

    controller.abort(ERR_ABORTED);
    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(socket.connection.generation).toBe(2);
    abortListeners.assertReleased(generation);
  });

  test("releases the open generation's abort listeners when the session is disposed", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const { client, observed } = clientObservingAbortListeners();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(client, useSocket(), {
      reconnect: { attempts: 1, delayMs: 0 },
    });
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    const abortListeners = observed.current;
    if (!socket || !lastMockInstance || !abortListeners) {
      throw new Error("Expected socket");
    }
    lastMockInstance.triggerClose({
      code: 1012,
      reason: "drop",
      wasClean: true,
    });
    await vi.waitFor(() => expect(mockInstances).toHaveLength(2));
    mockInstances[1]?.triggerOpen();
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    const generation = abortListeners.listeners();
    expect(socket.state).toBe("open");
    expect(generation.length).toBeGreaterThan(0);

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(socket.state).toBe("closed");
    expect(socket.connection.generation).toBe(2);
    abortListeners.assertReleased(generation);
    for (const nativeSocket of mockInstances) {
      expect(nativeSocket.listenerCount()).toBe(0);
    }
  });

  test("should reconnect after more recovered outages than the attempt budget", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const policyAttempts: number[] = [];
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: {
          attempts: 2,
          delayMs: 100,
          factor: 2,
          jitter: 0,
          shouldReconnect(context: { attempt: number }) {
            policyAttempts.push(context.attempt);
            return true;
          },
        },
      },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket) {
      throw new Error("Expected socket");
    }

    for (let drop = 0; drop < 3; drop += 1) {
      mockInstances[drop]?.triggerClose({
        code: 1012,
        reason: "drop",
        wasClean: true,
      });
      // Longer than a compounded delay, so a lifetime budget fails by refusing the next socket.
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockInstances).toHaveLength(drop + 2);
      mockInstances[drop + 1]?.triggerOpen();
      expect(socket.state).toBe("open");
      expect(socket.connection.generation).toBe(drop + 2);
    }

    expect(policyAttempts).toEqual([1, 1, 1]);
    expect(socket.state).toBe("open");

    socket.close(1000, "done");
    lastMockInstance?.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await socket.closed;
  });

  test("should use the base reconnect delay after each recovered outage", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 2, delayMs: 100, factor: 2, jitter: 0 },
      },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket) {
      throw new Error("Expected socket");
    }

    for (let generation = 1; generation <= 2; generation += 1) {
      mockInstances[generation - 1]?.triggerClose({
        code: 1012,
        reason: "drop",
        wasClean: true,
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(mockInstances).toHaveLength(generation);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockInstances).toHaveLength(generation + 1);
      mockInstances[generation]?.triggerOpen();
      expect(socket.state).toBe("open");
      expect(socket.connection.generation).toBe(generation + 1);
    }

    socket.close(1000, "done");
    lastMockInstance?.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await socket.closed;
  });

  test("should fail after a bounded grace when an errored socket never emits close", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    nativeSocket.triggerError();

    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(socket.closed).resolves.toMatchObject({
      cause: expect.any(Error),
      kind: "error",
    });
    await expect(pendingReceive).resolves.toMatchObject({
      message: "WebSocket connection error",
    });
    expect(socket.state).toBe("error");
    expect(mockInstances).toHaveLength(1);
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should settle an error attempt when native close throws synchronously", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeErrors: [new Error("close failed")] }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    lastMockInstance.triggerError();

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(socket.state).toBe("error");
    expect(lastMockInstance.close).toHaveBeenCalledTimes(1);
  });

  test("should finish without reconnecting or closing twice when error cleanup close throws", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeErrors: [new Error("close failed")] }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
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
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const failedSocket = lastMockInstance;

    failedSocket.triggerError();

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(socket.state).toBe("error");
    expect(mockInstances).toHaveLength(1);
    expect(failedSocket.close).toHaveBeenCalledTimes(1);
    expect(() => socket.send({ text: "late", type: "message" })).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
    expect(failedSocket.close).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["incoming", 0],
    ["incoming", -1],
    ["incoming", 1.5],
    ["incoming", Number.POSITIVE_INFINITY],
    ["incoming", Number.MAX_SAFE_INTEGER + 1],
    ["outgoing", -1],
    ["outgoing", 1.5],
    ["outgoing", Number.POSITIVE_INFINITY],
    ["outgoing", Number.MAX_SAFE_INTEGER + 1],
  ] as const)(
    "should reject unsafe %s queue limit %s before constructing a socket",
    async (kind, value) => {
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const definition = {
        incoming: struct.unknown(),
        maxIncomingQueueSize: kind === "incoming" ? value : 1,
        maxOutgoingQueueSize: kind === "outgoing" ? value : 0,
        path: "/ws/test",
      };
      const useSocket = defineWebSocket(definition as never);

      const [error, socket] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
      );

      expect(socket).toBeUndefined();
      expect(error).toMatchObject({ code: "REQ_OPTIONS_INVALID" });
      expect(lastMockInstance).toBeUndefined();
    },
  );

  test("should expose generation and native bufferedAmount", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    lastMockInstance.bufferedAmount = 23;
    expect(connection?.generation).toBe(1);
    expect(socket.connection.generation).toBe(1);
    expect(socket.bufferedAmount).toBe(23);

    socket.close(1000, "done");
    await socket.closed;
    expect(socket.bufferedAmount).toBe(0);
  });

  test("should keep the success tuple on generation one when an interceptor returns after reconnect", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const gate = createDeferred<void>();
    let interceptedSession: WebSocketSessionLike | undefined;
    const delayedInterceptor = createWebSocketInterceptor(
      async (request, next) => {
        interceptedSession = await next(request);
        await gate.promise;
        return interceptedSession;
      },
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(delayedInterceptor),
      ),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );

    await vi.waitFor(() =>
      expect(interceptedSession?.connection.generation).toBe(1),
    );
    const firstSocket = lastMockInstance;
    if (!firstSocket) {
      throw new Error("Expected first socket");
    }
    firstSocket.triggerClose({ code: 1012, reason: "restart", wasClean: true });
    await vi.waitFor(() =>
      expect(interceptedSession?.connection.generation).toBe(2),
    );
    gate.resolve(undefined);

    const [error, socket, startupConnection] = await executePromise;
    expect(error).toBeNull();
    expect(startupConnection?.generation).toBe(1);
    expect(socket?.connection.generation).toBe(2);
    socket?.close(1000, "done");
    await socket?.closed;
  });

  test("should reject a reconnect predicate getter failure before constructing a physical socket", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const getterFailure = new Error("reconnect predicate getter failed");
    const reconnect = {
      get shouldReconnect(): undefined {
        throw getterFailure;
      },
    };
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket, connection] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      { reconnect },
    );
    if (socket) {
      socket.close(1000, "cleanup");
      await socket.closed;
    }

    expect(error).toMatchObject({
      cause: getterFailure,
      code: "REQ_OPTIONS_INVALID",
    });
    expect(socket).toBeUndefined();
    expect(connection).toBeUndefined();
    expect(mockInstances).toHaveLength(0);
  });

  test("should snapshot the reconnect predicate before beforeConnect can mutate it", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const reconnect = {
      attempts: 1,
      delayMs: 0,
      shouldReconnect: () => false,
    };
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        beforeConnect() {
          reconnect.shouldReconnect = () => true;
        },
        reconnect,
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const firstSocket = lastMockInstance;

    firstSocket.triggerClose({ code: 1012, reason: "restart", wasClean: true });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1012,
      kind: "closed",
      reason: "restart",
    });
    expect(mockInstances).toHaveLength(1);
  });

  test("should settle a discarded interceptor session when native close never arrives", async () => {
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ emitCloseEvent: false }),
    );
    let discardedSession: WebSocketSessionLike | undefined;
    const replacementSession: WebSocketSessionLike = {
      bufferedAmount: 0,
      close() {},
      closed: Promise.resolve({ kind: "closed" }),
      connection: { generation: 99 },
      onRuntimeError: () => () => {},
      onStateChange: () => () => {},
      receive: {
        async *[Symbol.asyncIterator]() {},
      },
      send() {},
      state: "closed",
      [Symbol.asyncDispose]() {
        this.close();
        return this.closed.then(() => undefined);
      },
    };
    const interceptor = createWebSocketInterceptor(async (request, next) => {
      discardedSession = await next(request);
      return replacementSession;
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(interceptor),
      ),
      useSocket(),
    );
    expect(error).toBeNull();
    expect(socket).toBe(replacementSession);
    await expect(discardedSession?.closed).resolves.toMatchObject({
      kind: "aborted",
    });
    expect(lastMockInstance?.close).toHaveBeenCalledTimes(1);
  });

  test("should preserve an interceptor error after its created session already settled", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const interceptorFailure = new Error("interceptor failed after close");
    const interceptor = createWebSocketInterceptor(async (request, next) => {
      const createdSession = await next(request);
      createdSession.close(1000, "interceptor cleanup");
      await createdSession.closed;
      throw interceptorFailure;
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(interceptor),
      ),
      useSocket(),
    );

    expect(error).toMatchObject({
      cause: interceptorFailure,
      code: "EXT_INTERCEPTOR_FAILED",
    });
    expect(socket).toBeUndefined();
    expect(lastMockInstance?.close).toHaveBeenCalledTimes(1);
  });

  test("should settle a pending fire-and-forget interceptor session after a successful short circuit", async () => {
    const constructed = createDeferred<void>();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        autoOpen: false,
        onListenerRegistered() {
          constructed.resolve(undefined);
        },
      }),
    );
    const replacementSession: WebSocketSessionLike = {
      bufferedAmount: 0,
      close() {},
      closed: Promise.resolve({ kind: "closed" }),
      connection: { generation: 99 },
      onRuntimeError: () => () => {},
      onStateChange: () => () => {},
      receive: {
        async *[Symbol.asyncIterator]() {},
      },
      send() {},
      state: "closed",
      [Symbol.asyncDispose]() {
        this.close();
        return this.closed.then(() => undefined);
      },
    };
    const interceptor = createWebSocketInterceptor(async (request, next) => {
      void next(request);
      // next() constructs the socket on a later turn. Return only after it exists.
      await constructed.promise;
      return replacementSession;
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(interceptor),
      ),
      useSocket(),
    );

    expect(error).toBeNull();
    expect(socket).toBe(replacementSession);
    expect(lastMockInstance?.close).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(lastMockInstance?.readyState).toBe(3));
    await expect(replacementSession.closed).resolves.toMatchObject({
      kind: "closed",
    });
  });

  test("should reject next invoked after a successful interceptor chain settles without constructing a socket", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const lateCall = createDeferred<unknown>();
    const replacementSession: WebSocketSessionLike = {
      bufferedAmount: 0,
      close() {},
      closed: Promise.resolve({ kind: "closed" }),
      connection: { generation: 99 },
      onRuntimeError: () => () => {},
      onStateChange: () => () => {},
      receive: {
        async *[Symbol.asyncIterator]() {},
      },
      send() {},
      state: "closed",
      [Symbol.asyncDispose]() {
        this.close();
        return this.closed.then(() => undefined);
      },
    };
    let invokeLateNext: (() => void) | undefined;
    const interceptor = createWebSocketInterceptor(async (request, next) => {
      invokeLateNext = () => {
        void next(request).then(lateCall.resolve, lateCall.resolve);
      };
      return replacementSession;
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const [error, socket] = await run(
      createClient(
        withEndpoint("http://localhost"),
        withInterceptors(interceptor),
      ),
      useSocket(),
    );
    if (!invokeLateNext) {
      throw new Error("Expected the interceptor to capture next()");
    }
    invokeLateNext();
    const lateOutcome = await lateCall.promise;

    expect(error).toBeNull();
    expect(socket).toBe(replacementSession);
    expect(lateOutcome).toMatchObject({
      message:
        "WebSocket interceptor next() may not be called after the chain settles",
    });
    expect(mockInstances).toHaveLength(0);
    await expect(replacementSession.closed).resolves.toMatchObject({
      kind: "closed",
    });
  });

  test.each([1001, 2999, 5000, 3000.5, Number.POSITIVE_INFINITY])(
    "should reject invalid close code %s without changing session state",
    async (code) => {
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const useSocket = defineWebSocket({
        maxIncomingQueueSize: 1,
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const [, socket] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
      );
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }

      expect(() => socket.close(code)).toThrow(
        expect.objectContaining({ name: "InvalidAccessError" }),
      );
      expect(socket.state).toBe("open");
      expect(lastMockInstance.close).not.toHaveBeenCalled();

      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should reject a close reason over 123 UTF-8 bytes without changing session state", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    expect(() => socket.close(1000, `${"a".repeat(121)}猫`)).toThrow(
      expect.objectContaining({ name: "SyntaxError" }),
    );
    expect(socket.state).toBe("open");
    expect(lastMockInstance.close).not.toHaveBeenCalled();

    socket.close(1000, "done");
    await socket.closed;
  });

  test("should isolate state and runtime observer failures", async () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    const states: string[] = [];
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((error) => {
      runtimeErrors.push(error);
      throw new Error("runtime observer failed");
    });
    socket.onStateChange(() => {
      throw new Error("state observer failed");
    });
    socket.onStateChange((state) => states.push(state));

    socket.close(1000, "done");
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(states).toEqual(["closing", "closed"]);
    expect(runtimeErrors).toHaveLength(2);
    expect(reported).toHaveLength(2);
  });

  test("should route async state observer rejections through runtime observers without unhandled rejection", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }
    const stateFailure = new Error("async state observer failed");
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((error) => runtimeErrors.push(error));
    socket.onStateChange(async () => {
      throw stateFailure;
    });

    socket.close(1000, "done");
    await socket.closed;
    await Promise.resolve();
    await Promise.resolve();
    process.off("unhandledRejection", onUnhandled);

    expect(runtimeErrors).toEqual([stateFailure, stateFailure]);
    expect(unhandled).toEqual([]);
  });

  test("should report async runtime observer and reporter rejections without unhandled rejection", async () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", async (error: unknown) => {
      reported.push(error);
      throw new Error("async reporter failed");
    });
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }
    const runtimeFailure = new Error("async runtime observer failed");
    socket.onRuntimeError(async () => {
      throw runtimeFailure;
    });
    socket.onStateChange(() => {
      throw new Error("state observer failed");
    });

    socket.close(1000, "done");
    await socket.closed;
    await Promise.resolve();
    await Promise.resolve();
    process.off("unhandledRejection", onUnhandled);

    expect(reported).toEqual([runtimeFailure, runtimeFailure]);
    expect(unhandled).toEqual([]);
  });

  test("should isolate observer failures when the runtime has no reportError hook", async () => {
    vi.stubGlobal("reportError", undefined);
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    socket.onRuntimeError(() => {
      throw new Error("runtime observer failed without reportError");
    });
    socket.onStateChange(() => {
      throw new Error("observer failed without reportError");
    });
    socket.close(1000, "done");

    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(socket.state).toBe("closed");
  });

  test("should release observers and return one no-op unsubscribe after terminal", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    socket.onRuntimeError(vi.fn());
    socket.onStateChange(vi.fn());
    socket.close(1000, "done");
    await socket.closed;

    const unsubscribeRuntime = socket.onRuntimeError(vi.fn());
    const unsubscribeState = socket.onStateChange(vi.fn());

    expect(unsubscribeRuntime).toBe(unsubscribeState);
    expect(unsubscribeRuntime()).toBeUndefined();
  });

  test("should preserve physical message arrival order when Blob decodes finish out of order", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 2,
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const firstData = createDeferred<ArrayBuffer>();
    const secondData = createDeferred<ArrayBuffer>();
    const firstBlob = new Blob();
    const secondBlob = new Blob();
    vi.spyOn(firstBlob, "arrayBuffer").mockReturnValue(firstData.promise);
    vi.spyOn(secondBlob, "arrayBuffer").mockReturnValue(secondData.promise);
    const iterator = socket.receive[Symbol.asyncIterator]();

    lastMockInstance.triggerMessage(firstBlob);
    lastMockInstance.triggerMessage(secondBlob);
    secondData.resolve(encodeMessage({ text: "second", type: "message" }));
    await Promise.resolve();
    firstData.resolve(encodeMessage({ text: "first", type: "message" }));

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "first", type: "message" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "second", type: "message" },
    });
    socket.close(1000, "done");
    await socket.closed;
  });

  test("should deliver an arrived Blob frame before the following native close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const data = createDeferred<ArrayBuffer>();
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(data.promise);
    const iterator = socket.receive[Symbol.asyncIterator]();

    lastMockInstance.triggerMessage(blob);
    lastMockInstance.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    lastMockInstance.triggerClose({
      code: 1000,
      reason: "duplicate",
      wasClean: true,
    });
    data.resolve(encodeMessage({ text: "before close", type: "message" }));

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: "before close", type: "message" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
  });

  test("should classify an arrived heartbeat ack while draining after native close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck: (message: { type: string }) => message.type === "pong",
        },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const data = createDeferred<ArrayBuffer>();
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(data.promise);
    const iterator = socket.receive[Symbol.asyncIterator]();

    lastMockInstance.triggerMessage(blob);
    lastMockInstance.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    data.resolve(encodeMessage({ ok: true, type: "pong" }));

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
  });

  test("should retain the heartbeat classifier while draining an arrived ack after manual close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({
        type: struct.literal("pong"),
        ok: struct.boolean(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        heartbeat: {
          intervalMs: 1_000,
          isAck: (message: { type: string }) => message.type === "pong",
        },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const data = createDeferred<ArrayBuffer>();
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(data.promise);
    const iterator = socket.receive[Symbol.asyncIterator]();

    lastMockInstance.triggerMessage(blob);
    socket.close(1000, "owner done");
    await new Promise((resolve) => setTimeout(resolve, 0));
    data.resolve(encodeMessage({ ok: true, type: "pong" }));

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner done",
    });
  });

  test("should terminate when undecoded raw frames exceed the endpoint bound", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 2,
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const blockedBlob = new Blob();
    vi.spyOn(blockedBlob, "arrayBuffer").mockReturnValue(
      new Promise<ArrayBuffer>(() => undefined),
    );
    lastMockInstance.triggerMessage(blockedBlob);
    for (let index = 0; index < 3; index += 1) {
      lastMockInstance.triggerMessage(
        JSON.stringify({ text: `queued-${index}`, type: "message" }),
      );
    }

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(socket.state).toBe("error");
  });

  test("should not wait for a blocked Blob after a native error close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 2,
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const blockedBlob = new Blob();
    vi.spyOn(blockedBlob, "arrayBuffer").mockReturnValue(
      new Promise<ArrayBuffer>(() => undefined),
    );
    lastMockInstance.triggerMessage(blockedBlob);
    lastMockInstance.triggerError();

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    expect(socket.state).toBe("error");
  });

  test.each(["error", "close"] as const)(
    "should settle a native %s as closed when the reconnect predicate explicitly declines",
    async (eventKind) => {
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const predicate = vi.fn(() => false);
      const useSocket = defineWebSocket({
        maxIncomingQueueSize: 1,
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const [, socket] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
        {
          reconnect: { attempts: 1, delayMs: 0, shouldReconnect: predicate },
        },
      );
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }
      const pendingReceive = socket.receive[Symbol.asyncIterator]().next();

      if (eventKind === "error") {
        lastMockInstance.triggerError();
      } else {
        lastMockInstance.triggerClose({
          code: 1012,
          reason: "restart",
          wasClean: true,
        });
      }

      await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
      await expect(pendingReceive).resolves.toEqual({
        done: true,
        value: undefined,
      });
      expect(socket.state).toBe("closed");
      expect(predicate).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["return false", "throw"] as const)(
    "should prefer an abort when reconnect policy callbacks %s after aborting",
    async (policyOutcome) => {
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const controller = new AbortController();
      const useSocket = defineWebSocket({
        maxIncomingQueueSize: 1,
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const predicate = vi.fn(() => {
        controller.abort(ERR_ABORTED);
        if (policyOutcome === "throw") {
          throw new Error("policy failed after abort");
        }
        return false;
      });
      const [, socket] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
        {
          reconnect: { attempts: 1, delayMs: 0, shouldReconnect: predicate },
          signal: controller.signal,
        },
      );
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }
      const pendingReceive = socket.receive[Symbol.asyncIterator]()
        .next()
        .catch((error: unknown) => error);

      lastMockInstance.triggerClose({
        code: 1012,
        reason: "restart",
        wasClean: true,
      });

      await expect(socket.closed).resolves.toMatchObject({
        cause: ERR_ABORTED,
        kind: "aborted",
      });
      await expect(pendingReceive).resolves.toBe(ERR_ABORTED);
      expect(socket.state).toBe("aborted");
      expect(predicate).toHaveBeenCalledTimes(1);
      expect(mockInstances).toHaveLength(1);
    },
  );

  test("should preserve terminal state when reconnect predicate closes the session and returns true", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    let exposedSocket: SocketAwaitResult<unknown, unknown>[1];
    const predicate = vi.fn(() => {
      exposedSocket?.close(1000, "owner declined");
      return true;
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0, shouldReconnect: predicate },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    exposedSocket = socket;

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });

    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.state).toBe("closed");
    expect(mockInstances).toHaveLength(1);
    expect(predicate).toHaveBeenCalledTimes(1);
  });

  test("should preserve owner close when reconnect predicate throws after closing the session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    let exposedSocket: SocketAwaitResult<unknown, unknown>[1];
    const predicate = vi.fn(() => {
      exposedSocket?.close(1000, "owner declined");
      throw new Error("ignored after owner close");
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0, shouldReconnect: predicate },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    exposedSocket = socket;

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner declined",
    });
    expect(socket.state).toBe("closed");
    expect(mockInstances).toHaveLength(1);
    expect(predicate).toHaveBeenCalledTimes(1);
  });

  test("should preserve an abort triggered by an observer during replacement open", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
        signal: controller.signal,
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    socket.onStateChange((state) => {
      if (state === "open" && socket.connection.generation === 2) {
        controller.abort(ERR_ABORTED);
      }
    });

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(mockInstances).toHaveLength(2);
  });

  test("should stop reconnect work when a reconnecting observer closes the logical session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: {
          attempts: 1,
          delayMs: Number.MAX_VALUE,
          jitter: 1,
          maxDelayMs: Number.MAX_VALUE,
        },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    socket.onStateChange((state) => {
      if (state === "reconnecting") {
        socket.close(1000, "observer stopped reconnect");
      }
    });

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
    const closeInfo = await socket.closed;

    expect(closeInfo).toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "observer stopped reconnect",
    });
    expect(socket.state).toBe("closed");
    expect(random).not.toHaveBeenCalled();
    expect(mockInstances).toHaveLength(1);
    random.mockRestore();
  });

  test("should prefer observer abort over reconnect jitter overflow", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: {
          attempts: 1,
          delayMs: Number.MAX_VALUE,
          jitter: 1,
          maxDelayMs: Number.MAX_VALUE,
        },
        signal: controller.signal,
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    socket.onStateChange((state) => {
      if (state === "reconnecting") {
        controller.abort(ERR_ABORTED);
      }
    });

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
    const closeInfo = await socket.closed;

    expect(closeInfo).toMatchObject({ cause: ERR_ABORTED, kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(random).not.toHaveBeenCalled();
    expect(mockInstances).toHaveLength(1);
    random.mockRestore();
  });

  test("should not settle twice when owner close interrupts an active reconnect delay", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const reconnecting = createDeferred<void>();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 1_000 },
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
    socket.close(1000, "owner stopped delay");

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "owner stopped delay",
    });
    expect(socket.state).toBe("closed");
    expect(mockInstances).toHaveLength(1);
  });

  test("should saturate finite reconnect jitter overflow at the timer limit and finish after reconnecting", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: {
          attempts: 1,
          delayMs: Number.MAX_VALUE,
          jitter: 1,
          maxDelayMs: Number.MAX_VALUE,
        },
      },
    );
    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });
    await vi.advanceTimersByTimeAsync(2_147_483_646);
    expect(socket.state).toBe("reconnecting");
    expect(mockInstances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockInstances).toHaveLength(2);
    lastMockInstance.triggerOpen();
    expect(socket.state).toBe("open");
    expect(socket.connection.generation).toBe(2);

    // The open above restored the per-outage budget, so this close has to be the session's own.
    socket.close(1000, "done");
    lastMockInstance.triggerClose({
      code: 1000,
      reason: "done",
      wasClean: true,
    });
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "done",
    });
    await expect(pendingReceive).resolves.toMatchObject({ done: true });
    expect(socket.state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
    random.mockRestore();
  });

  test("should skip post-open setup when an observer closes the replacement", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    socket.onStateChange((state) => {
      if (state === "open" && socket.connection.generation === 2) {
        socket.close(1000, "observer stopped replacement");
      }
    });

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "observer stopped replacement",
    });
    expect(socket.state).toBe("closed");
    expect(mockInstances).toHaveLength(2);
  });

  test("should fail the logical session and discard buffered messages on incoming overflow", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    const iterator = socket.receive[Symbol.asyncIterator]();
    lastMockInstance.triggerMessage(
      JSON.stringify({ type: "message", text: "first" }),
    );
    lastMockInstance.triggerMessage(
      JSON.stringify({ type: "message", text: "second" }),
    );

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    await expect(iterator.next()).rejects.toThrow("AsyncQueue overflow");
    expect(socket.state).toBe("error");
  });

  test("should abort-race beforeConnect and consume its late rejection", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const contexts: Array<{ attempt: number; signal: AbortSignal }> = [];
    let rejectHook: ((reason: unknown) => void) | undefined;
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });

    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        beforeConnect(context: { attempt: number; signal: AbortSignal }) {
          contexts.push(context);
          return new Promise<void>((_resolve, reject) => {
            rejectHook = reject;
          });
        },
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    controller.abort(ERR_ABORTED);
    const result = await executePromise;

    expect(contexts[0]?.attempt).toBe(0);
    expect(contexts[0]?.signal.aborted).toBe(true);
    expect(lastMockInstance).toBeUndefined();
    expect(result[0]).toMatchObject({ code: "NET_ABORTED" });

    rejectHook?.(new Error("late hook rejection"));
    await Promise.resolve();
    await Promise.resolve();
  });

  test("should settle the active attempt when abort close cannot produce a close event", async () => {
    const closeFailure = new Error("native close failed");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeErrors: [closeFailure] }),
    );
    const controller = new AbortController();
    const shouldReconnect = vi.fn(() => true);
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0, shouldReconnect },
        signal: controller.signal,
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    controller.abort(ERR_ABORTED);

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    await Promise.resolve();
    expect(lastMockInstance.close).toHaveBeenCalledTimes(1);
    expect(shouldReconnect).not.toHaveBeenCalled();
  });

  test("should preserve the last opened connection snapshot when aborting a connecting replacement", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(mockInstances).toHaveLength(1));
    const firstSocket = mockInstances[0];
    if (!firstSocket) {
      throw new Error("Expected first socket");
    }
    firstSocket.protocol = "first";
    firstSocket.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket) {
      throw new Error("Expected logical session");
    }
    const openedConnection = socket.connection;

    firstSocket.triggerClose({ code: 1012, reason: "restart", wasClean: true });
    await vi.waitFor(() => expect(mockInstances).toHaveLength(2));
    const replacement = mockInstances[1];
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }
    replacement.protocol = "replacement";
    controller.abort(ERR_ABORTED);

    await expect(socket.closed).resolves.toMatchObject({ kind: "aborted" });
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.connection).toEqual(openedConnection);
    expect(socket.connection).toMatchObject({
      generation: 1,
      protocol: "first",
    });
  });

  test("should use one fallback close, rethrow the first error, and wait for the close event", async () => {
    const firstFailure = new Error("first close failed");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeErrors: [firstFailure] }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }

    expect(() => socket.close(3000, "owner close")).toThrow(firstFailure);
    expect(socket.state).toBe("closing");
    expect(lastMockInstance.close).toHaveBeenCalledTimes(2);
    expect(() => socket.close(200, "invalid while closing")).toThrow(
      expect.objectContaining({ name: "InvalidAccessError" }),
    );
    expect(lastMockInstance.close).toHaveBeenCalledTimes(2);
    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
      reason: "",
    });
    expect(lastMockInstance.close).toHaveBeenCalledTimes(2);
  });

  test("should settle error after both native close calls throw without a third attempt", async () => {
    const firstFailure = new Error("first close failed");
    const fallbackFailure = new Error("fallback close failed");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        closeErrors: [firstFailure, fallbackFailure],
      }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;

    expect(() => socket.close(3000, "owner close")).toThrow(firstFailure);
    const closed = await socket.closed;
    expect(closed).toMatchObject({ cause: firstFailure, kind: "error" });
    expect(socket.state).toBe("error");
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expect(() => socket.close(3001, "again")).not.toThrow();
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expect(() => socket.close(200, "invalid after terminal")).toThrow(
      expect.objectContaining({ name: "InvalidAccessError" }),
    );
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);

    const removeEventListener = vi.spyOn(nativeSocket, "removeEventListener");
    nativeSocket.triggerClose({
      code: 1000,
      reason: "late physical close",
      wasClean: true,
    });
    const removeEventListenerCallsAfterClose =
      removeEventListener.mock.calls.length;
    expect(socket.bufferedAmount).toBe(0);
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expect(nativeSocket.listenerCount()).toBe(0);

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toBe(closed);
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expect(removeEventListener).toHaveBeenCalledTimes(
      removeEventListenerCallsAfterClose,
    );
    expect(nativeSocket.listenerCount()).toBe(0);
  });

  test.each([1000, 3000, 4999])("should accept close code %s", async (code) => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    expect(() => socket.close(code, "accepted")).not.toThrow();
    await expect(socket.closed).resolves.toMatchObject({
      code,
      kind: "closed",
      reason: "accepted",
    });
  });

  test("should accept a 123-byte UTF-8 close reason", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }
    const reason = `${"a".repeat(120)}猫`;

    expect(() => socket.close(1000, reason)).not.toThrow();
    await expect(socket.closed).resolves.toMatchObject({
      kind: "closed",
      reason,
    });
  });

  test("should expose a single-consumer receive iterable and reject sends after terminal", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    socket.receive[Symbol.asyncIterator]();
    expect(() => socket.receive[Symbol.asyncIterator]()).toThrow(
      new TypeError("AsyncQueue supports one consumer"),
    );
    socket.close(1000, "done");
    await socket.closed;
    expect(() => socket.send({ type: "message", text: "late" })).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
  });

  test("should not send on the captured open socket when outgoing serialization aborts the session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
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
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ closeEventDelayMs: 30 }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
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
      useSocket(),
    );
    if (!socket) {
      throw new Error("Expected socket");
    }

    socket.close(1000, "done");
    expect(() => socket.send({ text: "late", type: "message" })).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
    await socket.closed;
  });

  test("should reject sends after remote close before its reconnect predicate settles", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
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
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0, shouldReconnect: () => false },
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
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
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
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 30 },
      },
    );
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
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
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
    await socket.closed;
  });

  test("should reject an undefined JSON message before it enters the reconnect queue", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      maxOutgoingQueueSize: 2,
      incoming: struct.unknown(),
      outgoing: struct.string().optional(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 30 },
      },
    );
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
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    const replacement = lastMockInstance;
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }

    expect(sendError).toEqual(
      new TypeError("Outgoing WebSocket message has no JSON representation"),
    );
    expect(replacement.send).not.toHaveBeenCalled();
    socket.close(1000, "done");
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
        maxIncomingQueueSize: 1,
        outgoing: outgoing as never,
        path: "/ws/test",
      });
      const [, socket] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
      );
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }

      expect(() => socket.send(message as never)).toThrow(TypeError);
      expect(() => socket.send(message as never)).toThrow(fragment);
      expect(lastMockInstance.send).not.toHaveBeenCalled();

      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should reject a non-JSON message before it enters the reconnect queue", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      maxOutgoingQueueSize: 2,
      outgoing: struct.object({ n: struct.number() }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 30 },
      },
    );
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
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    const replacement = lastMockInstance;
    if (!replacement) {
      throw new Error("Expected replacement socket");
    }

    expect(sendError).toBeInstanceOf(TypeError);
    expect(sendError).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'Outgoing WebSocket message field "n" is not JSON data: -Infinity',
        ),
      }),
    );
    expect(replacement.send).not.toHaveBeenCalled();
    socket.close(1000, "done");
    await socket.closed;
  });

  test.each(["abort", "close"] as const)(
    "should not publish replacement open after native flush synchronously triggers %s",
    async (action) => {
      const controller = new AbortController();
      let exposedSocket: SocketAwaitResult<unknown, unknown>[1];
      vi.stubGlobal(
        "WebSocket",
        createMockWebSocketClass({
          onSend() {
            if (mockInstances.length !== 2) {
              return;
            }
            if (action === "abort") {
              controller.abort(ERR_ABORTED);
            } else {
              exposedSocket?.close(1000, "flush owner close");
            }
          },
        }),
      );
      const useSocket = defineWebSocket({
        maxIncomingQueueSize: 1,
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
        useSocket(),
        {
          reconnect: { attempts: 1, delayMs: 0 },
          signal: controller.signal,
        },
      );
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }
      exposedSocket = socket;
      const replacementStates: string[] = [];
      socket.onStateChange((state) => {
        if (socket.connection.generation === 2) {
          replacementStates.push(state);
        }
        if (state === "reconnecting") {
          socket.send({ text: "queued", type: "message" });
        }
      });

      lastMockInstance.triggerClose({
        code: 1012,
        reason: "restart",
        wasClean: true,
      });

      await expect(socket.closed).resolves.toMatchObject(
        action === "abort"
          ? { cause: ERR_ABORTED, kind: "aborted" }
          : { code: 1000, kind: "closed", reason: "flush owner close" },
      );
      expect(replacementStates).not.toContain("open");
      expect(socket.state).toBe(action === "abort" ? "aborted" : "closed");
      expect(mockInstances).toHaveLength(2);
      expect(mockInstances[1]?.send).toHaveBeenCalledTimes(1);
    },
  );

  test("should not enqueue a reconnect frame when outgoing serialization aborts the session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const reconnecting = createDeferred<void>();
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
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
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 1_000 },
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

  test("should not deliver a stale reconnecting state after a listener closes reentrantly", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 30 },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const laterListenerStates: string[] = [];
    socket.onStateChange((state) => {
      if (state === "reconnecting") socket.close(1000, "owner stopped");
    });
    socket.onStateChange((state) => laterListenerStates.push(state));

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });

    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    expect(laterListenerStates).toEqual(["closing", "closed"]);
    expect(socket.state).toBe("closed");
    expect(mockInstances).toHaveLength(1);
  });

  test("should terminate after a reconnect beforeConnect failure and reject pending receive", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const attempts: number[] = [];
    const hookFailure = new Error("refresh failed");
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        beforeConnect({ attempt }: { attempt: number }) {
          attempts.push(attempt);
          if (attempt === 1) {
            throw hookFailure;
          }
        },
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const pending = socket.receive[Symbol.asyncIterator]().next();

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });

    await expect(socket.closed).resolves.toMatchObject({ kind: "error" });
    await expect(pending).rejects.toMatchObject({ code: "EXT_HOOK_FAILED" });
    expect(socket.state).toBe("error");
    expect(attempts).toEqual([0, 1]);
    expect(mockInstances).toHaveLength(1);
  });

  test("should terminate when reconnect policy throws and reject pending receive", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const policyFailure = new Error("policy failed");
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: {
          attempts: 1,
          delayMs: 0,
          shouldReconnect() {
            throw policyFailure;
          },
        },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const pending = socket.receive[Symbol.asyncIterator]().next();

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });

    await expect(socket.closed).resolves.toMatchObject({
      cause: policyFailure,
      kind: "error",
    });
    await expect(pending).rejects.toBe(policyFailure);
    expect(socket.state).toBe("error");
  });

  test("should reject startup when reconnect policy throws after a pre-open close", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const policyFailure = new Error("pre-open policy failed");
    const predicate = vi.fn(() => {
      throw policyFailure;
    });
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0, shouldReconnect: predicate },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerClose({
      code: 1006,
      reason: "closed before open",
      wasClean: false,
    });

    const [error, socket, connection] = await executePromise;
    expect(error).toMatchObject({
      cause: policyFailure,
      code: "NET_UNREACHABLE",
    });
    expect(socket).toBeUndefined();
    expect(connection).toMatchObject({ generation: 0 });
    expect(predicate).toHaveBeenCalledTimes(1);
    expect(mockInstances).toHaveLength(1);
  });

  test("should fail receive with AbortError when a post-open reconnect policy throws undefined", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: {
          attempts: 1,
          delayMs: 0,
          shouldReconnect() {
            throw undefined;
          },
        },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    lastMockInstance.triggerClose({
      code: 1012,
      reason: "restart",
      wasClean: true,
    });

    await expect(socket.closed).resolves.toEqual({
      cause: undefined,
      code: 1012,
      kind: "error",
      reason: "restart",
      wasClean: true,
    });
    await expect(pendingReceive).resolves.toMatchObject({ name: "AbortError" });
    expect(socket.state).toBe("error");
  });

  test.each([
    createPreflightFault(
      "REQ_OPTIONS_INVALID",
      new Error("invalid reconnect policy"),
    ),
    createUndecodedHttpStatusFault({
      headers: new Headers(),
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      url: "http://localhost/ws/test",
    }),
    createNetworkFault(new Error("reconnect policy offline")),
  ])(
    "should preserve a $code fault thrown by the reconnect policy",
    async (policyFailure) => {
      vi.stubGlobal("WebSocket", createMockWebSocketClass());
      const useSocket = defineWebSocket({
        maxIncomingQueueSize: 1,
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const [, socket] = await run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
        {
          reconnect: {
            attempts: 1,
            delayMs: 0,
            shouldReconnect() {
              throw policyFailure;
            },
          },
        },
      );
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }
      const pending = socket.receive[Symbol.asyncIterator]().next();

      lastMockInstance.triggerClose({
        code: 1012,
        reason: "restart",
        wasClean: true,
      });

      await expect(socket.closed).resolves.toMatchObject({
        cause: policyFailure,
        kind: "error",
      });
      await expect(pending).rejects.toBe(policyFailure);
      expect(socket.state).toBe("error");
    },
  );

  test("should not replay a frame after a physical reconnect", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("mutation"),
        id: struct.number(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        reconnect: { attempts: 1, delayMs: 0 },
      },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const firstSocket = lastMockInstance;

    socket.send({ id: 1, type: "mutation" });
    firstSocket.triggerClose({ code: 1012, reason: "restart", wasClean: true });
    await vi.waitFor(() => expect(socket.connection.generation).toBe(2));
    const secondSocket = lastMockInstance;
    if (!secondSocket || secondSocket === firstSocket) {
      throw new Error("Expected a replacement socket");
    }

    expect(firstSocket.send).toHaveBeenCalledTimes(1);
    expect(secondSocket.send).not.toHaveBeenCalled();
    socket.send({ id: 2, type: "mutation" });
    expect(secondSocket.send).toHaveBeenCalledTimes(1);
    socket.close(1000, "done");
    await socket.closed;
  });

  test("should disable outgoing buffering by default during reconnect preparation", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const attempts: number[] = [];
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        beforeConnect({ attempt }: { attempt: number }) {
          attempts.push(attempt);
          if (attempt === 1) {
            return new Promise<void>(() => undefined);
          }
        },
        reconnect: { attempts: 1, delayMs: 0 },
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

  test("should cache one disposal promise and wait for native close plus lifecycle teardown", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, closeEventDelayMs: 25 }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    let firstDispose: PromiseLike<void> | undefined;

    expect(() => {
      firstDispose = socket[Symbol.asyncDispose]();
    }).not.toThrow();
    const secondDispose = socket[Symbol.asyncDispose]();

    expect(firstDispose).toBe(secondDispose);
    expect(nativeSocket.close).not.toHaveBeenCalled();
    let settled = false;
    const disposal = Promise.resolve(firstDispose).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(nativeSocket.listenerCount()).toBeGreaterThan(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(24);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(disposal).resolves.toBeUndefined();

    await expect(socket.closed).resolves.toMatchObject({
      code: 1000,
      kind: "closed",
    });
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    expect(nativeSocket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should stop reconnect and heartbeat timers when disposed during reconnect delay", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      outgoing: struct.object({ type: struct.literal("ping") }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      {
        heartbeat: { intervalMs: 50, message: () => ({ type: "ping" }) },
        reconnect: { attempts: 1, delayMs: 1_000 },
      },
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const firstSocket = lastMockInstance;
    expect(vi.getTimerCount()).toBe(1);

    firstSocket.triggerClose({ code: 1012, reason: "restart", wasClean: true });
    await vi.waitFor(() => expect(socket.state).toBe("reconnecting"));
    expect(vi.getTimerCount()).toBe(1);

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    expect(socket.state).toBe("closed");
    expect(firstSocket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockInstances).toHaveLength(1);
  });

  test("should abort a blocked blob decode and wait for the message pump before disposal resolves", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({
        ok: struct.boolean(),
        type: struct.literal("known"),
      }),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    const blob = new Blob(['{"ok":true,"type":"known"}']);
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(
      new Promise<ArrayBuffer>(() => undefined),
    );

    nativeSocket.triggerMessage(blob);

    const disposed = Promise.resolve(socket[Symbol.asyncDispose]()).then(
      () => true,
      () => false,
    );
    await expect(disposed).resolves.toBe(true);

    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(nativeSocket.listenerCount()).toBe(0);
  });

  test("should preserve an observed remote close when disposal starts after a blocked message pump", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", createMockWebSocketClass({ autoOpen: false }));
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.object({
        ok: struct.boolean(),
        type: struct.literal("known"),
      }),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    const blob = new Blob(['{"ok":true,"type":"known"}']);
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(
      new Promise<ArrayBuffer>(() => undefined),
    );

    nativeSocket.triggerMessage(blob);
    nativeSocket.triggerClose({
      code: 1000,
      reason: "remote-finished",
      wasClean: true,
    });

    const disposal = Promise.resolve(socket[Symbol.asyncDispose]()).then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(disposal).resolves.toEqual({ status: "resolved" });
    await expect(socket.closed).resolves.toEqual({
      code: 1000,
      kind: "closed",
      reason: "remote-finished",
      wasClean: true,
    });
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(nativeSocket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("should reject only disposal with TimeoutError when native close never arrives", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({ autoOpen: false, emitCloseEvent: false }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
    const disposal = Promise.resolve(socket[Symbol.asyncDispose]()).then(
      () => ({ error: undefined, status: "resolved" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    let outcome: Awaited<typeof disposal> | undefined;
    void disposal.then((value) => {
      outcome = value;
    });
    await Promise.resolve();

    expect(nativeSocket.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    const result = await disposal;

    expect(result.status).toBe("rejected");
    expect(result.error).toBeInstanceOf(DOMException);
    expect(result.error).toMatchObject({
      message: "WebSocket close event was not observed before teardown timeout",
      name: "TimeoutError",
    });
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(socket.state).toBe("closed");
    expect(nativeSocket.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    ["Error", new Error("native close failed")],
    ["undefined", undefined],
  ] as const)(
    "should preserve a thrown %s close value over disposal timeout and still clean up",
    async (_label, closeFailure) => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "WebSocket",
        createMockWebSocketClass({
          autoOpen: false,
          closeErrors: [closeFailure],
          emitCloseEvent: false,
        }),
      );
      const useSocket = defineWebSocket({
        maxIncomingQueueSize: 1,
        incoming: struct.unknown(),
        path: "/ws/test",
      });
      const executePromise = run(
        createClient(withEndpoint("http://localhost")),
        useSocket(),
      );

      await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
      lastMockInstance?.triggerOpen();
      const [, socket] = await executePromise;
      if (!socket || !lastMockInstance) {
        throw new Error("Expected socket");
      }
      const nativeSocket = lastMockInstance;
      const pendingReceive = socket.receive[Symbol.asyncIterator]().next();
      let disposeTask: PromiseLike<void> | undefined;

      expect(() => {
        disposeTask = socket[Symbol.asyncDispose]();
      }).not.toThrow();
      const disposal = Promise.resolve(disposeTask).then(
        () => ({ cause: undefined, status: "resolved" as const }),
        (cause: unknown) => ({ cause, status: "rejected" as const }),
      );
      await Promise.resolve();

      expect(nativeSocket.close).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await disposal;

      expect(result.status).toBe("rejected");
      expect(result.cause).toBe(closeFailure);
      await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
      await expect(pendingReceive).resolves.toEqual({
        done: true,
        value: undefined,
      });
      expect(socket.state).toBe("closed");
      expect(nativeSocket.listenerCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test("should detach physical cleanup after both native close attempts throw", async () => {
    const firstFailure = new Error("first close failed");
    const fallbackFailure = new Error("fallback close failed");
    vi.stubGlobal(
      "WebSocket",
      createMockWebSocketClass({
        autoOpen: false,
        closeErrors: [firstFailure, fallbackFailure],
        emitCloseEvent: false,
      }),
    );
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const executePromise = run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );

    await vi.waitFor(() => expect(lastMockInstance).toBeDefined());
    lastMockInstance?.triggerOpen();
    const [, socket] = await executePromise;
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    nativeSocket.bufferedAmount = 17;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    await expect(Promise.resolve(socket[Symbol.asyncDispose]())).rejects.toBe(
      firstFailure,
    );

    await expect(socket.closed).resolves.toMatchObject({
      cause: firstFailure,
      kind: "error",
    });
    await expect(pendingReceive).resolves.toBe(firstFailure);
    expect(nativeSocket.close).toHaveBeenCalledTimes(2);
    expect(nativeSocket.listenerCount()).toBe(0);
    expect(socket.bufferedAmount).toBe(0);
  });

  test("should only await teardown when disposing an already aborted session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const controller = new AbortController();
    const abortCause = new Error("owner aborted");
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
      { signal: controller.signal },
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    controller.abort(abortCause);
    const terminal = await socket.closed;
    await expect(pendingReceive).resolves.toBe(abortCause);
    const closeCalls = vi.mocked(nativeSocket.close).mock.calls.length;

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toBe(terminal);
    expect(terminal).toMatchObject({ cause: abortCause, kind: "aborted" });
    expect(socket.state).toBe("aborted");
    expect(nativeSocket.close).toHaveBeenCalledTimes(closeCalls);
    expect(nativeSocket.listenerCount()).toBe(0);
  });

  test("should only await teardown when disposing an already errored session", async () => {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 1,
      incoming: struct.unknown(),
      path: "/ws/test",
    });
    const [, socket] = await run(
      createClient(withEndpoint("http://localhost")),
      useSocket(),
    );
    if (!socket || !lastMockInstance) {
      throw new Error("Expected socket");
    }
    const nativeSocket = lastMockInstance;
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    nativeSocket.triggerError();
    const terminal = await socket.closed;
    await expect(pendingReceive).resolves.toMatchObject({
      message: "WebSocket connection error",
    });
    const closeCalls = vi.mocked(nativeSocket.close).mock.calls.length;

    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(socket.closed).resolves.toBe(terminal);
    expect(terminal).toMatchObject({ cause: expect.any(Error), kind: "error" });
    expect(socket.state).toBe("error");
    expect(nativeSocket.close).toHaveBeenCalledTimes(closeCalls);
    expect(nativeSocket.listenerCount()).toBe(0);
  });
});

describe("web socket incoming frame path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lastMockInstance = undefined;
    mockInstances = [];
  });

  const useSocket = defineWebSocket({
    incoming: struct.object({
      text: struct.string(),
      type: struct.literal("message"),
    }),
    maxIncomingQueueSize: 8,
    path: "/ws/test",
  });

  function frame(text: string): string {
    return JSON.stringify({ text, type: "message" });
  }

  function textOf(message: unknown): string {
    return (message as { text: string }).text;
  }

  function nextTurn(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function watchSettled(promise: Promise<unknown>): () => boolean {
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    return () => settled;
  }

  // A Blob whose bytes arrive when the test says so.
  function blobOf(bytes: Promise<ArrayBuffer>): Blob {
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockReturnValue(bytes);
    return blob;
  }

  // Junk before and after the frame: a decoder that ignores the view's window reads it and fails to parse.
  function windowed(
    text: string,
    createView: (
      buffer: ArrayBuffer,
      offset: number,
      byteLength: number,
    ) => ArrayBufferView,
  ) {
    const bytes = new TextEncoder().encode(text);
    const padding = 8;
    const buffer = new ArrayBuffer(padding + bytes.length + padding);
    new Uint8Array(buffer).fill(0x7a);
    new Uint8Array(buffer, padding, bytes.length).set(bytes);
    return createView(buffer, padding, bytes.length);
  }

  async function openSession(options?: { signal?: AbortSignal }) {
    vi.stubGlobal("WebSocket", createMockWebSocketClass());
    const [error, socket] = (await createClient(
      withEndpoint("http://localhost"),
    ).execute(useSocket(), options as never)) as SocketAwaitResult<
      unknown,
      unknown
    >;
    expect(error).toBeNull();
    const native = lastMockInstance;
    if (!socket || !native) {
      throw new Error("Expected an open session");
    }
    return { native, socket };
  }

  test.each([
    ["text", (json: string) => json],
    ["ArrayBuffer", (json: string) => new TextEncoder().encode(json).buffer],
    ["Uint8Array", (json: string) => new TextEncoder().encode(json)],
  ])(
    "should deliver %s frames within one microtask turn",
    async (_kind, createFrame) => {
      const { native, socket } = await openSession();
      const pending = socket.receive[Symbol.asyncIterator]().next();
      const delivered = watchSettled(pending);

      native.triggerMessage(createFrame(frame("now")));
      await Promise.resolve();

      // A frame that needs no read is decoded and queued without waiting for another turn.
      expect(delivered()).toBe(true);
      await expect(pending).resolves.toEqual({
        done: false,
        value: { text: "now", type: "message" },
      });
      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should deliver frames in arrival order while a Blob frame is still being read", async () => {
    const { native, socket } = await openSession();
    const blobBytes = createDeferred<ArrayBuffer>();
    const received: string[] = [];
    const consumed = (async () => {
      for await (const message of socket.receive) {
        received.push(textOf(message));
      }
    })();

    native.triggerMessage(frame("a"));
    native.triggerMessage(blobOf(blobBytes.promise));
    native.triggerMessage(frame("c"));
    native.triggerMessage(new TextEncoder().encode(frame("d")).buffer);
    await nextTurn();

    // "c" and "d" need no read, but they arrived after the Blob and must not overtake it.
    expect(received).toEqual(["a"]);

    blobBytes.resolve(encodeMessage({ text: "b", type: "message" }));
    await vi.waitFor(() => expect(received).toEqual(["a", "b", "c", "d"]));

    socket.close(1000, "done");
    await consumed;
  });

  test.each([
    [
      "Uint8Array",
      (buffer: ArrayBuffer, offset: number, byteLength: number) =>
        new Uint8Array(buffer, offset, byteLength),
    ],
    [
      "DataView",
      (buffer: ArrayBuffer, offset: number, byteLength: number) =>
        new DataView(buffer, offset, byteLength),
    ],
    // Two bytes per element: the window is measured in bytes, not elements.
    [
      "Uint16Array",
      (buffer: ArrayBuffer, offset: number, byteLength: number) =>
        new Uint16Array(buffer, offset, byteLength / 2),
    ],
  ])(
    "should decode only the window of a %s frame",
    async (_kind, createView) => {
      const { native, socket } = await openSession();
      const runtimeErrors: unknown[] = [];
      socket.onRuntimeError((error) => {
        runtimeErrors.push(error);
      });
      const pending = socket.receive[Symbol.asyncIterator]().next();

      // The two-byte view needs an even byte length. A trailing space pads it, and JSON ignores it.
      const json = frame("window");
      native.triggerMessage(
        windowed(json.length % 2 === 0 ? json : `${json} `, createView),
      );

      await expect(pending).resolves.toEqual({
        done: false,
        value: { text: "window", type: "message" },
      });
      expect(runtimeErrors).toEqual([]);
      socket.close(1000, "done");
      await socket.closed;
    },
  );

  test("should report each undecodable frame once and keep delivering the frames after it", async () => {
    const { native, socket } = await openSession();
    const runtimeErrors: unknown[] = [];
    socket.onRuntimeError((error) => {
      runtimeErrors.push(error);
    });
    const received: string[] = [];
    const consumed = (async () => {
      for await (const message of socket.receive) {
        received.push(textOf(message));
      }
    })();

    native.triggerMessage(frame("first"));
    native.triggerMessage("not json");
    native.triggerMessage(
      new TextEncoder().encode('{"text":1,"type":"message"}'),
    );
    native.triggerMessage(
      blobOf(Promise.resolve(encodeMessage({ type: "other" }))),
    );
    native.triggerMessage(frame("last"));
    await vi.waitFor(() => expect(received).toEqual(["first", "last"]));

    // Text and byte frames fail as soon as they arrive, a Blob frame after its read. Each failure is reported once, in order.
    expect(runtimeErrors).toHaveLength(3);
    expect(runtimeErrors[0]).toBeInstanceOf(SyntaxError);
    expect(runtimeErrors[1]).toBeInstanceOf(StructError);
    expect(runtimeErrors[2]).toBeInstanceOf(StructError);
    expect(socket.state).toBe("open");

    socket.close(1000, "done");
    await consumed;
  });

  test("should settle promptly when the session is aborted while a Blob frame is being read", async () => {
    const controller = new AbortController();
    const { native, socket } = await openSession({ signal: controller.signal });
    const pendingReceive = socket.receive[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);

    native.triggerMessage(blobOf(new Promise<ArrayBuffer>(() => undefined)));
    native.triggerMessage(frame("behind the Blob"));
    const abortCause = new Error("owner aborted");
    controller.abort(abortCause);

    await expect(socket.closed).resolves.toMatchObject({
      cause: abortCause,
      kind: "aborted",
    });
    // Disposal waits for the message pump, which can only finish if the read was abandoned.
    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();
    await expect(pendingReceive).resolves.toBe(abortCause);
    expect(native.listenerCount()).toBe(0);
  });

  test("should drop the frames queued behind a Blob read when the session is disposed", async () => {
    const { native, socket } = await openSession();
    const pendingReceive = socket.receive[Symbol.asyncIterator]().next();

    native.triggerMessage(blobOf(new Promise<ArrayBuffer>(() => undefined)));
    native.triggerMessage(frame("behind the Blob"));
    await expect(
      Promise.resolve(socket[Symbol.asyncDispose]()),
    ).resolves.toBeUndefined();

    // Disposal abandons the read, and the frame that arrived after it is not decoded into the queue.
    await expect(pendingReceive).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(socket.closed).resolves.toMatchObject({ kind: "closed" });
  });
});
