import { expect, onTestFinished, vi } from "vitest";
import type { WebSocketHandle } from "../src/client";
import type {
  SocketAwaitResult,
  WebSocketConnectionInfo,
  WebSocketSession,
} from "../src/web_socket";

type Frame = string | ArrayBufferLike | Blob | ArrayBufferView;

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

const encoder = new TextEncoder();

function sizeOf(frame: Frame): number {
  if (typeof frame === "string") {
    return encoder.encode(frame).byteLength;
  }
  return frame instanceof Blob ? frame.size : frame.byteLength;
}

/**
 * A WebSocket as the WebSockets Standard describes it, driven by the test instead of by a network.
 *
 * Nothing here uses a timer. The code under test calls `send` and `close` like it would on a platform socket; the test
 * plays the peer with `open`, `receive`, `peerClose`, `drop` and `drain`, and each of those is one task of the standard:
 *
 * - `readyState` moves CONNECTING, OPEN, CLOSING, CLOSED, and `states` lists every state the socket entered. A close
 *   that the peer starts passes through CLOSING before CLOSED.
 * - `open` is the first event. `message` is dispatched only while OPEN. A failed or dropped connection fires `error`, then
 *   `close` with code 1006 and `wasClean` false. A close that completed fires `close` with `wasClean` true.
 * - `close()` while CONNECTING fails the connection. While OPEN it only moves to CLOSING and records the request; the
 *   socket closes when the peer answers (`peerClose`), or at once in a microtask when the fake plays the peer. While
 *   CLOSING or CLOSED it does nothing.
 * - `send()` throws while CONNECTING, and while CLOSING or CLOSED it only grows `bufferedAmount`.
 *
 * Not modelled: the `on*` properties (`WebSocketHandle` has none), Ping and Pong frames, and values the types reject.
 * Inject a fault by overriding `send`, `close` or the constructor in a subclass.
 */
export class FakeWebSocket extends EventTarget implements WebSocketHandle {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  readonly url: string;
  /** The subprotocols the constructor was given. */
  readonly requestedProtocols: readonly string[];
  /** The frames that `send` accepted while OPEN. */
  readonly sent: Frame[] = [];
  /** Every `close()` call, the ones that did nothing included. */
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  /** The states entered, in order. */
  readonly states: number[] = [CONNECTING];
  bufferedAmount = 0;
  protocol = "";
  extensions = "";
  /** With `true` the socket opens by itself, in a microtask. */
  protected autoOpen = true;
  /** With `true` the socket answers by itself, in microtasks: it echoes a close and drains what was sent. */
  protected autoReply = true;

  #binaryType: "arraybuffer" | "blob" = "blob";

