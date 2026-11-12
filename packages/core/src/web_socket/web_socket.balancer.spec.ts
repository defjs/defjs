import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type Balancer,
  type DoneInfo,
  type PickInfo,
  ERR_NO_CANDIDATE,
  pickFirstBalancer,
  outlierDetection,
} from "../balancer";
import {
  createClient,
  withEndpoint,
  withBalancer,
  withInterceptors,
  withWebSocketHandle,
  type WebSocketHandleConstructor,
} from "../client";
import { ERR_ABORTED, ERR_TIMEOUT } from "../error";
import { createWebSocketInterceptor } from "../interceptor";
import { struct } from "../struct";
import { createFakeWebSocket, FakeWebSocket } from "../../test/fake_web_socket";
import { defineWebSocket } from "./index";

const PRIMARY = "http://127.0.0.1:1";
const SECONDARY = "http://127.0.0.1:2";
const REPLACED = "http://127.0.0.1:9";

const room = defineWebSocket({
  incoming: struct.unknown(),
  operation: "room.join",
  path: "/ws",
});

const pinged = defineWebSocket({
  incoming: struct.unknown(),
  operation: "room.join",
  outgoing: struct.unknown(),
  path: "/ws",
});

type ScriptStep = { endpoint: string } | { error: Error };

function scriptedBalancer(script: readonly ScriptStep[]): {
  balancer: Balancer;
  dones: DoneInfo[];
  ends: DoneInfo[];
  pending: () => number;
  pendingAtPick: number[];
  picks: PickInfo[];
} {
  const picks: PickInfo[] = [];
  const dones: DoneInfo[] = [];
  const ends: DoneInfo[] = [];
  const pendingAtPick: number[] = [];
  let pending = 0;
  let index = 0;
  const balancer: Balancer = {
    pick(info) {
      picks.push(info);
      pendingAtPick.push(pending);
      const step = script[index] ?? script[script.length - 1];
      index += 1;
      if (step === undefined || "error" in step) {
        return [step?.error ?? ERR_NO_CANDIDATE, undefined];
      }
      pending += 1;
      return [
        null,
        {
          endpoint: step.endpoint,
          end(report) {
            ends.push(report);
          },
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
    ends,
    pending: () => pending,
    pendingAtPick,
    picks,
  };
}

let fake = createFakeWebSocket({ handshake: "manual" });
let behaviors: Array<"manual" | "close-before-open"> = ["manual"];
let binaryTypeError: Error | undefined;
let closeError: Error | undefined;
let constructCalls = 0;
let constructError: Error = new Error("construct failed");

function resetSockets(): void {
  fake = createFakeWebSocket({ handshake: "manual" });
  behaviors = ["manual"];
  binaryTypeError = undefined;
  closeError = undefined;
  constructCalls = 0;
  constructError = new Error("construct failed");
}

/** The current test's socket: it opens when the test says so, and answers a close at once. */
function scriptedSocket(): typeof FakeWebSocket {
  return class extends fake.Socket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.autoReply = true;
      const behavior =
        behaviors[fake.sockets.length - 1] ?? behaviors[behaviors.length - 1];
      if (behavior === "close-before-open") {
        queueMicrotask(() => {
          this.drop();
        });
      }
    }

    override get binaryType(): "arraybuffer" | "blob" {
      return super.binaryType;
    }

    override set binaryType(value: "arraybuffer" | "blob") {
      if (binaryTypeError) {
        throw binaryTypeError;
      }
      super.binaryType = value;
    }

    override close(code?: number, reason?: string): void {
      if (closeError) {
        throw closeError;
      }
      super.close(code, reason);
    }
  };
}

/** A handle whose constructor always throws, after the platform has counted the attempt. */
function throwingSocket(): typeof FakeWebSocket {
  return class extends fake.Socket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      constructCalls += 1;
      throw constructError;
    }
  };
}

