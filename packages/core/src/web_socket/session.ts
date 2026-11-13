import type { DoneInfo } from "../balancer/balancer";
import { reportContainedError } from "../internal/report_error";
import type { ResolvedEndpoint } from "../balancer/runtime";
import type { ClientConfig, ClientWebSocketOptions } from "../client/config";
import type { WebSocketHandle } from "../client/config";
import type { AnyFault } from "../error";
import type { HttpRequest } from "../http/http_request";
import type { WebSocketSessionLike } from "../interceptor/interceptor";
import {
  hasAborted,
  resolveAbortedFault,
  stopsUnreadItems,
} from "../internal/abort";
import { AsyncQueue } from "../internal/async_queue";
import type { RetryPolicy } from "../internal/retry";
import type { AnyStruct } from "../struct";
import type { WebSocketCloseSnapshot } from "./codec";
import { serializeOutgoingWebSocketMessage } from "./codec";
import type {
  ManualSocketCloseReason,
  WebSocketCloseInfo,
  WebSocketConnectionInfo,
  WebSocketHeartbeatConfig,
  WebSocketSession,
  WebSocketState,
} from "./web_socket";

export const SOCKET_CLOSE_GRACE_MS = 1_000;

export type SocketConstructor = new (
  url: string | URL,
  protocols?: string | string[],
) => WebSocketHandle;

/** What a session needs of the physical connection in flight. The attempt implements it. */
export interface ActiveAttempt {
  /** Settles the attempt as it stands: a close that was observed, or a connection that failed. */
  cancel(): void;
  /** The caller closed the session: nothing more is read, and the heartbeat stops. */
  stop(): void;
}

/** What one call fixes before its session exists. */
export interface SessionConfig {
  readonly incoming: AnyStruct;
  readonly outgoing: AnyStruct | undefined;
  readonly maxOutgoingQueueSize: number;
  readonly clientConfig: ClientConfig;
  readonly meta: { [key: string]: unknown } | undefined;
  readonly Socket: SocketConstructor;
  readonly openState: number;
  readonly retry: RetryPolicy | undefined;
  readonly heartbeat: WebSocketHeartbeatConfig | undefined;
  readonly beforeConnect: ClientWebSocketOptions["beforeConnect"];
  readonly protocols: readonly string[];
  /** The request the interceptors left. Each attempt builds its URL from it. */
  readonly request: HttpRequest;
  /** Whether the request still targets the endpoint the balancer picked, so the balancer can be told what happened. */
  readonly attributable: boolean;
  readonly callerSignal: AbortSignal | undefined;
  /** The call's controller, which follows the caller's signal and an interceptor's. The session aborts it with the final result when it ends. */
  readonly controller: AbortController;
  /** Stops following the caller's signal and an interceptor's. The session calls it once, when it ends. */
  readonly release: () => void;
  /** `controller.signal`. The session ends when it aborts. */
  readonly signal: AbortSignal;
}

