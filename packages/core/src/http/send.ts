import type { DoneInfo } from "../balancer/balancer";
import type { ResolvedEndpoint } from "../balancer/runtime";
import type { FetchHandle } from "../client/config";
import { ERR_FETCH_UNSUPPORTED } from "../client/config";
import type { DecodeFault, FaultCode, PreflightFault } from "../error";
import {
  ERR_TIMEOUT,
  createDecodeFault,
  createNetworkFault,
  createPreflightFault,
} from "../error";
import { networkCauseCode } from "../error/cause";
import { statusOutcome } from "../internal/attempt_outcome";
import { followAbort, resolveAbortCause } from "../internal/abort";
import { rejectAs, rejected } from "../internal/chain_faults";
import type { HttpRequest } from "../internal/http_request";
import type { HttpResponse } from "../internal/http_response";
import type { CallScope } from "../internal/preflight";
import { RequestUrlError, resolveRequestUrl } from "../internal/url";
import type { AnyBodyFailure, BodyFailure } from "./transport/body_failure";
import { isBodyFailure } from "./transport/body_failure";
import type { FetchLifecycle } from "./transport/fetch";
import { fetchHandlerWithLifecycle } from "./transport/fetch";
import {
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  isReadableStreamBody,
} from "./transport/fetch_init";

/** What a send leaves for the balancer report: whether it reached the selected endpoint, and what it saw there. */
interface SendOutcome {
  readonly landed: boolean;
  readonly info?: DoneInfo;
}

const NOT_LANDED: SendOutcome = { landed: false };

/** Timeout and abort are decided from the call's final fault, which can replace a status. */
const LANDED: SendOutcome = { landed: true };

export const NOT_ATTEMPTED: DoneInfo = { attempted: false };

/** One `next()` of the interceptor chain. An attempt keeps one record per call, in call order. */
export interface Send {
  /** Stops this send alone. A body that already failed leaves nothing to stop; see `abortSends`. */
  readonly controller: AbortController;
  /** Stops following the signal an interceptor swapped in; `undefined` while it kept the attempt's. */
  unlink: (() => void) | undefined;
  /** The request went to the endpoint the balancer picked, so its outcome is what the balancer is told. */
  readonly matches: boolean;
  /** `fetch` was started. */
  started: boolean;
  /** `fetch` was handed a caller-supplied `ReadableStream`. */
  streamed: boolean;
  /** The upload body stopped for good: its source errored or its observer failed. */
  bodyFailed: boolean;
  /** Bounds the send when the retry policy has an `attemptTimeoutMs`. Only a started send to the endpoint has one. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** The promise `next()` returned while the send is unsettled, so that a settled send does not keep its response. */
  pending: Promise<HttpResponse<unknown>> | undefined;
  /** Set once, when the send settles. */
  outcome: SendOutcome | undefined;
}

/** What a send that failed, or an interceptor that threw, makes of the call. */
export type ChainFault = DecodeFault | PreflightFault;

/** The state of one attempt that its sends share. */
export interface Attempt {
  readonly scope: CallScope;
  readonly endpoint: ResolvedEndpoint;
  readonly handle: FetchHandle;
  readonly timeoutMs: number | undefined;
  /** Every `next()` of the attempt, in call order. */
  readonly sends: Send[];
  /** Every method `fetch` was started for, in order: an interceptor can send more than one request. */
  readonly methods: string[];
  /** The method of the last request sent; the defined method until one is sent. */
  method: string;
  /** The fault behind each value a send rejected with; see chain_faults.ts. Most attempts never need it. */
  faults: Map<unknown, ChainFault> | undefined;
  /** The chain has settled: a later `next()` is refused. */
  settled: boolean;
  /** The request body is not a stream that a send could have used up. */
  replayable: boolean;
  timedOut: boolean;
  /** The caller's signal aborted while a send to the endpoint was in flight. */
  abortedWhileSending: boolean;
  /** No endpoint could be used: the pick failed or the selected URL did not resolve. */
  unselected: boolean;
  /** The balancer report, set when the attempt has its result. A throw before that reports `NOT_ATTEMPTED`. */
  info: DoneInfo;
}

/**
 * The terminal handler of the interceptor chain: sends `request` with the transport and records the send.
 * An interceptor that sends several requests gets one record per call. The balancer is told the outcome of the last
 * send to the picked endpoint, even if an earlier one settles later.
 */