function clientFor(
  balancer: Balancer,
  handle: WebSocketHandleConstructor = scriptedSocket(),
) {
  return createClient(
    withEndpoint(PRIMARY, SECONDARY),
    withBalancer(balancer),
    withWebSocketHandle(handle),
  );
}

function socketAt(index: number): FakeWebSocket {
  const socket = fake.sockets[index];
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
  vi.unstubAllGlobals();
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
      clientFor(record.balancer)({ retry: { maxRetries: 1, delayMs: 0 } }),
    );

    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(record.picks).toHaveLength(2);
    for (const info of record.picks)
      expect(info).not.toHaveProperty("transport");
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
    let donesWhenNextReturned: DoneInfo[] = [];
    const switched = createClient(
      withEndpoint(PRIMARY),
      withBalancer(replaced.balancer),
      withWebSocketHandle(scriptedSocket()),
      withInterceptors(
        createWebSocketInterceptor((request, next) => {
          const pending = next({ ...request, baseEndpoint: REPLACED });
          donesWhenNextReturned = [...replaced.dones];
          return pending;
        }),
      ),
    );
    const pending = room(switched({ retry: { maxRetries: 1, delayMs: 0 } }));
    await flush();
    expect(donesWhenNextReturned).toEqual([{ attempted: false }]);
    expect(socketAt(0).url).toBe("ws://127.0.0.1:9/ws");
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) {
      throw new Error("expected session");
    }
    expect(replaced.dones).toEqual([{ attempted: false }]);
    socketAt(0).peerClose(1000, "done");
    await flush();
    expect(fake.sockets).toHaveLength(2);
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
    socketAt(0).peerClose(1000, "done");
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
      operation: "room.join",
      path: "/ws",
    });
    const [fault] = await failing(clientFor(built.balancer));
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(built.picks).toHaveLength(1);
    expect(built.picks[0]).not.toHaveProperty("transport");
    expect(built.picks[0]?.operation).toBe("room.join");
    expect(built.dones).toEqual([{ attempted: false }]);
    expect(built.pending()).toBe(0);
    expect(fake.sockets).toHaveLength(0);
  });

  test("should done exactly once for a constructed-but-unopened timeout, a direct error finish, a reconnect that skips finish, and a socketless close", async () => {
    const timed = scriptedBalancer([{ endpoint: PRIMARY }]);
    const pending = room(
      clientFor(timed.balancer)({ signal: AbortSignal.timeout(20) }),
    );
    await flush();
    expect(fake.sockets).toHaveLength(1);
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
    socketAt(0).dispatchEvent(new Event("error"));
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
        retry: { maxRetries: 1, delayMs: 5_000 },
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
        retry: { maxRetries: 1, delayMs: 0 },
      }),
    );
    await flush();
    socketAt(0).open();
    const [, session] = await closePending;
    if (!session) {
      throw new Error("expected session");
    }
    expect(closing.dones).toEqual([]);
    socketAt(0).peerClose(1000, "drop");
    await vi.waitFor(() => expect(closing.picks).toHaveLength(2));
    expect(closing.dones).toEqual([{ attempted: true }]);
    expect(closing.pending()).toBe(1);
    expect(fake.sockets).toHaveLength(1);
    session.close(1000, "stop");
    await session.closed;
    expect(closing.dones).toEqual([{ attempted: true }, { attempted: false }]);
    expect(closing.pending()).toBe(0);
    expect(fake.sockets).toHaveLength(1);
    gate.resolve();
  });

  test("should keep a single done when a replaced base is an illegal URL or closes cleanly", async () => {
    const illegal = scriptedBalancer([{ endpoint: PRIMARY }]);
    let seenAtReturn: DoneInfo[] = [];
    const illegalClient = createClient(
      withEndpoint(PRIMARY),
      withBalancer(illegal.balancer),
      withWebSocketHandle(scriptedSocket()),
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
    expect(fake.sockets).toHaveLength(0);

    resetSockets();
    const clean = scriptedBalancer([{ endpoint: PRIMARY }]);
    const cleanClient = createClient(
      withEndpoint(PRIMARY),
      withBalancer(clean.balancer),
      withWebSocketHandle(scriptedSocket()),
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
    socketAt(0).peerClose(1000, "done");
    await session.closed;
    expect(clean.dones).toEqual([{ attempted: false }]);
    expect(clean.picks).toHaveLength(1);
    expect(clean.pending()).toBe(0);
  });

  test("should done once with NET_UNREACHABLE when construct or binaryType throws without reconnect", async () => {
    const constructed = scriptedBalancer([{ endpoint: PRIMARY }]);
    const [constructFault] = await room(
      clientFor(constructed.balancer, throwingSocket()),
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

  test("should done once and not retry when the constructor throws", async () => {
    const shouldRetry = vi.fn(() => true);
    const record = scriptedBalancer([
      { endpoint: PRIMARY },
      { endpoint: SECONDARY },
    ]);
    const [fault] = await room(
      clientFor(
        record.balancer,
        throwingSocket(),
      )({
        retry: { delayMs: 0, shouldRetry },
      }),
    );

    expect(fault?.code).toBe("NET_UNREACHABLE");
    expect(constructCalls).toBe(1);
    expect(record.picks).toHaveLength(1);
    expect(record.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(record.pending()).toBe(0);
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  test("should classify a constructor failure with createNetworkFault and release pending", async () => {
    constructError = new DOMException("deadline", "TimeoutError");
    const timed = scriptedBalancer([{ endpoint: PRIMARY }]);
    const [timeoutFault] = await room(
      clientFor(timed.balancer, throwingSocket()),
    );
    expect(timeoutFault?.code).toBe("NET_TIMEOUT");
    expect(timed.dones).toEqual([{ attempted: true, code: "NET_TIMEOUT" }]);
    expect(timed.pending()).toBe(0);

    constructError = new DOMException("stop", "AbortError");
    const aborted = scriptedBalancer([{ endpoint: PRIMARY }]);
    const [abortFault] = await room(
      clientFor(aborted.balancer, throwingSocket()),
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
    expect(fake.sockets).toHaveLength(0);

    behaviors = ["close-before-open"];
    const record = scriptedBalancer([
      { endpoint: PRIMARY },
      { endpoint: "not a url" },
    ]);
    const [fault] = await room(
      createClient(
        withEndpoint(PRIMARY, SECONDARY, "not a url"),
        withBalancer(record.balancer),
        withWebSocketHandle(scriptedSocket()),
      )({ retry: { maxRetries: 1, delayMs: 0 } }),
    );
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(record.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
      { attempted: false },
    ]);
    expect(record.pending()).toBe(0);
    expect(fake.sockets).toHaveLength(1);
  });

  test("should surface a failed reconnect pick without calling done", async () => {
    behaviors = ["close-before-open"];
    const beforeOpen = scriptedBalancer([
      { endpoint: PRIMARY },
      { error: ERR_NO_CANDIDATE },
    ]);
    const [fault] = await room(
      clientFor(beforeOpen.balancer)({
        retry: { maxRetries: 1, delayMs: 0 },
      }),
    );
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(ERR_NO_CANDIDATE);
    expect(beforeOpen.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(beforeOpen.pending()).toBe(0);

    resetSockets();
    const opened = scriptedBalancer([
      { endpoint: PRIMARY },
      { error: ERR_NO_CANDIDATE },
    ]);
    const openedPending = room(
      clientFor(opened.balancer)({ retry: { maxRetries: 1, delayMs: 0 } }),
    );
    await flush();
    socketAt(0).open();
    const [, openedSession] = await openedPending;
    if (!openedSession) {
      throw new Error("expected session");
    }
    socketAt(0).peerClose(1000, "drop");
    const openedClosed = await openedSession.closed;
    expect(openedClosed.kind).toBe("error");
    if (openedClosed.kind !== "error") {
      throw new Error("expected error close");
    }
    expect(openedClosed.cause).toMatchObject({ code: "REQ_BUILD_FAILED" });
    const nested = openedClosed.cause;
    if (typeof nested !== "object" || nested === null || !("cause" in nested)) {
      throw new Error("expected a nested cause");
    }
    expect(nested.cause).toBe(ERR_NO_CANDIDATE);
    expect(opened.dones).toEqual([{ attempted: true }]);
    expect(opened.pending()).toBe(0);
  });

  test("should not call done when the initial pick fails", async () => {
    const record = scriptedBalancer([{ error: ERR_NO_CANDIDATE }]);
    const [fault] = await room(clientFor(record.balancer));
    expect(fault?.code).toBe("REQ_BUILD_FAILED");
    expect(fault?.cause).toBe(ERR_NO_CANDIDATE);
    expect(record.dones).toEqual([]);
    expect(record.picks).toHaveLength(1);
    expect(record.pending()).toBe(0);
  });

  test.each([
    [1006, false, "NET_UNREACHABLE"],
    [1006, undefined, "NET_UNREACHABLE"],
    [1006, true, "NET_UNREACHABLE"],
    [1015, false, "NET_UNREACHABLE"],
    [1012, false, "NET_UNAVAILABLE"],
    [1012, true, "NET_UNAVAILABLE"],
    [1013, true, "NET_UNAVAILABLE"],
    [1013, undefined, "NET_UNAVAILABLE"],
  ] as const)(
    "default pick-first advances on close-only code %s with wasClean %s as %s",
    async (code, wasClean, failure) => {
      const child = pickFirstBalancer();
      const dones: DoneInfo[] = [];
      const ends: DoneInfo[] = [];
      const balancer: Balancer = {
        pick(info) {
          const [error, choice] = child.pick(info);
          if (error) return [error, undefined];
          return [
            null,
            {
              ...choice,
              end(report) {
                ends.push(report);
                choice.end?.(report);
              },
              done(report) {
                dones.push(report);
                choice.done?.(report);
              },
            },
          ];
        },
      };
      const pending = room(
        clientFor(balancer)({ retry: { maxRetries: 1, delayMs: 0 } }),
      );
      await flush();
      socketAt(0).open();
      const [error, session] = await pending;
      expect(error).toBeNull();
      if (!session) throw new Error("expected session");
      const runtimeError = vi.fn();
      session.onRuntimeError(runtimeError);
      try {
        socketAt(0).peerClose(code, "peer closed", wasClean);
        await vi.waitFor(() => expect(fake.sockets).toHaveLength(2));
        expect(dones).toEqual([{ attempted: true, code: failure }]);
        expect(ends).toEqual([{ attempted: true }]);
        expect(socketAt(1).url).toBe("ws://127.0.0.1:2/ws");
        socketAt(1).open();
        expect(ends).toEqual([{ attempted: true }, { attempted: true }]);
        expect(runtimeError).not.toHaveBeenCalled();
      } finally {
        session.close(1000, "stop");
        await session.closed;
      }
      expect(dones).toEqual([
        { attempted: true, code: failure },
        { attempted: false },
      ]);
    },
  );

  test.each([
    [1000, true],
    [1001, true],
    [1005, true],
    [1011, true],
    [4001, true],
    [1000, undefined],
    [1011, undefined],
    // Firefox reports a server-initiated close frame with wasClean false; the code still describes the peer.
    [1000, false],
    [1001, false],
  ])(
    "does not add a network failure for code %s with wasClean %s",
    async (code, wasClean) => {
      const record = scriptedBalancer([{ endpoint: PRIMARY }]);
      const pending = room(clientFor(record.balancer));
      await flush();
      socketAt(0).open();
      const [, session] = await pending;
      if (!session) throw new Error("expected session");
      socketAt(0).peerClose(code, "peer closed", wasClean);
      expect(await session.closed).toMatchObject({ kind: "closed", code });
      expect(record.dones).toEqual([{ attempted: true }]);
      expect(record.ends).toEqual([{ attempted: true }]);
      expect(record.pending()).toBe(0);
    },
  );

  test.each([
    [1012, { attempted: true, code: "NET_UNAVAILABLE" }],
    [1000, { attempted: true }],
    [1006, { attempted: true, code: "NET_UNREACHABLE" }],
    [1015, { attempted: true, code: "NET_UNREACHABLE" }],
  ] as const)(
    "classifies close code %s that arrives before the open event by the code",
    async (code, report) => {
      const record = scriptedBalancer([{ endpoint: PRIMARY }]);
      const pending = room(
        clientFor(record.balancer)({ retry: { maxRetries: 1, delayMs: 0 } }),
      );
      await flush();
      // Firefox can dispatch the peer's close frame without `open` when the server closes right after accepting. The
      // standard orders `open` first, so only a raw event can say it.
      socketAt(0).dispatchEvent(
        new CloseEvent("close", {
          code,
          reason: "peer closed",
          wasClean: false,
        }),
      );
      await vi.waitFor(() => expect(fake.sockets).toHaveLength(2));
      expect(record.dones).toEqual([report]);
      expect(record.ends).toEqual([report]);
      socketAt(1).open();
      const [error, session] = await pending;
      expect(error).toBeNull();
      if (!session) throw new Error("expected session");
      session.close(1000, "stop");
      await session.closed;
      expect(record.pending()).toBe(0);
    },
  );

  test.each([
    ["cancel", 1006],
    ["manual", 1006],
    ["timeout", 1006],
    ["cancel", 1013],
    ["manual", 1013],
    ["timeout", 1013],
  ] as const)(
    "%s takes priority over a late close-only %s snapshot",
    async (mode, code) => {
      class AbnormalOnClose extends scriptedSocket() {
        override close(): void {
          if (this.readyState !== FakeWebSocket.CLOSED) {
            this.peerClose(code, "peer closed", code !== 1006);
          }
        }
      }
      const record = scriptedBalancer([{ endpoint: PRIMARY }]);
      const controller = new AbortController();
      const pending = room(
        clientFor(
          record.balancer,
          AbnormalOnClose,
        )({
          retry: { maxRetries: 1, delayMs: 0 },
          signal: controller.signal,
        }),
      );
      await flush();
      socketAt(0).open();
      const [, session] = await pending;
      if (!session) throw new Error("expected session");
      if (mode === "manual") session.close(1000, "owner");
      else controller.abort(mode === "timeout" ? ERR_TIMEOUT : ERR_ABORTED);
      await session.closed;
      expect(record.dones).toEqual([
        mode === "timeout"
          ? { attempted: true, code: "NET_TIMEOUT" }
          : { attempted: false },
      ]);
      expect(record.ends).toEqual([{ attempted: true }]);
      expect(fake.sockets).toHaveLength(1);
      expect(record.pending()).toBe(0);
    },
  );

  test("does not treat application termination without a native close snapshot as a network failure", async () => {
    class SilentOnClose extends scriptedSocket() {
      override close(): void {}
    }
    const record = scriptedBalancer([{ endpoint: PRIMARY }]);
    const pending = pinged(
      clientFor(
        record.balancer,
        SilentOnClose,
      )({
        heartbeat: {
          intervalMs: 60_000,
          isAck: () => {
            throw new Error("local ack check failed");
          },
          message: () => "ping",
        },
      }),
    );
    await flush();
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) throw new Error("expected session");
    socketAt(0).receive("{}");
    expect(await session.closed).toMatchObject({ kind: "error" });
    expect(record.dones).toEqual([{ attempted: true }]);
    expect(record.ends).toEqual([{ attempted: true }]);
    expect(record.pending()).toBe(0);
  });

  test.each([
    {
      name: "an unanswered heartbeat as an unreachable endpoint",
      message: (): unknown => "ping",
      reason: "WebSocket heartbeat timeout",
      done: { attempted: true, code: "NET_UNREACHABLE" },
    },
    {
      name: "a throwing heartbeat message as neutral",
      message: (): unknown => {
        throw new Error("local heartbeat failed");
      },
      reason: "local heartbeat failed",
      done: { attempted: true },
    },
    {
      name: "an unserializable heartbeat message as neutral",
      message: (): unknown => Number.POSITIVE_INFINITY,
      reason: "is not JSON data: Infinity",
      done: { attempted: true },
    },
  ])("reports $name", async ({ message, reason, done }) => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "performance",
      ],
    });
    const record = scriptedBalancer([{ endpoint: PRIMARY }]);
    const pending = pinged(
      clientFor(record.balancer)({
        heartbeat: {
          intervalMs: 10,
          message,
          isAck: () => false,
          timeoutMs: 20,
        },
      }),
    );
    await flush();
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) throw new Error("expected session");
    expect(record.dones).toEqual([]);
    await vi.advanceTimersByTimeAsync(30);
    const closed = await session.closed;
    expect(closed.kind).toBe("error");
    if (closed.kind !== "error") throw new Error("expected error close");
    expect(closed.cause).toBeInstanceOf(Error);
    expect(String(closed.cause)).toContain(reason);
    expect(record.dones).toEqual([done]);
    expect(record.ends).toEqual([{ attempted: true }]);
    expect(record.pending()).toBe(0);
  });

  test("default health filtering receives close-only failures and breaks after five samples", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(0);
    const picked: string[] = [];
    const dones: DoneInfo[] = [];
    const balancer = outlierDetection({
      pick(info) {
        const endpoint = info.endpoints[0] ?? "";
        picked.push(endpoint);
        return [
          null,
          {
            endpoint,
            done(report) {
              dones.push(report);
            },
          },
        ];
      },
    });
    const client = clientFor(balancer);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const pending = room(client);
      await flush();
      socketAt(attempt).open();
      const [error, session] = await pending;
      expect(error).toBeNull();
      if (!session) throw new Error("expected session");
      socketAt(attempt).peerClose(
        attempt < 5 ? 1006 : 1000,
        "peer closed",
        attempt >= 5,
      );
      await session.closed;
    }
    expect(picked).toEqual([
      PRIMARY,
      PRIMARY,
      PRIMARY,
      PRIMARY,
      PRIMARY,
      SECONDARY,
    ]);
    expect(dones).toEqual([
      ...Array.from({ length: 5 }, () => ({
        attempted: true,
        code: "NET_UNREACHABLE",
      })),
      { attempted: true },
    ]);
  });

  test("an endpoint that opens and then drops escalates its penalty", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(0);
    const picked: string[] = [];
    const client = clientFor(
      outlierDetection(
        {
          pick(info) {
            const endpoint = info.endpoints[0] ?? "";
            picked.push(endpoint);
            return [null, { endpoint }];
          },
        },
        { jitterRatio: 0 },
      ),
    );
    let index = 0;
    async function connect(drop: boolean): Promise<void> {
      const pending = room(client);
      await flush();
      socketAt(index).open();
      const [error, session] = await pending;
      expect(error).toBeNull();
      if (!session) throw new Error("expected session");
      socketAt(index).peerClose(drop ? 1006 : 1000, "peer closed", !drop);
      index += 1;
      await session.closed;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) await connect(true);
    let now = 0;
    for (const penalty of [1000, 2000, 3000]) {
      now += penalty;
      vi.advanceTimersByTime(now - 1 - performance.now());
      picked.length = 0;
      await connect(false);
      expect(picked).toEqual([SECONDARY]);
      vi.advanceTimersByTime(now - performance.now());
      picked.length = 0;
      for (let attempt = 0; attempt < 5; attempt += 1) await connect(true);
      expect(picked).toEqual(Array.from({ length: 5 }, () => PRIMARY));
    }
  });

  test.each(["offline", "replaced"])(
    "does not attribute a close-only failure when %s",
    async (mode) => {
      if (mode === "offline") vi.stubGlobal("navigator", { onLine: false });
      const record = scriptedBalancer([{ endpoint: PRIMARY }]);
      const client = createClient(
        withEndpoint(PRIMARY),
        withBalancer(record.balancer),
        withWebSocketHandle(scriptedSocket()),
        ...(mode === "replaced"
          ? [
              withInterceptors(
                createWebSocketInterceptor((req, next) =>
                  next({ ...req, baseEndpoint: REPLACED }),
                ),
              ),
            ]
          : []),
      );
      const pending = room(client);
      await flush();
      socketAt(0).open();
      const [error, session] = await pending;
      expect(error).toBeNull();
      if (!session) throw new Error("expected session");
      socketAt(0).peerClose(1006, "peer closed", false);
      expect(await session.closed).toMatchObject({
        kind: "error",
        code: 1006,
        wasClean: false,
      });
      expect(record.dones).toEqual([{ attempted: false }]);
      expect(record.ends).toEqual(
        mode === "offline" ? [{ attempted: true }] : [],
      );
      expect(record.pending()).toBe(0);
    },
  );

  test.each(["false", "throw"])(
    "keeps the physical close failure when shouldRetry returns %s",
    async (mode) => {
      const record = scriptedBalancer([{ endpoint: PRIMARY }]);
      const policyError = new Error("application policy");
      const policy = vi.fn(() => {
        if (mode === "throw") throw policyError;
        return false;
      });
      const pending = room(
        clientFor(record.balancer)({
          retry: { maxRetries: 1, delayMs: 0, shouldRetry: policy },
        }),
      );
      await flush();
      socketAt(0).open();
      const [, session] = await pending;
      if (!session) throw new Error("expected session");
      socketAt(0).peerClose(1006, "peer closed", false);
      expect(await session.closed).toMatchObject(
        mode === "throw"
          ? { kind: "error", cause: policyError }
          : { kind: "error", code: 1006 },
      );
      expect(policy).toHaveBeenCalledOnce();
      expect(record.dones).toEqual([
        { attempted: true, code: "NET_UNREACHABLE" },
      ]);
      expect(record.ends).toEqual([{ attempted: true }]);
      expect(fake.sockets).toHaveLength(1);
    },
  );

  test("should count an error after open as unreachable exactly once", async () => {
    class AbnormalOnError extends scriptedSocket() {
      override close(): void {
        if (this.readyState !== FakeWebSocket.CLOSED) {
          this.peerClose(1006, "peer closed", false);
        }
      }
    }
    const record = scriptedBalancer([{ endpoint: PRIMARY }]);
    const pending = room(clientFor(record.balancer, AbnormalOnError));
    await flush();
    socketAt(0).open();
    const [, session] = await pending;
    if (!session) {
      throw new Error("expected session");
    }
    const runtimeError = vi.fn();
    session.onRuntimeError(runtimeError);
    socketAt(0).dispatchEvent(new Event("error"));
    expect(await session.closed).toMatchObject({
      kind: "error",
      code: 1006,
      wasClean: false,
    });
    expect(record.dones).toEqual([
      { attempted: true, code: "NET_UNREACHABLE" },
    ]);
    expect(record.ends).toEqual([{ attempted: true }]);
    expect(runtimeError).toHaveBeenCalledExactlyOnceWith(
      new Error("WebSocket connection error"),
    );
    expect(record.pending()).toBe(0);
  });
});
