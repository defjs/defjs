import { statusOutcome } from "../../internal/attempt_outcome";
import type { FetchHandle } from "../../client/config";
import type {
  DecodeFault,
  FaultCode,
  HttpStatusFault,
  HttpStatusFaultOf,
  PreflightFault,
} from "../../error";
import {
  createDecodeFault,
  createHttpStatusFault,
  createNetworkFault,
  createPreflightFault,
  createUndecodedHttpStatusFault,
  ERR_TIMEOUT,
  isTimeoutCause,
} from "../../error";
import type { DoneInfo } from "../../balancer/balancer";
import {
  createFetchInitBase,
  isReadableStreamBody,
} from "../../http/transport/fetch_init";
import { concatChunks, parseBytesBody } from "../../internal/bytes";
import { parseMediaTypeEssence } from "../../internal/media_type";
import { isMediaTypeParametersWellFormed } from "../../internal/media_type_parameters";
import { getContentType, isJsonMediaType } from "../../http/transport/utils";
import {
  awaitWithSignal,
  mergeAbortSignals,
  releaseAbortSignal,
  resolveAbortedCause,
} from "../../internal/abort";
import { AsyncQueue } from "../../internal/async_queue";
import { computeReconnectDelay, wait } from "../../internal/backoff";
import type { RetryPolicy } from "../../internal/retry";
import { decideRetry, isRetryMethod } from "../../internal/retry";
import { fetchWithSignal, NULL_BODY_STATUSES } from "../../internal/fetch";
import type {
  HttpRequest,
  HttpResponseType,
} from "../../internal/http_request";
import type {
  DecodedResponse,
  HttpMeta,
  HttpResponse,
} from "../../internal/http_response";
import { makeResponse } from "../../internal/http_response";
import { resolveInboundRepresentation } from "../../internal/inbound_representation";
import { RequestUrlError, resolveRequestUrl } from "../../internal/url";
import type { AnyStruct } from "../../struct";
import { decodeJson } from "../../struct/codec/json";
import { StructError } from "../../struct/errors";
import { parseStructValue } from "../../struct/introspection";
import type { EventStreamMessage } from "./parser";
import {
  createLineParser,
  createMessageParser,
  readStreamBytes,
  SSEParserLimitError,
} from "./parser";

export const EVENT_STREAM_CONTENT_TYPE = "text/event-stream";
export const LAST_EVENT_ID_HEADER = "last-event-id";
const DEFAULT_RETRY_INTERVAL = 1000;
// Events waiting for the consumer. A full queue pauses reading the response; nothing is dropped.
const MAX_QUEUE_SIZE = 1024;

/**
 * Metadata available once an SSE response has opened.
 *
 * `response` is the handshake response and `url` is the resolved request URL. It is the third element of a successful event-stream result and the value of `EventStreamHandle.open`.
 *
 * @group sse
 */
export interface EventStreamOpenInfo {
  response: HttpResponse<unknown>;
  url: string;
}

/**
 * Fault codes an event stream can end with, drawn from the one shared `FaultCode` namespace.
 *
 * A subset of the shared `FaultCode` set. It is the `code` of an `EventStreamCloseInfo` with `kind: 'error'`.
 * `REQ_BUILD_FAILED` means a reconnect pick failed after the stream opened, or the picked endpoint gave an invalid URL or a URL with credentials. It stays that code; it is not rewritten to `NET_UNREACHABLE`.
 * `HTTP_STATUS` means a reconnect handshake answered with a non-2xx status; `cause` is then the same `HTTP_STATUS` fault a failed first handshake returns.
 *
 * @group sse
 */
export type EventStreamFaultCode = Extract<
  FaultCode,
  | "CAP_BUFFER_EXCEEDED"
  | "EXT_HOOK_FAILED"
  | "EXT_OBSERVER_FAILED"
  | "HTTP_STATUS"
  | "NET_TIMEOUT"
  | "NET_UNREACHABLE"
  | "REQ_BUILD_FAILED"
  | "RES_DECODE_FAILED"
  | "RES_MEDIA_TYPE_INVALID"
>;

interface EventStreamCloseInfoBase {
  reason?: string;
  cause?: unknown;
}

