import { pickEndpoint } from "../balancer/runtime";
import type { AnyFault } from "../error";
import { createNetworkFault, createPreflightFault } from "../error";
import type { WebSocketSessionLike } from "../interceptor/interceptor";
import { awaitWithSignal } from "../internal/abort";
import { computeReconnectDelay, wait } from "../internal/backoff";
import type { RetryPolicy } from "../internal/retry";
import { retryStep } from "../internal/retry";
import type { AttemptOutcome } from "./attempt";
import { doneInfoForNetworkCause, openSocket, runAttempt } from "./attempt";
import type { Session, SessionConfig } from "./session";
import {
  createSession,
  finish,
  finishFromSignal,
  finishWithFault,
  report,
  setState,
  toClosedInfo,
  toErrorInfo,
} from "./session";
import { createWebSocketUrlFromRequest } from "./build";

type StageOutcome<T> =
  [fault: AnyFault, value: undefined] | [fault: undefined, value: T];

/** Creates the session and starts its lifecycle. The promise settles with the session at its first open, or fails the call. */
export function startSession(config: SessionConfig): {
  session: Session;
  opened: Promise<WebSocketSessionLike>;
} {
  const startup = Promise.withResolvers<WebSocketSessionLike>();
  const session = createSession(config, startup);
  /* istanbul ignore next -- @preserve defensive: run() settles every attempt, hook and delay inside its own failure boundaries */
  session.lifecycle = run(session).catch((cause) => {
    finishWithFault(
      session,
      { cause, kind: "error" },
      createNetworkFault(cause),
    );
  });
  return { session, opened: startup.promise };
}

async function run(session: Session): Promise<void> {
  while (session.final === undefined) {
    const url = await nextUrl(session);
    if (url === undefined) {
      return;
    }
    const opened = openSocket(session, url);
    if (!opened.ok) {
      // A constructor that threw is a local build failure, deterministic like a refused request in HTTP and
      // SSE: retrying it would only wait out the backoff, and the retry function is not asked.
      const { cause } = opened;
      report(session, doneInfoForNetworkCause(cause));
      finishWithFault(
        session,
        toErrorInfo(
          {
            reason:
              cause instanceof Error
                ? cause.message
                : "WebSocket connection error",
          },
          cause,
        ),
        createNetworkFault(cause),
      );
      return;
    }
    const outcome = await runAttempt(session, opened.socket);
    if (session.final !== undefined || !(await reconnects(session, outcome))) {
      return;
    }
  }
}

/** The URL of the next attempt, or `undefined` once the session has ended instead. */
async function nextUrl(session: Session): Promise<string | undefined> {
  const { signal } = session;
  if (signal.aborted) {
    finishFromSignal(session);
    return undefined;
  }

  setState(session, session.retried === 0 ? "connecting" : "reconnecting");

  const [fault, url] = await prepareAttempt(session);
  if (session.final !== undefined) {
    return undefined;
  }
  if (fault !== undefined) {
    if (signal.aborted) {
      finishFromSignal(session);
    } else {
      finishWithFault(session, { cause: fault, kind: "error" }, fault);
    }
    return undefined;
  }
  if (signal.aborted) {
    finishFromSignal(session);
    return undefined;
  }
  return url;
}

/**
 * What follows an attempt that ended. Waits out the backoff and returns true when the policy asks for another
 * attempt. Otherwise it ends the session, as the caller's stop, the policy or the way the attempt ended require.
 */
async function reconnects(
  session: Session,
  outcome: AttemptOutcome,
): Promise<boolean> {
  const { retry, signal } = session;
  if (session.startup !== undefined) {
    session.connection = outcome.connection;
  }

  if (signal.aborted) {
    finishFromSignal(session, outcome.closeInfo);
    return false;
  }

  if (session.manualClose) {
    finish(session, toClosedInfo(outcome.closeInfo, session.manualClose));
    return false;
  }

  // Every close the caller did not ask for is retryable by default, a connection that never opened included.
  if (retry !== undefined) {
    const step = await retryStep(
      retry,
      session.retried,
      signal,
      (upcoming) => ({
        transport: "websocket",
        attempt: upcoming,
        cause: outcome.cause,
        retryable: true,
        code: outcome.closeInfo.code,
        reason: outcome.closeInfo.reason,
        wasClean: outcome.closeInfo.wasClean,
      }),
    );
    // The session can finish while the answer is on its way; every finish aborts this signal.
    if (session.final !== undefined) {
      return false;
    }
    if (signal.aborted) {
      finishFromSignal(session, outcome.closeInfo);
      return false;
    }
    if (typeof step !== "string") {
      // As `defineRequest` does for a throwing retry function: the fault names the hook, `cause` is what it threw.
      finishWithFault(
        session,
        toErrorInfo(outcome.closeInfo, step.cause),
        step,
      );
      return false;
    }
    if (step === "retry") {
      return backOff(session, retry, outcome);
    }
  }

  if (session.startup !== undefined) {
    const cause = outcome.cause ?? new Error("WebSocket closed before open");
    finishWithFault(
      session,
      toErrorInfo(outcome.closeInfo, cause),
      createNetworkFault(cause),
    );
    return false;
  }

  finish(
    session,
    outcome.cause === undefined
      ? toClosedInfo(outcome.closeInfo)
      : toErrorInfo(outcome.closeInfo, outcome.cause),
  );
  return false;
}

/** Counts the retry and waits out the delay. False when the session ended meanwhile. */
async function backOff(
  session: Session,
  retry: RetryPolicy,
  outcome: AttemptOutcome,
): Promise<boolean> {
  const { signal } = session;
  session.retried += 1;
  setState(session, "reconnecting");
  if (session.final !== undefined) {
    return false;
  }
  if (signal.aborted) {
    finishFromSignal(session, outcome.closeInfo);
    return false;
  }
  const delayMs = computeReconnectDelay(retry, session.retried);
  if (delayMs > 0) {
    try {
      await wait(delayMs, signal);
    } catch {
      if (session.final === undefined) {
        finishFromSignal(session, outcome.closeInfo);
      }
      return false;
    }
  }
  return true;
}

/** The URL of the next attempt, after the pick and the `beforeConnect` hook; or the fault that ends the session. */
async function prepareAttempt(session: Session): Promise<StageOutcome<string>> {
  let request = session.request;
  if (session.attributable && session.pick === undefined) {
    const [fault, picked] = pickEndpoint(session.clientConfig.balancer, {
      endpoints: session.clientConfig.endpoints,
      operation: session.operation,
    });
    if (fault) {
      return [fault, undefined];
    }
    session.pick = picked;
    request = { ...request, baseEndpoint: picked.endpoint };
  }

  let url: string;
  try {
    url = createWebSocketUrlFromRequest(request);
  } catch (error) {
    return [createPreflightFault("REQ_BUILD_FAILED", error), undefined];
  }

  const { beforeConnect, signal } = session;
  if (beforeConnect) {
    try {
      await awaitWithSignal(
        () => beforeConnect({ attempt: session.retried, signal }),
        signal,
      );
      signal.throwIfAborted();
    } catch (error) {
      return [createPreflightFault("EXT_HOOK_FAILED", error), undefined];
    }
  }

  return [undefined, url];
}
