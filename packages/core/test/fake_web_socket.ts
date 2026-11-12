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
 * plays the peer with `open`, `receive`, `peerClosing`, `peerClose` and `drop`, and each of those is one task of the standard:
 *
 * - `readyState` moves CONNECTING, OPEN, CLOSING, CLOSED. A close that the peer starts passes through CLOSING: `peerClosing`
 *   is its first task, the Close frame has arrived and the connection is still up, and `peerClose` ends it. `peerClose`
 *   from OPEN runs both at once.
 * - `open` is the first event. `message` is dispatched only while OPEN, and a binary frame arrives as a Blob or an
 *   ArrayBuffer according to `binaryType`. A failed or dropped connection fires `error`, then `close` with code 1006, an
 *   empty reason and `wasClean` false (`drop`); 1006 never arrives in a Close frame, so `peerClose` refuses it. A close
 *   that completed fires `close` with `wasClean` true.
 * - `close()` while CONNECTING fails the connection. While OPEN it only moves to CLOSING and records the request; the
 *   socket closes when the peer answers (`peerClose`), or at once in a microtask when the fake plays the peer. While
 *   CLOSING or CLOSED it does nothing.
 * - `send()` throws while CONNECTING, and while CLOSING or CLOSED it only grows `bufferedAmount`.
 * - The constructor throws a `SyntaxError` for a URL that is not a WebSocket URL and for a repeated subprotocol.
 *
 * Not modelled: the `on*` properties (`WebSocketHandle` has none), Ping and Pong frames, the token syntax of a
 * subprotocol, that `open` selects one of the requested subprotocols, and values the types reject. `receive` delivers a
 * Blob as it is given, so that a test can control how its read settles. Inject a fault by overriding `send`, `close` or
 * the constructor in a subclass.
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
  /** Every `send()` call, the ones the socket refused or discarded included. */
  readonly sendCalls: Frame[] = [];
  /** Every `close()` call, the ones that did nothing included. */
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  bufferedAmount = 0;
  protocol = "";
  extensions = "";
  /** With `true` the socket opens by itself, in a microtask. */
  protected autoOpen = true;
  /** With `true` the socket answers by itself, in microtasks: it echoes a close and takes what was sent off `bufferedAmount`. */
  protected autoReply = true;

  #binaryType: "arraybuffer" | "blob" = "blob";
  #readyState = CONNECTING;
  readonly #origin: string;

  readonly #listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  constructor(url: string | URL, protocols: string | string[] = []) {
    super();
    if (!URL.canParse(url)) {
      throw new DOMException("The URL is not valid", "SyntaxError");
    }
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
    const requested =
      typeof protocols === "string" ? [protocols] : [...protocols];
    if (new Set(requested).size !== requested.length) {
      throw new DOMException("A subprotocol is repeated", "SyntaxError");
    }
    this.url = parsed.href;
    this.#origin = parsed.origin;
    this.requestedProtocols = requested;
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
    return this.#readyState;
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
    this.sendCalls.push(data);
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
      this.#readyState = CLOSING;
      queueMicrotask(() => {
        if (this.autoReply && this.readyState === CLOSING) {
          this.drop();
        }
      });
    } else if (this.readyState === OPEN) {
      this.#readyState = CLOSING;
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
    this.#readyState = OPEN;
    this.dispatchEvent(new Event("open"));
  }

  /**
   * A message arrives. It is dropped unless the socket is OPEN. A text frame is a string and a binary frame an
   * ArrayBuffer, which the socket delivers as a Blob while its `binaryType` is "blob". A Blob is delivered as it is.
   */
  receive(data: string | ArrayBuffer | Blob): void {
    if (this.readyState === OPEN) {
      const frame =
        data instanceof ArrayBuffer && this.#binaryType === "blob"
          ? new Blob([data])
          : data;
      this.dispatchEvent(
        new MessageEvent("message", { data: frame, origin: this.#origin }),
      );
    }
  }

  /** The peer's Close frame has arrived: OPEN to CLOSING. The connection is up until `peerClose` or `drop`. */
  peerClosing(): void {
    this.#expect("peerClosing", OPEN);
    this.#readyState = CLOSING;
  }

  /**
   * The peer's Close frame, or its answer to ours, and the connection ends: CLOSED, then the `close` event with
   * `wasClean` true. From OPEN the socket passes through CLOSING first, as `peerClosing` does. Without a code the
   * event carries 1005, no status. The codes 1005, 1006 and 1015 never travel in a Close frame, so they are refused; a
   * connection that was lost is `drop`.
   */
  peerClose(code?: number, reason = ""): void {
    if (code === 1005 || code === 1006 || code === 1015) {
      throw new RangeError(`${code} never travels in a Close frame`);
    }
    this.#expect("peerClose", OPEN, CLOSING);
    if (this.readyState === OPEN) {
      this.peerClosing();
    }
    this.#readyState = CLOSED;
    this.dispatchEvent(
      new CloseEvent("close", { code: code ?? 1005, reason, wasClean: true }),
    );
  }

  /** The connection is lost, or never made: CLOSED, then `error`, then `close` with code 1006 and `wasClean` false. */
  drop(): void {
    this.#expect("drop", CONNECTING, OPEN, CLOSING);
    this.#readyState = CLOSED;
    this.dispatchEvent(new Event("error"));
    this.dispatchEvent(
      new CloseEvent("close", { code: 1006, reason: "", wasClean: false }),
    );
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

/**
 * A `close` event alone. The standard cannot produce one without the `error` that comes before a 1006, or with a
 * `wasClean` that the closing handshake does not give, as Firefox reports it for a Close frame from the server; a handle
 * that does not follow the standard can, and the code under test accepts it. The socket leaves OPEN for CLOSING first, so
 * a second call does nothing to a socket that already closed.
 */
export function closeEventOnly(
  socket: FakeWebSocket,
  init: CloseEventInit,
): void {
  if (socket.readyState === FakeWebSocket.OPEN) {
    socket.peerClosing();
  }
  socket.dispatchEvent(new CloseEvent("close", init));
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
 * opens, answers a close and empties `bufferedAmount`. With `"manual"` the test calls `open`, `peerClose` and `drop`.
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