/**
 * How an SSE stream ended: clean EOF, abort, or an error carrying its fault `code`.
 *
 * The discriminant is `kind` so that `code` can mean the same thing it means on a fault.
 *
 * The value of `EventStreamHandle.closed`. `eof` means the response ended normally. `aborted` means the stream was closed with `close()` or disposal, or its caller signal aborted with a non-timeout reason; `reason` and `cause` carry the value passed to `close`. `close()`, disposal and a caller signal abort all discard the events nobody has read yet, as `EventSource.close()` does, and the iterator ends at once. If the caller signal aborts after open with a `TimeoutError` or `ERR_TIMEOUT`, the iterator throws `ERR_TIMEOUT` and `closed` is `{ kind: 'error', code: 'NET_TIMEOUT', ... }`. Explicit `close(timeoutError)` still reports `aborted`. `error` carries the fault `code` (see `EventStreamFaultCode`) and the failure as `cause`. A reconnect pick that fails after open, or that gives a URL the request cannot use (invalid, or with credentials), uses `REQ_BUILD_FAILED`. A reconnect handshake that ends the stream with a non-2xx status uses `HTTP_STATUS`, and its `cause` is the `HTTP_STATUS` fault, as for a failed first handshake. `closed` resolves when the connection ends, which can be before the iterator has read every event. After an `error` end, including a timeout, the events already queued are still delivered and the iterator rejects after the last one.
 *
 * @group sse
 */
export type EventStreamCloseInfo =
  | (EventStreamCloseInfoBase & { kind: "eof" })
  | (EventStreamCloseInfoBase & { kind: "aborted" })
  | (EventStreamCloseInfoBase & { code: EventStreamFaultCode; kind: "error" });

/**
 * Open SSE stream: iterate events, read open metadata, and close early.
 *
 * `EventStreamMessage` is the raw `{ id: string; event: string; data: string }` message. Handles returned by an event-stream operation carry parsed {@link EventStreamData}.
 *
 * `open` is the startup snapshot ({@link EventStreamOpenInfo}); after a reconnect it can change, so read `stream.open` again. `closed` resolves with an {@link EventStreamCloseInfo} when the stream ends.
 *
 * Prefer `await using stream = handle` for owned scope cleanup. The disposer stops Defjs reading and reconnect work and waits for its reader lock to be released; it does not promise that a provider-controlled, stuck `ReadableStream.cancel()` promise will finish. Manual `close()` / `closed` remains available.
 *
 * ```ts
 * async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
 *   await using stream = handle;
 *   for await (const event of stream) console.log(event);
 * }
 * ```
 *
 * Structural implementations of `EventStreamHandle` must implement `[Symbol.asyncDispose]()` and return the same owned teardown path. This is a compile-time requirement for custom handles; code that only receives handles returned by Defjs has no additional runtime call requirement.
 *
 * @group sse
 */
export interface EventStreamHandle<TEvent = EventStreamMessage>
  extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo;
  readonly closed: Promise<EventStreamCloseInfo>;
  close(reason?: unknown): void;
  [Symbol.asyncDispose](): PromiseLike<void>;
}

/** The decoded body of a non-2xx handshake, typed by the declared `error` struct. */
export type HandshakeBody<TError extends AnyStruct | undefined> =
  HttpStatusFault<TError>["data"];

/** Failure snapshot owned by one fetchEventStream invocation. */
export interface EventStreamFailureInfo<TBody = unknown> {
  open?: EventStreamOpenInfo;
  /** The failed handshake with its decoded error body. Absent when the body was not decoded. */
  decoded?: DecodedResponse<TBody>;
  /**
   * Why a declared error body was not decoded. A failed first handshake reports it, as `defineRequest`
   * does, because only a decoded body can fill the typed `data` of the status fault.
   */
  bodyFault?: DecodeFault;
}

export interface FetchEventStreamOptions<
  TEvent = EventStreamMessage,
  TError extends AnyStruct | undefined = AnyStruct | undefined,
> {
  fetch?: FetchHandle;
  /** @internal Carries startup failure metadata without annotating shared cause values. */
  failure?: EventStreamFailureInfo<HandshakeBody<TError>>;
  /** Optional struct for a non-2xx handshake body; fills the fault's `data` when declared. */
  handshakeError?: TError;
  onopen?: (open: EventStreamOpenInfo) => void | Promise<void>;
  onclose?: (open: EventStreamOpenInfo) => void | Promise<void>;
  onerror?: (
    error: unknown,
    context: FetchEventStreamErrorContext,
  ) => number | null | undefined | Promise<number | null | undefined>;
  transformMessage: (
    message: EventStreamMessage,
    signal: AbortSignal,
  ) => Promise<TEvent | undefined> | TEvent | undefined;
  retryInterval?: number;
  /** The resolved retry policy. Absent means the stream is not retried. */
  retry?: RetryPolicy;
  maxBufferSize: number;
  /**
   * @internal First-`next()` attribution. Absent when this stream must not
   * pick or call `done`. `done` runs once when the current attempt ends.
   * `pickNext` runs after a reconnect wait, before the next `Request`.
   */
  endpointAttempt?: {
    start?: () => void;
    end?: (info: DoneInfo) => void;
    done: (info: DoneInfo) => void;
    pickNext: () =>
      | readonly [PreflightFault, undefined]
      | readonly [
          null,
          {
            endpoint: string;
            start?: () => void;
            end?: (info: DoneInfo) => void;
            done: (info: DoneInfo) => void;
          },
        ];
  };
}