export function send(
  attempt: Attempt,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  if (attempt.settled) {
    return rejected(
      new Error(
        "HTTP interceptor next() cannot be called after the chain has settled",
      ),
    );
  }

  const signal = attempt.scope.signal;
  const record: Send = {
    controller: new AbortController(),
    unlink: undefined,
    matches: request.baseEndpoint === attempt.endpoint.endpoint,
    started: false,
    streamed: false,
    bodyFailed: false,
    timer: undefined,
    pending: undefined,
    outcome: undefined,
  };
  attempt.sends.push(record);
  if (signal.aborted) {
    record.controller.abort(signal.reason);
  }

  try {
    resolveRequestUrl(request);
  } catch (error) {
    record.outcome = NOT_LANDED;
    return rejectAs(
      (attempt.faults ??= new Map()),
      error,
      createPreflightFault("REQ_BUILD_FAILED", error),
    );
  }
  // The controller already follows the attempt's signal through abortSends. Only an interceptor that swapped
  // the signal needs one more listener.
  if (request.signal !== undefined && request.signal !== signal) {
    record.unlink = followAbort(record.controller, request.signal);
  }
  const due = resolveAbortCause(record.controller.signal);
  if (due) {
    // Already aborted: fetch never starts, so this next() did not reach the endpoint.
    record.outcome = NOT_LANDED;
    return rejectAs(
      (attempt.faults ??= new Map()),
      due,
      createNetworkFault(due),
    );
  }
  if (isReadableStreamBody(request.body)) {
    attempt.replayable = false;
  }

  const sendSignal = record.controller.signal;
  const pending = fetchHandlerWithLifecycle(
    { ...request, signal: sendSignal },
    attempt.handle,
    lifecycle(attempt, record, request.method),
  ).then(
    (settled) => {
      record.pending = undefined;
      if (record.timer !== undefined) clearTimeout(record.timer);
      record.outcome = {
        landed: true,
        info: {
          attempted: true,
          status: settled.status,
          code: statusOutcome(settled.status),
        },
      };
      return settled;
    },
    (error: unknown) => {
      record.pending = undefined;
      if (record.timer !== undefined) clearTimeout(record.timer);
      // Cancellation outranks whatever the transport was doing when it noticed. Recording the fault here is the
      // only way to tell a dead server from an interceptor that threw the same value: both reach the chain's
      // catch as one bare cause.
      const surfaced = resolveAbortCause(sendSignal) ?? error;
      const outcome = classifySend(error, record);
      if (record.matches) {
        attempt.endpoint.end(
          reportOf(outcome, networkCauseCode(surfaced), true),
        );
      }
      record.outcome = outcome;
      // A request refused before it was sent is shown as the hook or platform error behind it.
      const shown = isLocalFailure(surfaced) ? surfaced.cause : surfaced;
      (attempt.faults ??= new Map()).set(shown, transportFault(surfaced));
      throw shown;
    },
  );
  record.pending = pending;
  return pending;
}

/** Each send to the endpoint has its own timer; interceptor work and decoding are not timed. */
function lifecycle(
  attempt: Attempt,
  record: Send,
  method: string,
): FetchLifecycle {
  return {
    start(streamed) {
      record.started = true;
      record.streamed = streamed;
      attempt.methods.push(method);
      attempt.method = method;
      if (!record.matches) return;
      attempt.endpoint.start();
      if (attempt.timeoutMs !== undefined) {
        record.timer = setTimeout(() => {
          attempt.timedOut = true;
          attempt.scope.controller.abort(ERR_TIMEOUT);
        }, attempt.timeoutMs);
      }
    },
    response(response) {
      if (record.matches) {
        attempt.endpoint.end({
          attempted: true,
          status: response.status,
          code: statusOutcome(response.status),
        });
      }
    },
    bodyFailed() {
      record.bodyFailed = true;
    },
  };
}

/**
 * Aborts every send. A send whose body already failed and that has settled leaves nothing to stop, and Chromium
 * reports an abort after that as an unhandled rejection. Every other send needs the abort to release its body.
 */
export function abortSends(sends: readonly Send[], reason: unknown): void {
  for (const record of sends) {
    if (record.bodyFailed && record.outcome !== undefined) continue;
    record.controller.abort(reason);
  }
}

/** Whether a send to the endpoint is on the wire. */
export function isSending(sends: readonly Send[]): boolean {
  return sends.some(
    (record) =>
      record.matches && record.started && record.outcome === undefined,
  );
}

/** The outcome of the last send to the endpoint that has settled. A later send wins even if an earlier one settles after it. */
function lastOutcome(sends: readonly Send[]): SendOutcome | undefined {
  for (let index = sends.length - 1; index >= 0; index--) {
    const record = sends[index];
    if (record?.matches && record.outcome !== undefined) {
      return record.outcome;
    }
  }
  return undefined;
}

