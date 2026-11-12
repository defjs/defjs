import type { DoneInfo } from "../balancer/balancer";
import type { WebSocketHandle } from "../client/config";
import { createNetworkFault, ERR_TIMEOUT } from "../error";
import { awaitWithSignal, resolveAbortFault } from "../internal/abort";
import { decodeWebSocketMessage, extractCloseInfo } from "./codec";
import type { HeartbeatRuntime } from "./heartbeat";
import { startHeartbeat } from "./heartbeat";
import type { ActiveAttempt, Session } from "./session";
import {
  createWebSocketSession,
  emitRuntimeError,
  finish,
  finishFromSignal,
  report,
  requestNativeCloseBestEffort,
  setState,
  SOCKET_CLOSE_GRACE_MS,
} from "./session";
import type {
  SocketLifecycleOutcome,
  WebSocketConnectionInfo,
} from "./web_socket";

const CONNECTION_ERROR_MESSAGE = "WebSocket connection error";

/** What an attempt settles with. Every attempt that got a socket has a connection snapshot. */
export interface AttemptOutcome extends SocketLifecycleOutcome {
  connection: WebSocketConnectionInfo;
}

/** One physical connection, from the constructor to the close. */
interface Attempt extends ActiveAttempt {
  readonly socket: WebSocketHandle;
  /** `connecting` until the open event; `settled` once the outcome has been handed to the lifecycle. */
  phase: "connecting" | "open" | "settled";
  /** The error that ended the attempt, when the platform's own events do not say. */
  cause: unknown;
  timedOut: boolean;
  /** The close that was observed while a Blob read still had to be delivered. */
  closeOutcome: AttemptOutcome | undefined;
  heartbeat: HeartbeatRuntime<unknown> | undefined;
  connectTimer: ReturnType<typeof setTimeout> | undefined;
  errorTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether a Blob read is in flight. Frames that arrive behind it wait in `backlog`. */
  reading: boolean;
  /** Aborts the Blob read in flight. Every way an attempt ends passes through `detach`. */
  readonly reads: AbortController;
  /** Data of the frames that arrived behind a Blob read, in arrival order. */
  readonly backlog: unknown[];
  readonly resolve: (outcome: AttemptOutcome) => void;
  readonly onOpen: () => void;
  readonly onMessage: (event: MessageEvent) => void;
  readonly onClose: (event: CloseEvent) => void;
  readonly onError: () => void;
  readonly onAbort: () => void;
}

export type OpenedSocket =
  { ok: true; socket: WebSocketHandle } | { ok: false; cause: unknown };

/** Creates the socket. A throw, from the constructor or from `binaryType`, is a failure of this call, not of the connection. */
export function openSocket(session: Session, url: string): OpenedSocket {
  let socket: WebSocketHandle;
  try {
    session.pick?.start();
    socket =
      session.protocols.length > 0
        ? new session.Socket(url, [...session.protocols])
        : new session.Socket(url);
  } catch (cause) {
    return { ok: false, cause };
  }

  try {
    /* istanbul ignore else -- @preserve defensive: binaryType may not exist on injected nonstandard WebSocket handles */
    if ("binaryType" in socket) {
      socket.binaryType = "arraybuffer";
    }
  } catch (cause) {
    // A missing property is only an ArrayBuffer hint. A setter that throws has already
    // constructed a socket no later cleanup can see, so close it before reporting the failure.
    // Closing a CONNECTING socket still emits a late `error`: keep a listener for it.
    socket.addEventListener("error", ignoreSocketError);
    requestNativeCloseBestEffort(socket);
    return { ok: false, cause };
  }
  return { ok: true, socket };
}