export interface FetchEventStreamErrorContext {
  lastEventId: string;
  retryCount: number;
  retryInterval: number;
  open?: EventStreamOpenInfo;
}

type EventStreamFatalCode = Exclude<
  EventStreamFaultCode,
  "HTTP_STATUS" | "NET_TIMEOUT" | "NET_UNREACHABLE" | "REQ_BUILD_FAILED"
>;

class EventStreamFatalError extends Error {
  readonly code: EventStreamFatalCode;
  cause?: unknown;

  constructor(
    code: EventStreamFatalCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "EventStreamFatalError";
    this.code = code;
    this.cause = options?.cause;
  }
}

// Only faults built here are handshake statuses; a coded error from a custom fetch is not one.
const handshakeStatusFaults = new WeakSet<object>();

export function getEventStreamFatalCode(
  error: unknown,
): EventStreamFatalCode | undefined {
  return error instanceof EventStreamFatalError ? error.code : undefined;
}

export function toEventStreamMeta(response: HttpResponse<unknown>): HttpMeta {
  return {
    headers: response.headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  };
}

/**
 * The `HTTP_STATUS` fault for a non-2xx handshake, with `data` when the declared error body decoded.
 * A body that could not be decoded leaves `data` undefined and its failure on `cause`. Interceptors,
 * the retry policy and a reconnect's `closed` all see this fault.
 */
export function createHandshakeStatusFault<TBody>(
  response: HttpResponse<unknown>,
  decoded?: DecodedResponse<TBody>,
  bodyFault?: DecodeFault,
): HttpStatusFaultOf<TBody> | HttpStatusFaultOf<undefined> {
  const fault = decoded
    ? createHttpStatusFault(decoded)
    : createUndecodedHttpStatusFault(toEventStreamMeta(response));
  if (bodyFault) {
    fault.cause = bodyFault.cause;
  }
  handshakeStatusFaults.add(fault);
  return fault;
}

function isHandshakeStatusFault(error: unknown): error is Error {
  return error instanceof Error && handshakeStatusFaults.has(error);
}

function toEventStreamFatalError(error: unknown): Error | undefined {
  if (error instanceof EventStreamFatalError) {
    return error;
  }
  if (error instanceof SSEParserLimitError) {
    return new EventStreamFatalError("CAP_BUFFER_EXCEEDED", error.message, {
      cause: error,
    });
  }
  return undefined;
}

/**
 * The Request constructor refuses a URL with credentials with a TypeError (Fetch, "new Request"), but Bun accepts it and
 * sends the request. Refusing here makes the outcome the same on every runtime and keeps it a build failure, not a
 * network failure. The message leaves the URL out, so the credentials never reach a log.
 */
function resolveAttemptUrl(request: HttpRequest): URL {
  const url = resolveRequestUrl(request);
  if (url.username !== "" || url.password !== "") {
    throw new RequestUrlError("The URL must not include credentials");
  }
  return url;
}

export async function fetchEventStream<
  TEvent = EventStreamMessage,
  TError extends AnyStruct | undefined = AnyStruct | undefined,