  readonly #listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  constructor(url: string | URL, protocols: string | string[] = []) {
    super();
    const parsed = new URL(url);
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
    } else if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
    }
    if (
      (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") ||
      parsed.hash !== ""
    ) {
      throw new DOMException("The URL is not a WebSocket URL", "SyntaxError");
    }
    this.url = parsed.href;
    this.requestedProtocols =
      typeof protocols === "string" ? [protocols] : [...protocols];
    queueMicrotask(() => {
      if (this.autoOpen && this.readyState === CONNECTING) {
        this.open();
      }
    });
  }

  // An accessor, so that a subclass can make it read-only or ignore what is written.
  get binaryType(): "arraybuffer" | "blob" {
    return this.#binaryType;
  }

  set binaryType(value: "arraybuffer" | "blob") {
    this.#binaryType = value;
  }

  get readyState(): number {
    return this.states.at(-1) ?? CONNECTING;
  }

  /** The text frame that `send` accepted at `index`. */
  sentText(index: number): string {
    const frame = this.sent[index];
    if (typeof frame !== "string") {
      throw new Error(`Frame ${index} is not a text frame`);
    }
    return frame;
  }

  send(data: Frame): void {
    if (this.readyState === CONNECTING) {
      throw new DOMException(
        "The socket is still connecting",
        "InvalidStateError",
      );
    }
    const size = sizeOf(data);
    this.bufferedAmount += size;
    if (this.readyState !== OPEN) {
      return;
    }
    this.sent.push(data);
    queueMicrotask(() => {
      if (this.autoReply) {
        this.bufferedAmount = Math.max(0, this.bufferedAmount - size);
      }
    });
  }

  close(code?: number, reason?: string): void {
    if (
      code !== undefined &&
      code !== 1000 &&
      !(code >= 3000 && code <= 4999)
    ) {
      throw new DOMException(
        "The close code is not allowed",
        "InvalidAccessError",
      );
    }
    if (reason !== undefined && sizeOf(reason) > 123) {
      throw new DOMException("The close reason is too long", "SyntaxError");
    }
    this.closeCalls.push({ code, reason });
    if (this.readyState === CONNECTING) {
      this.states.push(CLOSING);
      queueMicrotask(() => {
        if (this.autoReply && this.readyState === CLOSING) {
          this.drop();
        }
      });
    } else if (this.readyState === OPEN) {
      this.states.push(CLOSING);
      queueMicrotask(() => {
        if (this.autoReply && this.readyState === CLOSING) {
          this.peerClose(code, reason);
        }
      });
    }
  }

  /** The handshake succeeded: CONNECTING to OPEN, then the `open` event. */
  open(init: { protocol?: string; extensions?: string } = {}): void {
    this.#expect("open", CONNECTING);
    this.protocol = init.protocol ?? "";
    this.extensions = init.extensions ?? "";
    this.states.push(OPEN);
    this.dispatchEvent(new Event("open"));
  }

  /** A message arrives. It is dropped unless the socket is OPEN. */
  receive(data: string | ArrayBuffer | Blob): void {
    if (this.readyState === OPEN) {
      this.dispatchEvent(
        new MessageEvent("message", { data, origin: this.url }),
      );
    }
  }

  /**
   * The peer's Close frame, or its answer to ours: CLOSING first when the socket was OPEN, then CLOSED and the `close`
   * event. A Close frame without a status code reads as 1005. `wasClean` is false when the connection ended before the
   * closing handshake completed; no `error` event comes with that.
   */
  peerClose(code = 1005, reason = "", wasClean = true): void {
    this.#expect("peerClose", OPEN, CLOSING);
    if (this.readyState === OPEN) {
      this.states.push(CLOSING);
    }
    this.states.push(CLOSED);
    this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean }));
  }

  /** The connection is lost, or never made: CLOSED, then `error`, then `close` with code 1006 and `wasClean` false. */
  drop(): void {
    this.#expect("drop", CONNECTING, OPEN, CLOSING);
    this.states.push(CLOSED);
    this.dispatchEvent(new Event("error"));
    this.dispatchEvent(
      new CloseEvent("close", { code: 1006, reason: "", wasClean: false }),
    );
  }

  /** The network took everything that `send` queued. */
  drain(): void {
    this.bufferedAmount = 0;
  }

  /** How many listeners are registered, for one event type or for all of them. */
  listenerCount(type?: string): number {
    if (type !== undefined) {
      return this.#listeners.get(type)?.size ?? 0;
    }
    let count = 0;
    for (const listeners of this.#listeners.values()) {
      count += listeners.size;
    }
    return count;
  }

  // The transport registers plain listeners, so `once` and `signal` are not tracked.
  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options);
    if (callback === null) {
      return;
    }
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(callback);
    this.#listeners.set(type, listeners);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(type, callback, options);
    if (callback !== null) {
      this.#listeners.get(type)?.delete(callback);
    }
  }

  #expect(method: string, ...allowed: number[]): void {
    if (!allowed.includes(this.readyState)) {
      throw new Error(
        `${method}() needs readyState ${allowed.join(" or ")}, not ${this.readyState}`,
      );
    }
  }
}

export interface FakeSockets {
  /** A class of its own for this call, so that no state is shared between tests. Pass it to `withWebSocketHandle`. */
  readonly Socket: typeof FakeWebSocket;
  /** Every socket the code under test constructed, in order. */
  readonly sockets: FakeWebSocket[];
  /** The latest socket. */
  last(): FakeWebSocket;
  readonly handshake: "auto" | "manual";
}