/** One WebSocket session: everything its attempts, its public object and its lifecycle share. */
export interface Session extends SessionConfig {
  /** The balancer's pick for the attempt about to start. `undefined` once it has been reported, or when not attributable. */
  pick: ResolvedEndpoint | undefined;
  status: WebSocketState;
  /** Counts state changes, so that a listener that causes another change stops the rest of the notification. */
  transition: number;
  readonly listeners: {
    readonly runtimeError: Set<(error: unknown) => void>;
    readonly stateChange: Set<(state: WebSocketState) => void>;
  };
  connection: WebSocketConnectionInfo | undefined;
  /** The socket of the attempt in flight. */
  socket: WebSocketHandle | undefined;
  attempt: ActiveAttempt | undefined;
  /** Retries since the last connection that opened; the number of the attempt about to start. */
  retried: number;
  /** Counts the sockets that reached `open`. */
  generation: number;
  readonly incomingQueue: AsyncQueue<unknown>;
  readonly sendQueue: string[];
  readonly closed: PromiseWithResolvers<WebSocketCloseInfo>;
  /** The call's pending result, until the first open or the first end settles it. */
  startup: PromiseWithResolvers<WebSocketSessionLike> | undefined;
  /** The public object and the connection of the first open, which the call reports. `undefined` until the session opened. */
  first:
    | {
        readonly facade: WebSocketSession<unknown, unknown>;
        readonly connection: WebSocketConnectionInfo;
      }
    | undefined;
  manualClose: ManualSocketCloseReason | undefined;
  /** How the session ended. Set once, in `finish`. */
  final: WebSocketCloseInfo | undefined;
  /** Whether the session ended before the caller's signal aborted. Set once, in `finish`. */
  endedBeforeAbort: boolean;
  /** The Blob read still running when the latest attempt settled. Disposal waits for it. */
  drain: Promise<void> | undefined;
  disposal: Promise<void> | undefined;
  lifecycle: Promise<void> | undefined;
}

/** The first state is `idle`; the lifecycle moves it to `connecting` before anything can observe it. */
export function createSession(
  config: SessionConfig,
  pick: ResolvedEndpoint | undefined,
  startup: PromiseWithResolvers<WebSocketSessionLike>,
): Session {
  return {
    ...config,
    pick,
    status: "idle",
    transition: 0,
    listeners: { runtimeError: new Set(), stateChange: new Set() },
    connection: undefined,
    socket: undefined,
    attempt: undefined,
    retried: 0,
    generation: 0,
    incomingQueue: new AsyncQueue(),
    sendQueue: [],
    closed: Promise.withResolvers(),
    startup,
    first: undefined,
    manualClose: undefined,
    final: undefined,
    endedBeforeAbort: false,
    drain: undefined,
    disposal: undefined,
    lifecycle: undefined,
  };
}

export function setState(session: Session, next: WebSocketState): void {
  if (session.status === next) {
    return;
  }

  session.status = next;
  session.transition += 1;
  const transition = session.transition;
  for (const listener of [...session.listeners.stateChange]) {
    if (session.transition !== transition) {
      break;
    }
    try {
      listener(next);
    } catch (error) {
      emitRuntimeError(session, error);
    }
  }
}

export function emitRuntimeError(session: Session, error: unknown): void {
  for (const listener of [...session.listeners.runtimeError]) {
    try {
      listener(error);
    } catch (observerError) {
      reportContainedError(observerError);
    }
  }
}

/** Tells the balancer how the attempt went, once. */
export function report(session: Session, info: DoneInfo): void {
  const pick = session.pick;
  if (pick === undefined) {
    return;
  }
  session.pick = undefined;
  pick.end(info);
  pick.done(info);
}

export function requestNativeCloseBestEffort(socket: WebSocketHandle): void {
  try {
    socket.close();
  } catch {
    // Logical settlement must not depend on a conforming native close implementation.
  }
}

/** Ends the session, failing the call with `fault` when the session never opened. */
export function finishWithFault(
  session: Session,
  final: WebSocketCloseInfo,
  fault: AnyFault,
): void {
  const startup = session.startup;
  if (startup !== undefined) {
    session.startup = undefined;
    startup.reject(fault);
  }
  finish(session, final);
}

export function finish(session: Session, final: WebSocketCloseInfo): void {
  session.final = final;
  session.endedBeforeAbort = !hasAborted(session.callerSignal);

  const socket = session.socket;
  if (final.kind !== "closed" && socket) {
    requestNativeCloseBestEffort(socket);
  }
  const attempt = session.attempt;
  if (attempt === undefined) {
    report(session, { attempted: false });
  } else {
    attempt.cancel();
  }

  session.sendQueue.length = 0;
  if (final.kind === "closed") {
    session.incomingQueue.close();
  } else {
    const terminalCause =
      final.cause ?? new DOMException("Aborted", "AbortError");
    // A cancelled session drops its unread messages; `fail` itself keeps them for the error ending.
    if (final.kind === "aborted") {
      session.incomingQueue.discard();
    }
    session.incomingQueue.fail(terminalCause);
    if (final.kind === "error") {
      emitRuntimeError(session, final.cause);
    }
  }

  setState(session, final.kind);
  session.listeners.runtimeError.clear();
  session.listeners.stateChange.clear();

  session.controller.abort(final);

  session.closed.resolve(final);
  session.release();
}