>(
  request: HttpRequest,
  options: FetchEventStreamOptions<TEvent, TError>,
): Promise<EventStreamHandle<TEvent>> {
  const policy = options.retry;
  let url = resolveAttemptUrl(request);
  const failure: EventStreamFailureInfo<HandshakeBody<TError>> =
    options.failure ?? {};
  const queue = new AsyncQueue<TEvent>({ maxSize: MAX_QUEUE_SIZE });
  const closedDeferred = Promise.withResolvers<EventStreamCloseInfo>();
  const openDeferred = Promise.withResolvers<EventStreamHandle<TEvent>>();
  const closeController = new AbortController();
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = new Headers(request.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", EVENT_STREAM_CONTENT_TYPE);
  }

  let settledClosed = false;
  let settledOpen = false;
  let retryInterval =
    options.retryInterval ?? policy?.delayMs ?? DEFAULT_RETRY_INTERVAL;
  let retryCount = 0;
  let lastEventId = "";
  // Headers validate every write. The id only matters to the next attempt, so it is applied there.
  let lastEventIdDirty = false;
  let latestOpen: EventStreamOpenInfo | undefined;
  let latestDecoded: DecodedResponse<HandshakeBody<TError>> | undefined;
  let latestBodyFault: DecodeFault | undefined;
  let disposeTask: Promise<void> | undefined;

  const handle: EventStreamHandle<TEvent> = {
    get open() {
      /* istanbul ignore if -- unreachable: handle is only returned after open resolves */
      if (!latestOpen) {
        throw new Error("Event stream has not been opened yet");
      }
      return latestOpen;
    },
    closed: closedDeferred.promise,
    close,
    [Symbol.asyncDispose]() {
      return disposeHandle();
    },
    [Symbol.asyncIterator]() {
      const iterator = queue[Symbol.asyncIterator]();
      let returned = false;
      return {
        next() {
          return returned
            ? Promise.resolve({ done: true, value: undefined })
            : iterator.next();
        },
        return() {
          if (!returned) {
            returned = true;
            handle.close("iterator-return");
          }
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };

  // Cleared after the one report for this attempt. Absent when the stream is not attributed.
  let reportAttempt: ((info: DoneInfo) => void) | undefined;
  let startAttempt: (() => void) | undefined;
  let endAttempt: ((info: DoneInfo) => void) | undefined;
  let fetchStarted = false;
  let handshake: DoneInfo | undefined;
  let reconnectPick = false;

  function beginAttempt(
    done: ((info: DoneInfo) => void) | undefined,
    start?: () => void,
    end?: (info: DoneInfo) => void,
  ): void {
    reportAttempt = done;
    startAttempt = start;
    endAttempt = end;
    fetchStarted = false;
    handshake = undefined;
  }

  function currentAttemptInfo(): DoneInfo {
    if (closeController.signal.aborted) {
      return { attempted: false };
    }
    const caller = request.signal;
    if (caller?.aborted) {
      if (fetchStarted && isTimeoutCause(caller.reason)) {
        return { attempted: true, code: "NET_TIMEOUT" };
      }
      return { attempted: false };
    }
    return handshake ?? { attempted: false };
  }

  function finishAttempt(): void {
    const report = reportAttempt;
    reportAttempt = undefined;
    if (report === undefined) {
      return;
    }
    report(currentAttemptInfo());
  }

  function noteFetchError(error: unknown): void {
    const code = createNetworkFault(error).code;
    if (code === "NET_TIMEOUT") {
      handshake = { attempted: true, code: "NET_TIMEOUT" };
      return;
    }
    if (code === "NET_ABORTED") {
      handshake = { attempted: false };
      return;
    }
    handshake = { attempted: true, code: "NET_UNREACHABLE" };
  }

  // start() contains its terminal catch; this fallback only guards a type-invariant failure outside that catch.
  const lifecycleTask = start().catch(
    /* istanbul ignore next -- @preserve */
    (error: unknown) => {
      finishError(error);
    },
  );
  return openDeferred.promise;

  function disposeHandle(): Promise<void> {
    return (disposeTask ??= Promise.resolve().then(disposeOnce));
  }

  async function disposeOnce(): Promise<void> {
    let closeError: unknown;
    let hasCloseError = false;
    try {
      handle.close();
    } catch (error) {
      hasCloseError = true;
      closeError = error;
      close();
    }

    await Promise.all([closedDeferred.promise, lifecycleTask]);
    if (hasCloseError) {
      throw closeError;
    }
  }

  function close(reason?: unknown): void {
    if (closeController.signal.aborted) {
      return;
    }

    closeController.abort(reason);
    // EventSource.close() sets CLOSED, after which queued dispatch tasks are skipped, so unread events are discarded.
    queue.discard();
    queue.close();
    settleClosed({
      kind: "aborted",
      reason: toCloseReason(reason),
      cause: reason,
    });
  }

  async function start(): Promise<void> {
    beginAttempt(
      options.endpointAttempt?.done,
      options.endpointAttempt?.start,
      options.endpointAttempt?.end,
    );
    while (!closeController.signal.aborted) {
      if (reconnectPick) {
        reconnectPick = false;
        const pickNext = options.endpointAttempt?.pickNext;
        if (pickNext) {
          const picked = pickNext();
          if (picked[0]) {
            finishError(picked[0]);
            return;
          }
          const next = picked[1];
          try {
            url = resolveAttemptUrl({
              ...request,
              baseEndpoint: next.endpoint,
            });
          } catch (error) {
            next.done({ attempted: false });
            finishError(createPreflightFault("REQ_BUILD_FAILED", error));
            return;
          }
          beginAttempt(next.done, next.start, next.end);
        }
      }
      const connectController = new AbortController();
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      let connectTimedOut = false;
      const retryAbort = mergeAbortSignals(closeController.signal, [
        request.signal,
      ]);
      const attemptAbort = mergeAbortSignals(retryAbort, [
        connectController.signal,
      ]);
      let response: Response | undefined;
      let readerStarted = false;
      // A startup failure reports this attempt's response only, not one left by a retried 503.
      if (!settledOpen) {
        latestOpen = undefined;
        latestDecoded = undefined;
        latestBodyFault = undefined;
      }

      try {
        if (lastEventIdDirty) {
          if (lastEventId) {
            const bytes = new TextEncoder().encode(lastEventId);
            let value = "";
            for (const byte of bytes) value += String.fromCharCode(byte);
            headers.set(LAST_EVENT_ID_HEADER, value);
          } else {
            headers.delete(LAST_EVENT_ID_HEADER);
          }
          lastEventIdDirty = false;
        }
        const eventRequest = new Request(
          url,
          createEventStreamRequestInit(request, headers, attemptAbort),
        );
        response = await fetchWithSignal(
          () => {
            startAttempt?.();
            fetchStarted = true;
            if (policy?.attemptTimeoutMs !== undefined)
              connectTimer = setTimeout(() => {
                connectTimedOut = true;
                connectController.abort(ERR_TIMEOUT);
              }, policy.attemptTimeoutMs);
            return fetchImpl(eventRequest);
          },
          attemptAbort,
          cancelLateResponseBody,
        );
        clearTimeout(connectTimer);
        handshake = {
          attempted: true,
          status: response.status,
          code: statusOutcome(response.status),
        };
        endAttempt?.(handshake);
        // Reading a declared error body can be cut short by an abort before an open info exists.
        // Attach the response first so the startup fault can still report that status.
        const handshakeResponse = response;
        const { open, decoded, bodyFault } = await createOpenInfo(
          handshakeResponse,
          options.handshakeError,
          attemptAbort,
        ).catch((error: unknown) => {
          latestOpen = toOpenInfo(handshakeResponse, null, false);
          throw error;
        });
        latestOpen = open;
        latestDecoded = decoded;
        latestBodyFault = bodyFault;

        validateOpenResponse(open, decoded, bodyFault);

        await runFatalHook(
          () => options.onopen?.(open),
          attemptAbort,
          "Event stream onopen callback failed",
        );
        retryCount = 0;

        if (!settledOpen) {
          settledOpen = true;
          openDeferred.resolve(handle);
        }

        // A 2xx event stream without a body (204, 205 on Node.js and Bun) is an empty stream that ends with eof.
        if (response.body) {
          readerStarted = true;
          await consumeEventStream(response.body, attemptAbort);
        }
        await runFatalHook(
          () => options.onclose?.(open),
          attemptAbort,
          "Event stream onclose callback failed",
        );

        queue.close();
        finishAttempt();
        settleClosed({ kind: "eof" });
        return;
      } catch (error) {
        clearTimeout(connectTimer);
        if (response?.body && !readerStarted) {
          void response.body.cancel(error).catch(() => undefined);
        }

        const normalizedError = normalizeAbortError(
          error,
          request.signal,
          closeController.signal,
        );

        if (
          !handshake &&
          fetchStarted &&
          !closeController.signal.aborted &&
          !request.signal?.aborted
        ) {
          if (connectTimedOut)
            handshake = { attempted: true, code: "NET_UNREACHABLE" };
          else noteFetchError(error);
        }

        endAttempt?.(currentAttemptInfo());
        if (closeController.signal.aborted || request.signal?.aborted) {
          finishAborted(retryAbort);
          return;
        }

        const retryError = normalizedError ?? error;
        // A non-2xx handshake is not fatal: the retry policy decides, and only 502, 503 and 504 retry by default.
        const fatalError = toEventStreamFatalError(retryError);
        if (fatalError) {
          await observeFatalError(fatalError, attemptAbort);
          if (closeController.signal.aborted || request.signal?.aborted) {
            finishAborted(retryAbort);
          } else {
            finishError(fatalError);
          }
          return;
        }

        // A stream body is spent by the first attempt and the request is built once per execute, so nothing can be
        // retried: no observer, retry policy or delay, and the caller gets the real failure. Keyed on the body
        // type, not `locked`: when a failed attempt locks the stream differs by runtime.
        if (isReadableStreamBody(request.body)) {
          finishError(retryError);
          return;
        }

        let retryDelay: number | null;
        try {
          retryDelay = await resolveRetryDelay(
            retryError,
            retryAbort,
            response,
          );
        } catch (policyError) {
          if (closeController.signal.aborted || request.signal?.aborted) {
            finishAborted(retryAbort);
          } else {
            finishError(policyError);
          }
          return;
        }

        if (typeof retryDelay !== "number" || retryDelay < 0) {
          finishError(retryError);
          return;
        }

        // Release this attempt before the backoff so it is not in flight while waiting.
        finishAttempt();
        try {
          await wait(retryDelay, retryAbort);
        } catch (waitError) {
          // wait() rejects only from the merged close/request abort signal.
          /* istanbul ignore else -- @preserve */
          if (closeController.signal.aborted || request.signal?.aborted) {
            finishAborted(retryAbort);
          } else {
            finishError(waitError);
          }
          return;
        }
        reconnectPick = true;
      } finally {
        clearTimeout(connectTimer);
        releaseAbortSignal(attemptAbort);
        releaseAbortSignal(retryAbort);
      }
    }
  }

  async function consumeEventStream(
    stream: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const parseMessage = createMessageParser(
      (id) => {
        lastEventId = id;
        lastEventIdDirty = true;
      },
      (retry) => {
        retryInterval = retry;
      },
      (message) => {
        // The parser reports a block's id before its message, so the stream's last event id
        // is the id this event carries, whether or not the block had its own id field.
        const { event, data } = message;
        const id = lastEventId;
        let result: Promise<TEvent | undefined> | TEvent | undefined;
        try {
          signal.throwIfAborted();
          result = options.transformMessage({ id, event, data }, signal);
        } catch (error) {
          throw toTransformFailure(error, signal);
        }
        // A synchronous transform is already done. Only a pending one needs the signal race.
        if (result instanceof Promise) {
          const pending = result;
          // The signal may have aborted before awaitWithSignal gets to subscribe. Keep observing
          // the transform so a late rejection cannot become unhandled.
          void pending.catch(() => undefined);
          signal.throwIfAborted();
          return awaitWithSignal(() => pending, signal).then(
            enqueue,
            (error: unknown) => {
              throw toTransformFailure(error, signal);
            },
          );
        }
        signal.throwIfAborted();
        return enqueue(result);
      },
      { maxBufferSize: options.maxBufferSize },
    );

    // A full queue pauses parsing, and with it the response reads, until the consumer takes an event.
    function enqueue(
      transformed: TEvent | undefined,
    ): Promise<void> | undefined {
      if (typeof transformed === "undefined") {
        return undefined;
      }
      const room = queue.waitForRoom();
      if (!room) {
        queue.push(transformed);
        return undefined;
      }
      return awaitWithSignal(() => room, signal).then(() => {
        queue.push(transformed);
      });
    }
    const parseLine = createLineParser(parseMessage, {
      maxBufferSize: options.maxBufferSize,
    });

    try {
      await readStreamBytes(stream, parseLine, signal, noteFetchError);
    } catch (error) {
      if (error instanceof SSEParserLimitError) {
        throw new EventStreamFatalError("CAP_BUFFER_EXCEEDED", error.message, {
          cause: error,
        });
      }
      throw error;
    }
  }

  async function resolveRetryDelay(
    error: unknown,
    signal: AbortSignal,
    response: Response | undefined,
  ): Promise<number | null> {
    retryCount += 1;

    const next = options.onerror
      ? await awaitWithSignal(
          () =>
            options.onerror?.(error, {
              lastEventId,
              retryCount,
              retryInterval,
              open: latestOpen,
            }),
          signal,
        )
      : undefined;

    if (next === null) {
      return null;
    }

    // Opt-in retry: without a policy the stream is not retried.
    if (!policy) {
      return null;
    }

    // A handshake status other than 502, 503 and 504 is not retried by default; every other failure is a
    // network failure of the handshake or of the open stream.
    const unavailable =
      response !== undefined &&
      statusOutcome(response.status) === "NET_UNAVAILABLE";
    const retry = await decideRetry(
      policy,
      retryCount - 1,
      signal,
      (attempt) => ({
        transport: "sse",
        attempt,
        cause: error,
        retryable:
          isRetryMethod(policy, request.method) &&
          (!isHandshakeStatusFault(error) || unavailable),
        method: request.method,
        lastEventId,
        open: latestOpen,
        status: response?.status,
      }),
    );
    if (!retry) {
      return null;
    }

    const delayMs = typeof next === "number" ? next : retryInterval;
    return computeReconnectDelay({ ...policy, delayMs }, retryCount);
  }

  async function observeFatalError(
    error: Error,
    signal: AbortSignal,
  ): Promise<void> {
    if (!options.onerror) {
      return;
    }

    try {
      await awaitWithSignal(
        () =>
          options.onerror?.(error, {
            lastEventId,
            retryCount,
            retryInterval,
            open: latestOpen,
          }),
        signal,
      );
    } catch {
      // Fatal errors own the terminal outcome; observers cannot replace them.
    }
  }

  async function runFatalHook(
    run: () => void | Promise<void> | undefined,
    signal: AbortSignal,
    fallback: string,
  ): Promise<void> {
    try {
      await awaitWithSignal(run, signal);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      throw new EventStreamFatalError(
        "EXT_HOOK_FAILED",
        error instanceof Error ? error.message : fallback,
        { cause: error },
      );
    }
  }

  function finishAborted(signal: AbortSignal): void {
    const abortedError = normalizeAbortReason(signal);
    if (abortedError === ERR_TIMEOUT) {
      finishError(ERR_TIMEOUT);
      return;
    }
    finishAttempt();
    const closeCause: unknown = signal.reason;
    failure.open = latestOpen;
    failure.decoded = latestDecoded;
    failure.bodyFault = latestBodyFault;

    if (settledOpen) {
      // A stop by the caller drops the events nobody has read, the same as close().
      queue.discard();
      queue.close();
    } else {
      settledOpen = true;
      openDeferred.reject(abortedError);
    }

    settleClosed({
      kind: "aborted",
      reason: toCloseReason(closeCause),
      cause: closeCause,
    });
  }

  function finishError(error: unknown): void {
    finishAttempt();
    failure.open = latestOpen;
    failure.decoded = latestDecoded;
    failure.bodyFault = latestBodyFault;
    if (settledOpen) {
      queue.fail(error);
    } else {
      settledOpen = true;
      openDeferred.reject(error);
    }

    settleClosed({
      cause: error,
      code: getEventStreamFaultCode(error),
      kind: "error",
      reason: toCloseReason(error),
    });
  }

  function settleClosed(info: EventStreamCloseInfo): void {
    if (settledClosed) {
      return;
    }

    settledClosed = true;
    closedDeferred.resolve(info);
  }
}

function toTransformFailure(error: unknown, signal: AbortSignal): unknown {
  return signal.aborted
    ? error
    : new EventStreamFatalError(
        "EXT_OBSERVER_FAILED",
        "Failed to process event stream message",
        { cause: error },
      );
}

export function isEventStreamPickFault(
  error: unknown,
): error is PreflightFault {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  const code = error.code;
  return code === "REQ_BUILD_FAILED";
}

function getEventStreamFaultCode(error: unknown): EventStreamFaultCode {
  if (isHandshakeStatusFault(error)) {
    return "HTTP_STATUS";
  }
  const fatal = getEventStreamFatalCode(error);
  if (fatal) {
    return fatal;
  }
  if (isEventStreamPickFault(error)) {
    return "REQ_BUILD_FAILED";
  }
  return error === ERR_TIMEOUT ? "NET_TIMEOUT" : "NET_UNREACHABLE";
}

function cancelLateResponseBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): void {
  discardStreamBody(body, signal.reason);
}

/** Release a body we will not read, ignoring a cancellation the provider refuses. */
function discardStreamBody(
  body: ReadableStream<Uint8Array>,
  reason?: unknown,
): void {
  void body.cancel(reason).catch(() => undefined);
}

async function createOpenInfo<TError extends AnyStruct | undefined>(
  response: Response,
  handshakeError: TError | undefined,
  signal: AbortSignal,
): Promise<{
  open: EventStreamOpenInfo;
  decoded?: DecodedResponse<HandshakeBody<TError>>;
  bodyFault?: DecodeFault;
}> {
  if (!response.ok && handshakeError) {
    const representation = resolveInboundRepresentation(handshakeError);
    const contentType = getContentType(response.headers);
    const unread = toOpenInfo(response, null, false);
    const meta = toEventStreamMeta(unread.response);
    // A null body status has no body, though Chromium and Firefox expose an empty stream for some.
    let stream = response.body;
    if (stream && NULL_BODY_STATUSES.has(response.status)) {
      discardStreamBody(stream);
      stream = null;
    }

    // Same as HTTP: a JSON declaration asserts the media type, and it is checked before anything
    // else, an absent body included. A mismatch leaves the body unread.
    if (representation === "json" && !isJsonMediaType(contentType)) {
      if (stream) {
        discardStreamBody(stream);
      }
      return {
        open: unread,
        bodyFault: createDecodeFault(
          "RES_MEDIA_TYPE_INVALID",
          new TypeError(
            `Expected a JSON media type, received ${contentType || "<none>"}`,
          ),
          meta,
        ),
      };
    }

    try {
      // No bytes arrived: every representation reads them as zero bytes, like Fetch. JSON cannot parse them.
      const raw = stream
        ? await readHandshakeBody(stream, representation, signal, contentType)
        : parseBytesBody(representation, new Uint8Array(0), contentType);
      // JSON uses the same alias-aware decoder as HTTP. Other kinds stay raw values.
      const body =
        representation === "json"
          ? decodeJson(handshakeError, raw)
          : parseStructValue(handshakeError, raw);
      const open = toOpenInfo(response, body, true);
      return { open, decoded: { ...toEventStreamMeta(open.response), body } };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      return {
        open: unread,
        bodyFault: createDecodeFault(
          error instanceof StructError
            ? "RES_STRUCT_MISMATCH"
            : "RES_DECODE_FAILED",
          error,
          meta,
        ),
      };
    }
  }

  if (!response.ok && response.body) {
    discardStreamBody(response.body);
  }

  return { open: toOpenInfo(response, null, false) };
}

function toOpenInfo(
  response: Response,
  body: unknown,
  decoded: boolean,
): EventStreamOpenInfo {
  const http = makeResponse<unknown>({
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    url: response.url,
    // An unread handshake stays absent. A decoded JSON null stays null.
    body: decoded ? body : undefined,
  });
  return {
    response: http,
    url: response.url,
  };
}

async function readHandshakeBody(
  stream: ReadableStream<Uint8Array>,
  representation: HttpResponseType,
  signal: AbortSignal,
  contentType: string,
): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  await readStreamBytes(
    stream,
    (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.byteLength;
    },
    signal,
  );
  const bytes = concatChunks(chunks, totalLength);
  return parseBytesBody(representation, bytes, contentType);
}

function createEventStreamRequestInit(
  request: HttpRequest,
  headers: Headers,
  abort?: AbortSignal,
): RequestInit & { duplex?: "half" } {
  return createFetchInitBase(request, {
    defaultAccept: EVENT_STREAM_CONTENT_TYPE,
    headers,
    signal: abort,
  });
}

function validateOpenResponse<TBody>(
  open: EventStreamOpenInfo,
  decoded?: DecodedResponse<TBody>,
  bodyFault?: DecodeFault,
): void {
  const { response } = open;
  if (!response.ok) {
    throw createHandshakeStatusFault(response, decoded, bodyFault);
  }

  const contentType = response.headers.get("content-type") || "";
  if (
    parseMediaTypeEssence(contentType) !== EVENT_STREAM_CONTENT_TYPE ||
    !isMediaTypeParametersWellFormed(contentType)
  ) {
    throw new EventStreamFatalError(
      "RES_MEDIA_TYPE_INVALID",
      `Expected content-type to start with ${EVENT_STREAM_CONTENT_TYPE}, got ${contentType || "(empty)"}`,
    );
  }
}

function normalizeAbortError(
  error: unknown,
  requestAbort?: AbortSignal,
  closeAbort?: AbortSignal,
): unknown {
  const signal = closeAbort?.aborted
    ? closeAbort
    : requestAbort?.aborted
      ? requestAbort
      : undefined;
  if (!signal?.aborted) {
    return error;
  }

  return normalizeAbortReason(signal);
}

function normalizeAbortReason(signal: AbortSignal): Error {
  return resolveAbortedCause(signal);
}

function toCloseReason(reason: unknown): string | undefined {
  if (reason instanceof Error) {
    return reason.message;
  }

  if (typeof reason === "string") {
    return reason;
  }

  return undefined;
}