/** Runs one connection to its end: resolves when the attempt settles, however it ended. */
export function runAttempt(
  session: Session,
  socket: WebSocketHandle,
): Promise<AttemptOutcome> {
  const { promise, resolve } = Promise.withResolvers<AttemptOutcome>();
  const attempt: Attempt = {
    socket,
    phase: "connecting",
    cause: undefined,
    timedOut: false,
    closeOutcome: undefined,
    heartbeat: undefined,
    connectTimer: undefined,
    errorTimer: undefined,
    reading: false,
    reads: new AbortController(),
    backlog: [],
    resolve,
    onOpen: () => handleOpen(session, attempt),
    onMessage: (event) => handleMessage(session, attempt, event),
    onClose: (event) => handleClose(session, attempt, event),
    onError: () => handleError(session, attempt),
    onAbort: () => handleAbort(session, attempt),
    // A close that was observed must not be lost to a locally failed Blob read.
    cancel: () =>
      settle(
        session,
        attempt,
        attempt.closeOutcome ?? failed(session, attempt),
      ),
    stop: () => {
      attempt.reads.abort();
      attempt.heartbeat?.stop();
    },
  };
  session.socket = socket;
  session.attempt = attempt;

  socket.addEventListener("open", attempt.onOpen);
  socket.addEventListener("message", attempt.onMessage);
  socket.addEventListener("close", attempt.onClose);
  socket.addEventListener("error", attempt.onError);
  const attemptTimeoutMs = session.retry?.attemptTimeoutMs;
  if (attemptTimeoutMs !== undefined) {
    attempt.connectTimer = setTimeout(() => {
      attempt.timedOut = true;
      attempt.cause = ERR_TIMEOUT;
      requestNativeCloseBestEffort(socket);
      settle(session, attempt, failed(session, attempt));
    }, attemptTimeoutMs);
  }
  // Last, so that an abort that is already pending ends the attempt after every listener it has to remove is attached.
  session.signal.addEventListener("abort", attempt.onAbort, { once: true });
  if (session.signal.aborted) {
    attempt.onAbort();
  }
  return promise;
}

function connectionInfo(
  session: Session,
  socket: WebSocketHandle,
): WebSocketConnectionInfo {
  return {
    extensions: socket.extensions || undefined,
    generation: session.generation,
    protocol: socket.protocol || undefined,
    url: socket.url,
  };
}

/** The outcome of an attempt that ended without a close event: it failed locally, or the socket went quiet. */
function failed(session: Session, attempt: Attempt): AttemptOutcome {
  return {
    closeInfo: {},
    connection: connectionInfo(session, attempt.socket),
    cause: attempt.cause,
    opened: attempt.phase !== "connecting",
  };
}

/** Ends the attempt once: tells the balancer, detaches everything, and hands the outcome to the lifecycle. */
function settle(
  session: Session,
  attempt: Attempt,
  outcome: AttemptOutcome,
): void {
  if (attempt.phase === "settled") {
    return;
  }
  attempt.phase = "settled";
  report(session, classifyAttempt(session, attempt, outcome));

  clearTimeout(attempt.errorTimer);
  clearTimeout(attempt.connectTimer);
  const { socket } = attempt;
  socket.removeEventListener("open", attempt.onOpen);
  socket.removeEventListener("message", attempt.onMessage);
  socket.removeEventListener("close", attempt.onClose);
  detachErrorListener(attempt);
  session.signal.removeEventListener("abort", attempt.onAbort);
  attempt.heartbeat?.stop();
  attempt.reads.abort();
  attempt.backlog.length = 0;
  session.socket = undefined;
  session.attempt = undefined;
  attempt.resolve(outcome);
}

// Closing a CONNECTING socket still emits a late `error`. An EventEmitter-based handle such
// as `ws` throws it when nothing listens, so a no-op listener replaces `onError` and is
// never removed. Adding the same listener again is a no-op for an EventTarget.
function detachErrorListener(attempt: Attempt): void {
  attempt.socket.addEventListener("error", ignoreSocketError);
  attempt.socket.removeEventListener("error", attempt.onError);
}

function ignoreSocketError(): void {}

// A function, so that a check after the caller's code ran is not narrowed away by an earlier one.
function isSettled(attempt: Attempt): boolean {
  return attempt.phase === "settled";
}

function handleAbort(session: Session, attempt: Attempt): void {
  if (session.startup !== undefined) {
    session.connection = connectionInfo(session, attempt.socket);
  }
  finishFromSignal(session);
}