/** Ends a session whose signal has aborted: a timeout is an error, anything else an abort. */
export function finishFromSignal(
  session: Session,
  snapshot: WebSocketCloseSnapshot = {},
): void {
  const { signal } = session;
  const fault = resolveAbortedFault(signal);
  finishWithFault(
    session,
    fault.code === "NET_TIMEOUT"
      ? toErrorInfo(snapshot, signal.reason)
      : toAbortedInfo(snapshot, signal.reason),
    fault,
  );
}

function requestClose(session: Session, code?: number, reason?: string): void {
  validateWebSocketClose(code, reason);
  // The caller stopped the session, ended or not: what it has not read is gone from this call on, as a closed WebSocket dispatches no more messages.
  session.incomingQueue.discard();
  if (session.final !== undefined || session.manualClose) {
    return;
  }

  session.manualClose = { code, kind: "manual-web-socket-close", reason };
  // The caller reads nothing more, so a Blob that is still being read is dropped with the frames behind it.
  session.attempt?.stop();
  setState(session, "closing");
  if (session.final !== undefined) {
    return;
  }
  const socket = session.socket;
  if (!socket) {
    finish(session, toClosedInfo({}, session.manualClose));
    return;
  }

  try {
    socket.close(code, reason);
  } catch (cause) {
    // A handle that cannot close ends the session. `finish` asks it once more to close.
    finish(session, { cause, kind: "error" });
    throw cause;
  }
}

function dispose(session: Session): Promise<void> {
  return (session.disposal ??= Promise.resolve().then(() =>
    disposeOnce(session),
  ));
}

async function disposeOnce(session: Session): Promise<void> {
  let failure: { reason: unknown } | undefined;
  try {
    requestClose(session);
  } catch (cause) {
    failure = { reason: cause };
  }

  if (session.final === undefined) {
    const timer = setTimeout(() => {
      failure ??= {
        reason: new DOMException(
          "WebSocket close event was not observed before teardown timeout",
          "TimeoutError",
        ),
      };
      finish(session, toClosedInfo({}, session.manualClose));
    }, SOCKET_CLOSE_GRACE_MS);
    // The timer goes with the end of the session, so it never finds a session that has already ended.
    void session.closed.promise.then(() => clearTimeout(timer));
  }

  await session.lifecycle;
  await session.drain;

  if (failure) {
    throw failure.reason;
  }
}

