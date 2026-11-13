import { expect, onTestFinished, vi } from "vitest";
import type { FakeSockets } from "./fake_web_socket";
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
  onTestFinished(() => {
    vi.useRealTimers();
  });
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
 * A generation is the set of listeners captured while one attempt is open, not "whatever count happens to remain".
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

/** A call of a client whose WebSocket handle is `fake`, bound to `signal`. */
export function guardedClient(
  fake: FakeSockets,
  signal: AbortSignal,
  options?: Omit<RequestOptions, "signal">,
): Client {
  return createClient(
    withEndpoint("https://example.test"),
    withWebSocketHandle(fake.Socket),
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