/** Map a fetchHandler rejection onto the attempt that reached the selected endpoint. */
function classifySend(
  error: unknown,
  { started, streamed }: Send,
): SendOutcome {
  if (
    !started ||
    error === ERR_FETCH_UNSUPPORTED ||
    error === ERR_STREAMING_REQUEST_UNSUPPORTED
  ) {
    return NOT_LANDED;
  }
  if (isBodyFailure(error)) {
    if (error.code === "NET_BODY_INCOMPLETE") {
      return {
        landed: true,
        info: {
          attempted: true,
          code: "NET_BODY_INCOMPLETE",
          status: error.meta.status,
        },
      };
    }
    if (error.meta === undefined) {
      return NOT_LANDED;
    }
    return {
      landed: true,
      info: {
        attempted: true,
        status: error.meta.status,
        code: statusOutcome(error.meta.status),
      },
    };
  }
  if (networkCauseCode(error) === "NET_UNREACHABLE") {
    // With a streamed request body, fetch rejects with the same network error whether the endpoint is
    // down, the connection is HTTP/1.x, a redirect cannot replay the stream, a CORS preflight failed,
    // or the body source itself threw. None of these shows the endpoint is down, so none is attributed.
    if (streamed) {
      return NOT_LANDED;
    }
    return {
      landed: true,
      info: { attempted: true, code: "NET_UNREACHABLE" },
    };
  }
  return LANDED;
}

/**
 * Fold the outcome of the last send to the endpoint and the code of the call's final fault into the one `done`
 * report.
 *
 * No landed send is `{ attempted: false }`, including a timeout that fired
 * before fetch. A call that ends as `NET_TIMEOUT` while a send to the endpoint
 * was in flight reports `NET_TIMEOUT` and drops any status already noted; a
 * timeout during interceptor work after the send settled keeps the endpoint's
 * own outcome. `NET_ABORTED` is never an attempt.
 */
function reportOf(
  outcome: SendOutcome | undefined,
  code: FaultCode | undefined,
  abortedWhileSending: boolean,
): DoneInfo {
  if (code === "NET_ABORTED") {
    return NOT_ATTEMPTED;
  }
  if (
    outcome?.landed === true &&
    code === "NET_TIMEOUT" &&
    abortedWhileSending
  ) {
    return { attempted: true, code: "NET_TIMEOUT" };
  }
  return outcome?.info ?? NOT_ATTEMPTED;
}

/** The `done` report of an attempt that ended with a fault coded `code`, or with success when `code` is undefined. */
export function attemptReport(
  attempt: Attempt,
  code: FaultCode | undefined,
): DoneInfo {
  return reportOf(
    lastOutcome(attempt.sends),
    code,
    attempt.abortedWhileSending,
  );
}

/** The fault for a value that carries its own code wherever it came from: an invalid URL or a tagged body failure. */
function taggedFault(error: unknown): ChainFault | undefined {
  if (error instanceof RequestUrlError) {
    return createPreflightFault("REQ_BUILD_FAILED", error);
  }
  // The transport only reads a side that declared a struct, so a tagged body failure belongs to that side.
  // Failures before the request is sent (upload observer, finalizeHeaders, a used body stream) are also tagged, without response metadata.
  return isBodyFailure(error) ? fromBodyFailure(error) : undefined;
}

/** The fault a rejected send stands for: `surfaced` is what the transport rejected with, or the abort cause that outranks it. */
function transportFault(surfaced: unknown): ChainFault {
  return (
    taggedFault(surfaced) ??
    (surfaced === ERR_STREAMING_REQUEST_UNSUPPORTED ||
    surfaced === ERR_FETCH_UNSUPPORTED
      ? createPreflightFault("ENV_UNSUPPORTED", surfaced)
      : createNetworkFault(surfaced))
  );
}

/**
 * The fault for a value no send rejected with: the interceptor's own throw. Recognized cancellation shapes stay
 * cancellation wherever they came from; anything else belongs to the interceptor.
 */
export function foreignFault(error: unknown): ChainFault {
  return (
    taggedFault(error) ??
    (networkCauseCode(error) === "NET_UNREACHABLE"
      ? createPreflightFault("EXT_INTERCEPTOR_FAILED", error)
      : createNetworkFault(error))
  );
}

/** A request refused before it was sent: the hook or platform error behind it is what interceptors are shown. */
function isLocalFailure(
  value: unknown,
): value is BodyFailure<"EXT_HOOK_FAILED" | "REQ_BUILD_FAILED"> {
  return (
    isBodyFailure(value) &&
    (value.code === "EXT_HOOK_FAILED" || value.code === "REQ_BUILD_FAILED")
  );
}

/** Map a transport-tagged body failure onto the fault it was classified as. */
function fromBodyFailure(failure: AnyBodyFailure): ChainFault {
  const { cause, code, meta } = failure;

  if (code === "RES_DECODE_FAILED" || code === "RES_MEDIA_TYPE_INVALID") {
    return createDecodeFault(code, cause, meta);
  }

  return createPreflightFault(code, cause, meta);
}
