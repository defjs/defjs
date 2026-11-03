import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type EndpointBalancer,
  type EndpointDoneInfo,
  type EndpointPickInfo,
  ERR_NO_ENDPOINT,
  pickFirstBalancer,
} from "../balancer";
import {
  createClient,
  withEndpoint,
  withEndpointBalancer,
  withInterceptors,
  withWebSocketHandle,
} from "../client";
import { createWebSocketInterceptor } from "../interceptor";
import { struct } from "../struct";
import { defineWebSocket } from "./index";

const PRIMARY = "http://127.0.0.1:1";
const SECONDARY = "http://127.0.0.1:2";
const REPLACED = "http://127.0.0.1:9";

const room = defineWebSocket({
  incoming: struct.unknown(),
  maxIncomingQueueSize: 4,
  operation: "room.join",
  path: "/ws",
});

type ScriptStep = { endpoint: string } | { error: Error };

function scriptedBalancer(script: readonly ScriptStep[]): {
  balancer: EndpointBalancer;
  dones: EndpointDoneInfo[];
  pending: () => number;
  pendingAtPick: number[];
  picks: EndpointPickInfo[];
} {
  const picks: EndpointPickInfo[] = [];
  const dones: EndpointDoneInfo[] = [];
  const pendingAtPick: number[] = [];
  let pending = 0;
  let index = 0;
  const balancer: EndpointBalancer = {
    pick(info) {
      picks.push(info);
      pendingAtPick.push(pending);
      const step = script[index] ?? script[script.length - 1];
      index += 1;
      if (step === undefined || "error" in step) {
        return [step?.error ?? ERR_NO_ENDPOINT, undefined];
      }
      pending += 1;
      return [
        null,
        {
          endpoint: step.endpoint,
          done(report) {
            pending -= 1;
            dones.push(report);
          },
        },
      ];
    },
  };
  return {
    balancer,
    dones,
    pending: () => pending,
    pendingAtPick,
    picks,
  };
}

class ControllableSocket {
  static readonly OPEN = 1;
  bufferedAmount = 0;
  extensions = "";
  protocol = "";
  readyState = 0;
  readonly url: string;
  private binary = "blob";
  private readonly listeners: {
    [type: string]: Array<(event: unknown) => void>;
  } = {};

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
    const behavior =
      behaviors[sockets.length - 1] ?? behaviors[behaviors.length - 1];
    if (behavior === "close-before-open") {
      queueMicrotask(() => {
        this.emit("close", { code: 1006, reason: "", wasClean: false });
      });
    }
  }

  get binaryType(): string {
    return this.binary;
  }

  set binaryType(value: string) {
    if (binaryTypeError) {
      throw binaryTypeError;
    }
    this.binary = value;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (item) => item !== listener,
    );
  }

  send(_data: string): void {}

  close(code?: number, reason?: string): void {
    if (closeError) {
      throw closeError;
    }
    this.readyState = 3;
    this.emit("close", {
      code: code ?? 1000,
      reason: reason ?? "",
      wasClean: true,
    });
  }

  open(): void {
    this.readyState = ControllableSocket.OPEN;
    this.emit("open", {});
  }

  failConnect(): void {
    this.emit("error", {});
  }

  private emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners[type] ?? [])]) {
      listener(event);
    }
  }
}

class ThrowingSocket {
  static readonly OPEN = 1;

  constructor(_url?: string | URL) {
    constructCalls += 1;
    throw constructError;
  }
}

let sockets: ControllableSocket[] = [];
let behaviors: Array<"manual" | "close-before-open"> = ["manual"];
let binaryTypeError: Error | undefined;
let closeError: Error | undefined;
let constructCalls = 0;
let constructError: Error = new Error("construct failed");

function resetSockets(): void {
  sockets = [];
  behaviors = ["manual"];
  binaryTypeError = undefined;
  closeError = undefined;
  constructCalls = 0;
  constructError = new Error("construct failed");
}

function clientFor(
  balancer: EndpointBalancer,
  handle: unknown = ControllableSocket,
) {
  return createClient(
    withEndpoint(PRIMARY, SECONDARY),
    withEndpointBalancer(balancer),
    withWebSocketHandle(handle as never),
  );
}