function handleOpen(session: Session, attempt: Attempt): void {
  if (attempt.phase !== "connecting") {
    return;
  }
  clearTimeout(attempt.connectTimer);
  attempt.phase = "open";
  session.pick?.end({ attempted: true });
  // Per outage: the next close starts again at attempt 1 and the base delay.
  session.retried = 0;
  session.generation += 1;
  const connection = connectionInfo(session, attempt.socket);
  session.connection = connection;
  // Nobody holds the session before the first open: nothing is queued and nobody listens yet.
  const startup = session.startup;
  if (startup !== undefined) {
    session.startup = undefined;
    const facade = createWebSocketSession(session);
    session.first = { facade, connection };
    startup.resolve(facade);
  }
  try {
    flushSendQueue(session, attempt.socket);
  } catch (cause) {
    finish(session, { cause, kind: "error" });
    return;
  }
  if (session.final !== undefined || session.manualClose) {
    return;
  }
  setState(session, "open");
  if (session.final !== undefined) {
    return;
  }
  if (session.heartbeat !== undefined && session.status === "open") {
    attempt.heartbeat = startHeartbeat(
      attempt.socket,
      session.openState,
      session.heartbeat,
      session.outgoing,
      (cause) => {
        // An unanswered ping is a connection failure, as in gRPC keepalive: the socket is closed
        // and the attempt settles like a drop, so the retry policy decides what follows.
        attempt.cause = cause;
        requestNativeCloseBestEffort(attempt.socket);
        settle(session, attempt, failed(session, attempt));
      },
      // A failing local heartbeat callback or serializer is not the endpoint's fault and ends the session.
      (cause) => {
        finish(session, { cause, kind: "error" });
      },
    );
  }
}

function flushSendQueue(session: Session, socket: WebSocketHandle): void {
  while (socket.readyState === session.openState) {
    const next = session.sendQueue.shift();
    if (typeof next === "undefined") {
      return;
    }

    socket.send(next);
  }
}

function handleMessage(
  session: Session,
  attempt: Attempt,
  event: MessageEvent,
): void {
  if (attempt.reading) {
    attempt.backlog.push(event.data);
    return;
  }
  const blob = receiveFrame(session, attempt, event.data);
  if (blob !== undefined) {
    attempt.reading = true;
    session.drain = drain(session, attempt, blob);
  }
}

// Text and byte frames decode and deliver at once. Only a Blob has to be read first, so that read is returned.
function receiveFrame(
  session: Session,
  attempt: Attempt,
  data: unknown,
): Promise<unknown> | undefined {
  // After close() the caller reads nothing more, so a frame that arrives during the closing handshake is dropped
  // before it is decoded: a Blob read that no drain awaits would reject with no handler.
  if (isSettled(attempt) || session.manualClose !== undefined) {
    return undefined;
  }
  let decoded: unknown;
  try {
    decoded = decodeWebSocketMessage(session.incoming, data);
  } catch (error) {
    emitRuntimeError(session, error);
    return undefined;
  }
  if (isPromise(decoded)) {
    return decoded;
  }
  deliver(session, attempt, decoded);
  return undefined;
}

function deliver(session: Session, attempt: Attempt, decoded: unknown): void {
  if (typeof decoded === "undefined") {
    return;
  }

  try {
    const isAck = attempt.heartbeat?.isAck?.(decoded) ?? false;
    // The classifier is the caller's code and may have ended the session.
    if (isSettled(attempt)) {
      return;
    }
    if (isAck) {
      attempt.heartbeat?.markAck();
      return;
    }
    session.incomingQueue.push(decoded);
  } catch (cause) {
    if (!isSettled(attempt)) {
      finish(session, { cause, kind: "error" });
    }
  }
}

// Reads a Blob, then the frames that arrived behind it, in order. Only the Blob read races the signal.
async function drain(
  session: Session,
  attempt: Attempt,
  blob: Promise<unknown>,
): Promise<void> {
  let reading: Promise<unknown> | undefined = blob;
  while (reading !== undefined) {
    try {
      const read = reading;
      deliver(
        session,
        attempt,
        await awaitWithSignal(() => read, attempt.reads.signal),
      );
    } catch (error) {
      if (isSettled(attempt) || attempt.reads.signal.aborted) {
        break;
      }
      emitRuntimeError(session, error);
    }
    reading = undefined;
    // The length guard stays first: shifting an empty queue measured twice as slow. A settled attempt has an empty backlog.
    while (attempt.backlog.length > 0 && reading === undefined) {
      reading = receiveFrame(session, attempt, attempt.backlog.shift());
    }
  }
  attempt.reading = false;
  if (attempt.closeOutcome !== undefined) {
    settle(session, attempt, attempt.closeOutcome);
  }
}