/** The object the call and its interceptors hold. */
export function createWebSocketSession(
  session: Session,
): WebSocketSession<unknown, unknown> {
  return {
    get bufferedAmount() {
      return session.socket?.bufferedAmount ?? 0;
    },
    get connection() {
      return (
        session.connection ??
          /* istanbul ignore next -- @preserve invariant: concrete sessions are delivered only after their first open snapshot */
          { generation: 0 }
      );
    },
    closed: session.closed.promise,
    close(code?: number, reason?: string) {
      requestClose(session, code, reason);
    },
    [Symbol.asyncDispose]() {
      return dispose(session);
    },
    get state() {
      return session.status;
    },
    onRuntimeError(listener) {
      if (isUnavailable(session)) {
        return noop;
      }
      session.listeners.runtimeError.add(listener);
      return () => {
        session.listeners.runtimeError.delete(listener);
      };
    },
    onStateChange(listener) {
      if (isUnavailable(session)) {
        return noop;
      }
      session.listeners.stateChange.add(listener);
      return () => {
        session.listeners.stateChange.delete(listener);
      };
    },
    receive: createReceive(session),
    // PERF: the body stays in the method. Moving it into a function it calls measured 2.7% and 4.0% slower on a union send (Bun 1.4.4, 537 ns against 558 ns, two runs).
    send(message: unknown) {
      if (isUnavailable(session)) {
        throw new DOMException(
          "WebSocket session is closed",
          "InvalidStateError",
        );
      }
      const socket = session.socket;
      const initialState = session.status;
      const initialReadyState = socket?.readyState;
      const destination =
        initialState === "open" && initialReadyState === session.openState
          ? "socket"
          : initialState === "reconnecting"
            ? "queue"
            : undefined;
      if (!destination) {
        throw new DOMException(
          "WebSocket session is not writable",
          "InvalidStateError",
        );
      }

      const serialized = serializeOutgoingWebSocketMessage(
        session.outgoing,
        message,
      );
      if (
        isUnavailable(session) ||
        session.status !== initialState ||
        session.socket !== socket ||
        socket?.readyState !== initialReadyState
      ) {
        throw new DOMException(
          "WebSocket session is not writable",
          "InvalidStateError",
        );
      }

      // "socket" was chosen from the captured readyState, so this narrows without reading it again.
      if (destination === "socket" && socket !== undefined) {
        socket.send(serialized);
        return;
      }
      if (session.maxOutgoingQueueSize === 0) {
        throw new Error("WebSocket outgoing queue is disabled");
      }
      if (session.sendQueue.length >= session.maxOutgoingQueueSize) {
        throw new Error("WebSocket send queue overflow");
      }
      session.sendQueue.push(serialized);
    },
  };
}

function createReceive(session: Session): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = session.incomingQueue[Symbol.asyncIterator]();
      return {
        next() {
          // The session stops listening to the caller's signal once it has ended, so check it here.
          if (
            stopsUnreadItems(session.callerSignal, session.endedBeforeAbort)
          ) {
            session.incomingQueue.discard();
          }
          return iterator.next();
        },
      };
    },
  };
}

const noop = () => undefined;

function isUnavailable(session: Session): boolean {
  return session.final !== undefined || session.signal.aborted;
}

function validateWebSocketClose(
  code: number | undefined,
  reason: string | undefined,
): void {
  if (
    typeof code !== "undefined" &&
    (!Number.isInteger(code) || (code !== 1000 && (code < 3000 || code > 4999)))
  ) {
    throw new DOMException(
      "The close code must be 1000 or between 3000 and 4999",
      "InvalidAccessError",
    );
  }
  if (
    typeof reason !== "undefined" &&
    new TextEncoder().encode(reason).byteLength > 123
  ) {
    throw new DOMException(
      "The close reason must not exceed 123 UTF-8 bytes",
      "SyntaxError",
    );
  }
}

export function toClosedInfo(
  snapshot: WebSocketCloseSnapshot,
  fallback?: ManualSocketCloseReason,
): WebSocketCloseInfo {
  return {
    code: snapshot.code ?? fallback?.code,
    kind: "closed",
    reason: snapshot.reason ?? fallback?.reason,
    wasClean: snapshot.wasClean,
  };
}

function toAbortedInfo(
  snapshot: WebSocketCloseSnapshot,
  cause: unknown,
): WebSocketCloseInfo {
  return {
    cause,
    code: snapshot.code,
    kind: "aborted",
    reason: snapshot.reason,
    wasClean: snapshot.wasClean,
  };
}

export function toErrorInfo(
  snapshot: WebSocketCloseSnapshot,
  cause: unknown,
): WebSocketCloseInfo {
  return {
    cause,
    code: snapshot.code,
    kind: "error",
    reason: snapshot.reason,
    wasClean: snapshot.wasClean,
  };
}