function socketAt(index: number): ControllableSocket {
  const socket = sockets[index];
  if (socket === undefined) {
    throw new Error(`missing socket ${index}`);
  }
  return socket;
}

async function flush(): Promise<void> {
  for (let step = 0; step < 20; step += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
  resetSockets();
});

describe("web socket endpoint balancer", () => {
  test("should pick again on every reconnect and done immediately when the handler base changed", async () => {
    const record = scriptedBalancer([
      { endpoint: PRIMARY },
      { endpoint: SECONDARY },
    ]);
    behaviors = ["close-before-open"];
    const [fault] = await room(
      clientFor(record.balancer)({ reconnect: { attempts: 1, delayMs: 0 } }),
    );

    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(record.picks).toHaveLength(2);
    expect(record.picks.every((info) => info.transport === "websocket")).toBe(
      true,
    );
    expect(record.picks.every((info) => info.operation === "room.join")).toBe(
      true,
    );
    expect(record.picks[0]?.endpoints).toEqual([PRIMARY, SECONDARY]);
    expect(socketAt(0).url).toBe("ws://127.0.0.1:1/ws");
    expect(socketAt(1).url).toBe("ws://127.0.0.1:2/ws");
    expect(record.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(record.pendingAtPick).toEqual([0, 0]);
    expect(record.pending()).toBe(0);

    resetSockets();
    const replaced = scriptedBalancer([{ endpoint: PRIMARY }]);
    let donesWhenNextReturned: EndpointDoneInfo[] = [];
    const switched = createClient(
      withEndpoint(PRIMARY),
      withEndpointBalancer(replaced.balancer),
      withWebSocketHandle(ControllableSocket as never),
      withInterceptors(
        createWebSocketInterceptor((request, next) => {
          const pending = next({ ...request, baseEndpoint: REPLACED });
          donesWhenNextReturned = [...replaced.dones];
          return pending;
        }),
      ),
    );
    const pending = room(switched({ reconnect: { attempts: 1, delayMs: 0 } }));
    await flush();
    expect(donesWhenNextReturned).toEqual([{ attempted: false }]);
    expect(socketAt(0).url).toBe("ws://127.0.0.1:9/ws");
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) {
      throw new Error("expected session");
    }
    expect(replaced.dones).toEqual([{ attempted: false }]);
    socketAt(0).close(1000, "done");
    await flush();
    expect(sockets).toHaveLength(2);
    expect(socketAt(1).url).toBe("ws://127.0.0.1:9/ws");
    expect(replaced.picks).toHaveLength(1);
    expect(replaced.dones).toEqual([{ attempted: false }]);
    session.close(1000, "stop");
    await session.closed;
    expect(replaced.dones).toEqual([{ attempted: false }]);
    expect(replaced.pending()).toBe(0);
  });

  test("should report an opened socket from its close, not its handshake", async () => {
    const record = scriptedBalancer([{ endpoint: PRIMARY }]);
    const pending = room(clientFor(record.balancer));
    await flush();
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) {
      throw new Error("expected session");
    }
    expect(record.dones).toEqual([]);
    expect(record.pending()).toBe(1);
    socketAt(0).close(1000, "done");
    await session.closed;
    expect(record.dones).toEqual([{ attempted: true }]);
    expect(record.pending()).toBe(0);
  });

  test("should map an opened timeout to NET_TIMEOUT, cancellation to attempted false, and builder failure to one done", async () => {
    const timed = scriptedBalancer([{ endpoint: PRIMARY }]);
    const pending = room(
      clientFor(timed.balancer)({ signal: AbortSignal.timeout(20) }),
    );
    await flush();
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) {
      throw new Error("expected session");
    }
    expect(timed.dones).toEqual([]);
    await session.closed;
    expect(timed.dones).toEqual([{ attempted: true, code: "NET_TIMEOUT" }]);
    expect(timed.pending()).toBe(0);

    resetSockets();
    const cancelled = scriptedBalancer([{ endpoint: PRIMARY }]);
    const controller = new AbortController();
    const cancelPending = room(
      clientFor(cancelled.balancer)({ signal: controller.signal }),
    );
    await flush();
    socketAt(0).open();
    const [, live] = await cancelPending;
    if (!live) {
      throw new Error("expected session");
    }
    expect(cancelled.dones).toEqual([]);
    controller.abort();
    await live.closed;
    expect(cancelled.dones).toEqual([{ attempted: false }]);
    expect(cancelled.pending()).toBe(0);

    resetSockets();
    const closed = scriptedBalancer([{ endpoint: PRIMARY }]);
    const closePending = room(clientFor(closed.balancer));
    await flush();
    socketAt(0).open();
    const [, openSession] = await closePending;
    if (!openSession) {
      throw new Error("expected session");
    }
    openSession.close(1000, "bye");
    await openSession.closed;
    expect(closed.dones).toEqual([{ attempted: false }]);
    expect(closed.pending()).toBe(0);

    resetSockets();
    const built = scriptedBalancer([{ endpoint: PRIMARY }]);
    const failing = defineWebSocket({
      builder() {
        throw new Error("bad builder");
      },
      incoming: struct.unknown(),
      maxIncomingQueueSize: 4,
      operation: "room.join",
      path: "/ws",
    });
    const [fault] = await failing(clientFor(built.balancer));
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(built.picks).toHaveLength(1);
    expect(built.picks[0]?.transport).toBe("websocket");
    expect(built.picks[0]?.operation).toBe("room.join");
    expect(built.dones).toEqual([{ attempted: false }]);
    expect(built.pending()).toBe(0);
    expect(sockets).toHaveLength(0);
  });

  test("should done exactly once for a constructed-but-unopened timeout, a direct error finish, a reconnect that skips finish, and a socketless close", async () => {
    const timed = scriptedBalancer([{ endpoint: PRIMARY }]);
    const pending = room(
      clientFor(timed.balancer)({ signal: AbortSignal.timeout(20) }),
    );
    await flush();
    expect(sockets).toHaveLength(1);
    expect(timed.dones).toEqual([]);
    const [fault] = await pending;
    expect(fault?.code).toBe("NET_TIMEOUT");
    expect(timed.dones).toEqual([{ attempted: true, code: "NET_TIMEOUT" }]);
    expect(timed.pending()).toBe(0);

    resetSockets();
    closeError = new Error("close failed");
    const errored = scriptedBalancer([{ endpoint: PRIMARY }]);
    const errorPending = room(clientFor(errored.balancer));
    await flush();
    socketAt(0).failConnect();
    const [errorFault] = await errorPending;
    expect(errorFault?.code).toBe("NET_UNREACHABLE");
    expect(errored.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(errored.pending()).toBe(0);

    resetSockets();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    behaviors = ["close-before-open"];
    const reconnecting = scriptedBalancer([
      { endpoint: PRIMARY },
      { endpoint: SECONDARY },
    ]);
    const controller = new AbortController();
    const reconnectPending = room(
      clientFor(reconnecting.balancer)({
        reconnect: { attempts: 1, delayMs: 5_000 },
        signal: controller.signal,
      }),
    );
    await flush();
    expect(reconnecting.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(reconnecting.pending()).toBe(0);
    expect(reconnecting.picks).toHaveLength(1);
    controller.abort();
    await reconnectPending;
    expect(reconnecting.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(reconnecting.pending()).toBe(0);
    vi.useRealTimers();

    resetSockets();
    const gate = Promise.withResolvers<void>();
    const closing = scriptedBalancer([
      { endpoint: PRIMARY },
      { endpoint: SECONDARY },
    ]);
    const closePending = room(
      clientFor(closing.balancer)({
        beforeConnect({ attempt }) {
          if (attempt > 0) {
            return gate.promise;
          }
          return undefined;
        },
        reconnect: { attempts: 1, delayMs: 0 },
      }),
    );
    await flush();
    socketAt(0).open();
    const [, session] = await closePending;
    if (!session) {
      throw new Error("expected session");
    }
    expect(closing.dones).toEqual([]);
    socketAt(0).close(1000, "drop");
    await vi.waitFor(() => expect(closing.picks).toHaveLength(2));
    expect(closing.dones).toEqual([{ attempted: true }]);
    expect(closing.pending()).toBe(1);
    expect(sockets).toHaveLength(1);
    session.close(1000, "stop");
    await session.closed;
    expect(closing.dones).toEqual([{ attempted: true }, { attempted: false }]);
    expect(closing.pending()).toBe(0);
    expect(sockets).toHaveLength(1);
    gate.resolve();
  });

  test("should keep a single done when a replaced base is an illegal URL or closes cleanly", async () => {
    const illegal = scriptedBalancer([{ endpoint: PRIMARY }]);
    let seenAtReturn: EndpointDoneInfo[] = [];
    const illegalClient = createClient(
      withEndpoint(PRIMARY),
      withEndpointBalancer(illegal.balancer),
      withWebSocketHandle(ControllableSocket as never),
      withInterceptors(
        createWebSocketInterceptor((request, next) => {
          const pending = next({ ...request, baseEndpoint: "not a url" });
          seenAtReturn = [...illegal.dones];
          return pending;
        }),
      ),
    );
    const [fault] = await room(illegalClient);
    expect(seenAtReturn).toEqual([{ attempted: false }]);
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(illegal.dones).toEqual([{ attempted: false }]);
    expect(illegal.pending()).toBe(0);
    expect(sockets).toHaveLength(0);

    resetSockets();
    const clean = scriptedBalancer([{ endpoint: PRIMARY }]);
    const cleanClient = createClient(
      withEndpoint(PRIMARY),
      withEndpointBalancer(clean.balancer),
      withWebSocketHandle(ControllableSocket as never),
      withInterceptors(
        createWebSocketInterceptor((request, next) =>
          next({ ...request, baseEndpoint: REPLACED }),
        ),
      ),
    );
    const pending = room(cleanClient);
    await flush();
    expect(clean.dones).toEqual([{ attempted: false }]);
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) {
      throw new Error("expected session");
    }
    socketAt(0).close(1000, "done");
    await session.closed;
    expect(clean.dones).toEqual([{ attempted: false }]);
    expect(clean.picks).toHaveLength(1);
    expect(clean.pending()).toBe(0);
  });

  test("should done once with NET_UNREACHABLE when construct or binaryType throws without reconnect", async () => {
    const constructed = scriptedBalancer([{ endpoint: PRIMARY }]);
    const [constructFault] = await room(
      clientFor(constructed.balancer, ThrowingSocket),
    );
    expect(constructCalls).toBe(1);
    expect(constructFault?.code).toBe("NET_UNREACHABLE");
    expect(constructed.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(constructed.pending()).toBe(0);

    binaryTypeError = new TypeError("read only");
    const binary = scriptedBalancer([{ endpoint: PRIMARY }]);
    const [binaryFault] = await room(clientFor(binary.balancer));
    expect(binaryFault?.code).toBe("NET_UNREACHABLE");
    expect(binaryFault?.cause).toBe(binaryTypeError);
    expect(binary.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(binary.pending()).toBe(0);
  });

  test("should done once per attempt before the next pick when construct always throws", async () => {
    const record = scriptedBalancer([
      { endpoint: PRIMARY },
      { endpoint: SECONDARY },
      { endpoint: PRIMARY },
      { endpoint: SECONDARY },
    ]);
    const [fault] = await room(
      clientFor(
        record.balancer,
        ThrowingSocket,
      )({
        reconnect: { delayMs: 0 },
      }),
    );

    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(constructCalls).toBe(4);
    expect(record.picks).toHaveLength(4);
    expect(record.pendingAtPick).toEqual([0, 0, 0, 0]);
    expect(record.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(record.pending()).toBe(0);
  });

  test("should classify a constructor failure with createNetworkFault and release pending", async () => {
    constructError = new DOMException("deadline", "TimeoutError");
    const timed = scriptedBalancer([{ endpoint: PRIMARY }]);
    const [timeoutFault] = await room(
      clientFor(timed.balancer, ThrowingSocket),
    );
    expect(timeoutFault?.code).toBe("NET_TIMEOUT");
    expect(timed.dones).toEqual([{ attempted: true, code: "NET_TIMEOUT" }]);
    expect(timed.pending()).toBe(0);

    constructError = new DOMException("stop", "AbortError");
    const aborted = scriptedBalancer([{ endpoint: PRIMARY }]);
    const [abortFault] = await room(
      clientFor(aborted.balancer, ThrowingSocket),
    );
    expect(abortFault?.code).toBe("NET_ABORTED");
    expect(aborted.dones).toEqual([{ attempted: false }]);
    expect(aborted.pending()).toBe(0);
  });

  test("should done attempted false once when beforeConnect fails or the next URL is illegal", async () => {
    const hooked = scriptedBalancer([{ endpoint: PRIMARY }]);
    const [hookFault] = await room(
      clientFor(hooked.balancer)({
        beforeConnect() {
          throw new Error("refresh failed");
        },
      }),
    );
    expect(hookFault?.code).toBe("EXT_HOOK_FAILED");
    expect(hooked.dones).toEqual([{ attempted: false }]);
    expect(hooked.pending()).toBe(0);
    expect(sockets).toHaveLength(0);

    behaviors = ["close-before-open"];
    const record = scriptedBalancer([
      { endpoint: PRIMARY },
      { endpoint: "not a url" },
    ]);
    const [fault] = await room(
      clientFor(record.balancer)({ reconnect: { attempts: 1, delayMs: 0 } }),
    );
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(record.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: false },
    ]);
    expect(record.pending()).toBe(0);
    expect(sockets).toHaveLength(1);
  });

  test("should surface a failed reconnect pick without calling done", async () => {
    behaviors = ["close-before-open"];
    const beforeOpen = scriptedBalancer([
      { endpoint: PRIMARY },
      { error: ERR_NO_ENDPOINT },
    ]);
    const [fault] = await room(
      clientFor(beforeOpen.balancer)({
        reconnect: { attempts: 1, delayMs: 0 },
      }),
    );
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(ERR_NO_ENDPOINT);
    expect(beforeOpen.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(beforeOpen.pending()).toBe(0);

    resetSockets();
    const invalid = pickFirstBalancer({ shuffle: "no" } as never);
    let picks = 0;
    const afterOpen: EndpointBalancer = {
      pick(info) {
        picks += 1;
        if (picks === 1) {
          return [
            null,
            {
              endpoint: PRIMARY,
              done(report) {
                afterOpenDones.push(report);
              },
            },
          ];
        }
        return invalid.pick(info);
      },
    };
    const afterOpenDones: EndpointDoneInfo[] = [];
    const pending = room(
      clientFor(afterOpen)({ reconnect: { attempts: 1, delayMs: 0 } }),
    );
    await flush();
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) {
      throw new Error("expected session");
    }
    socketAt(0).close(1000, "drop");
    const closed = await session.closed;
    expect(closed.kind).toBe("error");
    if (closed.kind !== "error") {
      throw new Error("expected error close");
    }
    expect(closed.cause).toMatchObject({ code: "REQ_OPTIONS_INVALID" });
    expect(afterOpenDones).toEqual([{ attempted: true }]);
    expect(picks).toBe(2);

    resetSockets();
    const opened = scriptedBalancer([
      { endpoint: PRIMARY },
      { error: ERR_NO_ENDPOINT },
    ]);
    const openedPending = room(
      clientFor(opened.balancer)({ reconnect: { attempts: 1, delayMs: 0 } }),
    );
    await flush();
    socketAt(0).open();
    const [, openedSession] = await openedPending;
    if (!openedSession) {
      throw new Error("expected session");
    }
    socketAt(0).close(1000, "drop");
    const openedClosed = await openedSession.closed;
    expect(openedClosed.kind).toBe("error");
    if (openedClosed.kind !== "error") {
      throw new Error("expected error close");
    }
    expect(openedClosed.cause).toMatchObject({ code: "REQ_BUILD_FAILED" });
    expect((openedClosed.cause as { cause?: unknown }).cause).toBe(
      ERR_NO_ENDPOINT,
    );
    expect(opened.dones).toEqual([{ attempted: true }]);
    expect(opened.pending()).toBe(0);
  });

  test("should not call done when the initial pick fails", async () => {
    const record = scriptedBalancer([{ error: ERR_NO_ENDPOINT }]);
    const [fault] = await room(clientFor(record.balancer));
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(ERR_NO_ENDPOINT);
    expect(record.dones).toEqual([]);
    expect(record.picks).toHaveLength(1);
    expect(record.pending()).toBe(0);
  });

  test("should count an error after open as unreachable exactly once", async () => {
    const record = scriptedBalancer([{ endpoint: PRIMARY }]);
    const pending = room(clientFor(record.balancer));
    await flush();
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) {
      throw new Error("expected session");
    }
    socketAt(0).failConnect();
    await session.closed;
    expect(record.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(record.pending()).toBe(0);
  });
});
