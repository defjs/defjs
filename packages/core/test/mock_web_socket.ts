import { afterEach, expect, vi } from "vitest";
import {
  createClient,
  type DerivableClient,
  withEndpoint,
  withInterceptors,
  withWebSocketHandle,
  type Client,
  type RequestOptions,
} from "../src/client";
import { createWebSocketInterceptor } from "../src/interceptor";
import type { SocketAwaitResult } from "../src/web_socket";

/** The timers a session uses: the connect and close deadlines, the reconnect delay and the heartbeat interval. */
export function useFakeClock(): void {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  lastMockInstance = undefined;
  mockInstances = [];
});

export let lastMockInstance: MockWebSocketInstance | undefined;
export let mockInstances: MockWebSocketInstance[] = [];

export interface MockWebSocketInstance {
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

export function createMockWebSocketClass(
  options: {
    autoOpen?: boolean;
    autoCloseDelay?: number;
    closeEventDelayMs?: number;
    closeErrors?: readonly unknown[];
    emitCloseEvent?: boolean;
    onListenerRegistered?: (type: string) => void;
    onSend?: (data: string) => void;
    sendError?: Error;
    throwOnConstruct?: unknown;
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
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the mock throws the value a test gives it, and a test may give a non-Error
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
        // DOM: registering a callback that is already registered for the type is a no-op.
        if (!this.listeners[type].includes(fn)) this.listeners[type].push(fn);
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

      mockInstances.push(this);
      lastMockInstance = mockInstances.at(-1);

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

export function createDeferred<T>() {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

export type AbortListener = (event: Event) => void;

/**
 * Records abort callbacks by function identity.
 * A merged session signal also carries forwarding listeners, so a generation is the set captured
 * while that attempt is open — not "whatever count happens to remain".
 */
export function instrumentAbortListeners(signal: AbortSignal): {
  listeners(): readonly AbortListener[];
  assertReleased(generation: readonly AbortListener[]): void;
} {
  const live = new Set<AbortListener>();
  const removed = new Set<AbortListener>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  Object.defineProperty(signal, "addEventListener", {
    configurable: true,
    enumerable: true,
    value: (...args: Parameters<AbortSignal["addEventListener"]>) => {
      const [type, listener] = args;
      if (type === "abort" && typeof listener === "function") {
        live.add(listener);
      }
      add(...args);
    },
    writable: true,
  });
  Object.defineProperty(signal, "removeEventListener", {
    configurable: true,
    enumerable: true,
    value: (...args: Parameters<AbortSignal["removeEventListener"]>) => {
      const [type, listener] = args;
      if (type === "abort" && typeof listener === "function") {
        live.delete(listener);
        removed.add(listener);
      }
      remove(...args);
    },
    writable: true,
  });
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

export function soleListener(
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

// Whenever the transport detaches its own `error` handler, one no-op `error` listener must remain so a
// late `error` from an EventEmitter-based handle has a receiver. The survivor must be that sink and not a
// transport handler left behind: a leftover `handleError` would close the socket again when it runs.
export function expectInertErrorListener(socket: MockWebSocketInstance): void {
  const errorListeners = socket.listenerRefs("error");
  expect(errorListeners).toHaveLength(1);
  const closeCalls = vi.mocked(socket.close).mock.calls.length;
  errorListeners[0]?.(new Event("error"));
  expect(socket.close).toHaveBeenCalledTimes(closeCalls);
}

export function expectOnlyErrorSink(socket: MockWebSocketInstance): void {
  expect(socket.listenerCount("open")).toBe(0);
  expect(socket.listenerCount("message")).toBe(0);
  expect(socket.listenerCount("close")).toBe(0);
  expectInertErrorListener(socket);
}

export function expectListenerReleased(
  socket: MockWebSocketInstance,
  type: string,
  listener: (event: unknown) => void,
): void {
  expect(socket.listenerRefs(type)).not.toContain(listener);
  expect(socket.listenerCount(type)).toBe(0);
}

export function clientObservingAbortListeners(): {
  client: DerivableClient;
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
        const signal = request.signal;
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

export function encodeMessage(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

/** Runs an operation against a client with per-call options. */
export async function run(
  client: DerivableClient,
  operation: (client: Client) => Promise<SocketAwaitResult<unknown, unknown>>,
  options?: Record<string, unknown>,
): Promise<SocketAwaitResult<unknown, unknown>> {
  return operation(client(options));
}

export type CountingSocket = {
  constructed: () => number;
  handle: Parameters<typeof withWebSocketHandle>[0];
};

export function countingSocket(): CountingSocket {
  let constructed = 0;
  class Socket {
    static readonly OPEN = 1;
    bufferedAmount = 0;
    binaryType = "blob";
    extensions = "";
    protocol = "";
    readyState = 0;
    readonly url: string;

    constructor(url: string | URL) {
      this.url = String(url);
      constructed += 1;
    }

    addEventListener(): void {}

    close(): void {
      this.readyState = 3;
    }

    removeEventListener(): void {}

    send(_data: string | ArrayBufferLike | Blob | ArrayBufferView): void {}
  }

  return {
    constructed: () => constructed,
    handle: Socket,
  };
}

export function guardedClient(
  opened: CountingSocket,
  signal: AbortSignal,
  options?: Omit<RequestOptions, "signal">,
): Client {
  return createClient(
    withEndpoint("https://example.test"),
    withWebSocketHandle(opened.handle),
  )({ ...options, signal });
}

export function watchAbortListeners(signal: AbortSignal): {
  added: () => number;
  removed: () => number;
} {
  let added = 0;
  let removed = 0;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  const watchedAdd = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    if (type === "abort") {
      added += 1;
    }
    add(type, listener, options);
  };
  const watchedRemove = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void => {
    if (type === "abort") {
      removed += 1;
    }
    remove(type, listener, options);
  };
  signal.addEventListener = watchedAdd;
  signal.removeEventListener = watchedRemove;
  return {
    added: () => added,
    removed: () => removed,
  };
}