/**
 * A fresh `FakeWebSocket` class. With `handshake: "auto"` (the default) each socket plays the peer in microtasks: it
 * opens, answers a close and drains what it was sent. With `"manual"` the test calls `open`, `peerClose` and `drop`.
 * A test that injects a fault extends `Socket` and passes the subclass to `withWebSocketHandle`; its instances are listed
 * in `sockets` like any other.
 */
export function createFakeWebSocket(
  options: { handshake?: "auto" | "manual" } = {},
): FakeSockets {
  const handshake = options.handshake ?? "auto";
  const sockets: FakeWebSocket[] = [];
  class Socket extends FakeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.autoOpen = handshake === "auto";
      this.autoReply = handshake === "auto";
      sockets.push(this);
    }
  }
  return {
    Socket,
    sockets,
    handshake,
    last() {
      const socket = sockets.at(-1);
      if (!socket) {
        throw new Error("No socket was constructed");
      }
      return socket;
    },
  };
}

/**
 * A subclass of `Socket` whose constructor throws, as the platform's does for a URL or subprotocol it refuses. The
 * refused socket is still listed in `sockets`, so its `url` can be read.
 */
export function refusing(Socket: typeof FakeWebSocket): typeof FakeWebSocket {
  return class extends Socket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      throw new DOMException("The connection was refused", "SyntaxError");
    }
  };
}

export interface OpenedSession<TIncoming, TOutgoing> {
  session: WebSocketSession<TIncoming, TOutgoing>;
  connection: WebSocketConnectionInfo;
  /** The socket of the first connection. */
  socket: FakeWebSocket;
}

/**
 * Runs an operation to its first open and returns what it opened. With a manual handshake the socket is opened here.
 * A result that is an error fails the test.
 */
export async function openSession<TIncoming, TOutgoing>(
  pending: Promise<SocketAwaitResult<TIncoming, TOutgoing>>,
  fake: FakeSockets,
): Promise<OpenedSession<TIncoming, TOutgoing>> {
  const before = fake.sockets.length;
  if (fake.handshake === "manual") {
    await vi.waitFor(() => expect(fake.sockets.length).toBeGreaterThan(before));
    fake.last().open();
  }
  const [error, session, connection] = await pending;
  if (error !== null) {
    throw new Error("Expected an open session", { cause: error });
  }
  return { session, connection, socket: fake.sockets[before] ?? fake.last() };
}

/**
 * `createFakeWebSocket`, with its `Socket` stubbed as the global `WebSocket` until the test ends. `derive` stubs a
 * subclass instead, to inject a fault; its instances are listed in `sockets` like any other.
 */
export function stubFakeWebSocket(
  options?: Parameters<typeof createFakeWebSocket>[0],
  derive: (Socket: typeof FakeWebSocket) => typeof FakeWebSocket = (Socket) =>
    Socket,
): FakeSockets {
  const fake = createFakeWebSocket(options);
  vi.stubGlobal("WebSocket", derive(fake.Socket));
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return fake;
}

/**
 * Once the transport has detached its own `error` handler, one no-op `error` listener must remain, so that a late
 * `error` from an EventEmitter-based handle has a receiver. The survivor must be that sink and not a transport handler
 * left behind: a leftover handler would close the socket again when it runs.
 */
export function expectInertErrorListener(socket: FakeWebSocket): void {
  expect(socket.listenerCount("error")).toBe(1);
  const closeCalls = socket.closeCalls.length;
  socket.dispatchEvent(new Event("error"));
  expect(socket.closeCalls).toHaveLength(closeCalls);
}

export function expectOnlyErrorSink(socket: FakeWebSocket): void {
  expect(socket.listenerCount("open")).toBe(0);
  expect(socket.listenerCount("message")).toBe(0);
  expect(socket.listenerCount("close")).toBe(0);
  expectInertErrorListener(socket);
}