function handleError(session: Session, attempt: Attempt): void {
  attempt.cause ??= new Error(CONNECTION_ERROR_MESSAGE);
  attempt.heartbeat?.stop();
  detachErrorListener(attempt);
  // No close event within the grace, or no way to ask for one: the attempt failed, and the
  // retry policy decides what follows, as for a connect timeout or a missed heartbeat.
  attempt.errorTimer = setTimeout(() => {
    attempt.errorTimer = undefined;
    settle(session, attempt, failed(session, attempt));
  }, SOCKET_CLOSE_GRACE_MS);
  try {
    attempt.socket.close();
  } catch {
    settle(session, attempt, failed(session, attempt));
  }
}

function handleClose(
  session: Session,
  attempt: Attempt,
  event: CloseEvent,
): void {
  if (attempt.closeOutcome !== undefined) {
    return;
  }
  clearTimeout(attempt.errorTimer);
  // No close frame arrived: RFC 6455 7.2.1 makes that a failed connection. Runtimes that
  // skip the `error` event still report code 1006, so the failure is inferred from it.
  const nativeErrorSeen = attempt.cause !== undefined;
  const cause =
    attempt.cause ??
    (attempt.phase === "open" && event.code === 1006
      ? new Error(CONNECTION_ERROR_MESSAGE)
      : undefined);
  attempt.heartbeat?.stop();
  const { socket } = attempt;
  socket.removeEventListener("open", attempt.onOpen);
  socket.removeEventListener("message", attempt.onMessage);
  detachErrorListener(attempt);
  const outcome: AttemptOutcome = {
    closeInfo: extractCloseInfo(event),
    connection: connectionInfo(session, socket),
    cause,
    opened: attempt.phase !== "connecting",
  };
  // The frames already received are delivered first. A Blob that is still being read is one of them,
  // unless the platform reported an error, which drops what has not been read.
  if (nativeErrorSeen || !attempt.reading) {
    settle(session, attempt, outcome);
    return;
  }
  attempt.closeOutcome = outcome;
}

/**
 * Tells the balancer how the attempt went. `manualClose`, a caller stop and a failed constructor are not the
 * endpoint's doing and do not count against it.
 */
function classifyAttempt(
  session: Session,
  attempt: Attempt,
  outcome: AttemptOutcome,
): DoneInfo {
  if (session.manualClose) {
    return { attempted: false };
  }
  const aborted = resolveAbortFault(session.signal);
  if (aborted?.code === "NET_TIMEOUT") {
    return { attempted: true, code: "NET_TIMEOUT" };
  }
  if (aborted) {
    return { attempted: false };
  }
  if (attempt.timedOut) {
    return { attempted: true, code: "NET_UNREACHABLE" };
  }
  const { closeInfo } = outcome;
  // 1006 and 1015 mean no close frame arrived. Any other code came in the peer's close frame,
  // so the handshake completed even without an open event: Firefox can skip `open` when the
  // server closes right after accepting.
  const closeFrame =
    closeInfo.code !== undefined &&
    closeInfo.code !== 1006 &&
    closeInfo.code !== 1015;
  if (outcome.cause === undefined && (outcome.opened || closeFrame)) {
    // The close code describes the peer. `wasClean` also reflects TCP teardown, which engines
    // report differently: Firefox reports false for a server-initiated close frame.
    if (closeInfo.code === 1006 || closeInfo.code === 1015) {
      return { attempted: true, code: "NET_UNREACHABLE" };
    }
    // 1012 Service Restart and 1013 Try Again Later are the WebSocket form of HTTP 503.
    return closeInfo.code === 1012 || closeInfo.code === 1013
      ? { attempted: true, code: "NET_UNAVAILABLE" }
      : { attempted: true };
  }
  return doneInfoForNetworkCause(
    outcome.cause ?? new Error("WebSocket closed before open"),
  );
}

export function doneInfoForNetworkCause(cause: unknown): DoneInfo {
  const code = createNetworkFault(cause).code;
  if (code === "NET_TIMEOUT") {
    return { attempted: true, code: "NET_TIMEOUT" };
  }
  if (code === "NET_ABORTED") {
    return { attempted: false };
  }
  return { attempted: true, code: "NET_UNREACHABLE" };
}

function isPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}
