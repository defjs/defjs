import { statusOutcome } from "../../internal/attempt_outcome";
import type { ClientSSEOptions, FetchHandle } from "../../client/config";
import type { FaultCode, PreflightFault } from "../../error";
import {
  createNetworkFault,
  createPreflightFault,
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
import { normalizeReconnectOptions } from "../../internal/reconnect_options";
import { fetchWithSignal } from "../../internal/fetch";
import type {
  HttpRequest,
  HttpResponseType,
} from "../../internal/http_request";
import type { HttpResponse } from "../../internal/http_response";
import { makeResponse } from "../../internal/http_response";
import { resolveInboundRepresentation } from "../../internal/inbound_representation";
import { resolveRequestUrl } from "../../internal/url";
import type { AnyStruct } from "../../struct";
import { decodeJson } from "../../struct/codec/json";
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
export const SSE_RECONNECT_DEFAULTS = {
  delayMs: DEFAULT_RETRY_INTERVAL,
  factor: 1,
  jitter: 0,
  maxDelayMs: Number.POSITIVE_INFINITY,
};
// RFC 9110 §9.2.2 idempotent methods that Fetch can send (it forbids TRACE).
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PUT",
]);

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
 * `REQ_BUILD_FAILED` and `REQ_OPTIONS_INVALID` mean a reconnect pick failed after the stream opened. They stay those codes; they are not rewritten to `NET_UNREACHABLE`.
 *
 * @group sse
 */
export type EventStreamFaultCode = Extract<
  FaultCode,
  | "CAP_BUFFER_EXCEEDED"
  | "CAP_QUEUE_OVERFLOW"
  | "EXT_HOOK_FAILED"
  | "EXT_OBSERVER_FAILED"
  | "NET_TIMEOUT"
  | "NET_UNREACHABLE"
  | "REQ_BUILD_FAILED"
  | "REQ_OPTIONS_INVALID"
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
 * The value of `EventStreamHandle.closed`. `eof` means the response ended normally. `aborted` means the stream was closed with `close()` or disposal, or its caller signal aborted with a non-timeout reason; `reason` and `cause` carry the value passed to `close`. If the caller signal aborts after open with a `TimeoutError` or `ERR_TIMEOUT`, the iterator throws `ERR_TIMEOUT` and `closed` is `{ kind: 'error', code: 'NET_TIMEOUT', ... }`. Explicit `close(timeoutError)` still reports `aborted`. `error` carries the fault `code` (see `EventStreamFaultCode`) and the failure as `cause`. A reconnect pick that fails after open uses `REQ_BUILD_FAILED`, or `REQ_OPTIONS_INVALID` when the failure is a balancer option error.
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

/** Failure snapshot owned by one fetchEventStream invocation. */
export interface EventStreamFailureInfo {
  open?: EventStreamOpenInfo;
}

export interface FetchEventStreamOptions<TEvent = EventStreamMessage> {
  fetch?: FetchHandle;
  /** @internal Carries startup failure metadata without annotating shared cause values. */
  failure?: EventStreamFailureInfo;
  /** Optional struct for a non-2xx handshake body; fills the fault's `data` when declared. */
  handshakeError?: AnyStruct;
  onopen?: (open: EventStreamOpenInfo) => void | Promise<void>;
  onclose?: (open: EventStreamOpenInfo) => void | Promise<void>;
  onerror?: (
    error: unknown,
    context: FetchEventStreamErrorContext,
  ) => number | null | undefined | Promise<number | null | undefined>;
  transformMessage?: (
    message: EventStreamMessage,
    signal: AbortSignal,
  ) => Promise<TEvent | undefined> | TEvent | undefined;
  retryInterval?: number;
  reconnect?: ClientSSEOptions["reconnect"];
  maxBufferSize: number;
  maxQueueSize: number;
  /**
   * @internal First-`next()` attribution. Absent when this stream must not
   * pick or call `done`. `done` runs once when the current attempt ends.
   * `pickNext` runs after a reconnect wait, before the next `Request`.
   */
  endpointAttempt?: {
    start?(): void;
    end?(info: DoneInfo): void;
    done(info: DoneInfo): void;
    pickNext():
      | readonly [PreflightFault, undefined]
      | readonly [
          null,
          {
            endpoint: string;
            start?(): void;
            end?(info: DoneInfo): void;
            done(info: DoneInfo): void;
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
  "NET_TIMEOUT" | "NET_UNREACHABLE" | "REQ_BUILD_FAILED" | "REQ_OPTIONS_INVALID"
>;

class EventStreamFatalError extends Error {
  readonly code: EventStreamFatalCode;
  readonly statusSignal: boolean;
  cause?: unknown;

  constructor(
    code: EventStreamFatalCode,
    message: string,
    options?: { cause?: unknown; statusSignal?: boolean },
  ) {
    super(message);
    this.name = "EventStreamFatalError";
    this.code = code;
    this.cause = options?.cause;
    // A non-2xx status is not itself a decode failure. Real body failures leave this unset.
    this.statusSignal = options?.statusSignal === true;
  }
}

export function getEventStreamFatalCode(
  error: unknown,
): EventStreamFatalCode | undefined {
  return error instanceof EventStreamFatalError ? error.code : undefined;
}

export function isHandshakeStatusSignal(error: unknown): boolean {
  return error instanceof EventStreamFatalError && error.statusSignal;
}

export function handshakeDecodeCause(error: unknown): unknown {
  if (error instanceof EventStreamFatalError && error.cause !== undefined) {
    return error.cause;
  }
  return error;
}

function toEventStreamFatalError(
  error: unknown,
): EventStreamFatalError | undefined {
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

export async function fetchEventStream<TEvent = EventStreamMessage>(
  request: HttpRequest,
  options: FetchEventStreamOptions<TEvent>,
): Promise<EventStreamHandle<TEvent>> {
  const reconnect = normalizeReconnectOptions(
    options.reconnect,
    SSE_RECONNECT_DEFAULTS,
    "SSE",
  );
  let url = resolveRequestUrl(request);
  const failure: EventStreamFailureInfo = options.failure ?? {};
  const queue = new AsyncQueue<TEvent>({ maxSize: options.maxQueueSize });
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
    options.retryInterval ?? reconnect?.delayMs ?? DEFAULT_RETRY_INTERVAL;
  let retryCount = 0;
  let lastEventId = "";
  // Headers validate every write. The id only matters to the next attempt, so it is applied there.
  let lastEventIdDirty = false;
  let latestOpen: EventStreamOpenInfo | undefined;
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
    queue.close();
    settleClosed({
      kind: "aborted",
      reason: toCloseReason(reason),
      cause: reason,
    });
  }

  async function start(): Promise<void> {
    beginAttempt(
      // eslint-disable-next-line @typescript-eslint/unbound-method -- INTENT: preserve three separate endpointAttempt getter reads and pass callbacks through for bare invocation or undefined
      options.endpointAttempt?.done,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- INTENT: preserve three separate endpointAttempt getter reads and pass callbacks through for bare invocation or undefined
      options.endpointAttempt?.start,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- INTENT: preserve three separate endpointAttempt getter reads and pass callbacks through for bare invocation or undefined
      options.endpointAttempt?.end,
    );
    while (!closeController.signal.aborted) {
      if (reconnectPick) {
        reconnectPick = false;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- INTENT: read endpointAttempt once and invoke the picker as a bare function; undefined skips picking
        const pickNext = options.endpointAttempt?.pickNext;
        if (pickNext) {
          const picked = pickNext();
          if (picked[0]) {
            finishError(picked[0]);
            return;
          }
          const next = picked[1];
          try {
            url = resolveRequestUrl({
              ...request,
              baseEndpoint: next.endpoint,
            });
          } catch (error) {
            next.done({ attempted: false });
            finishError(createPreflightFault("REQ_BUILD_FAILED", error));
            return;
          }
          // eslint-disable-next-line @typescript-eslint/unbound-method -- INTENT: invoke reconnect callbacks as bare functions and pass optional callbacks through as undefined
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
            if (reconnect?.connectTimeoutMs !== undefined)
              connectTimer = setTimeout(() => {
                connectTimedOut = true;
                connectController.abort(ERR_TIMEOUT);
              }, reconnect.connectTimeoutMs);
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
        // The JSON media-type precheck throws before an open info exists. Attach the response
        // first so the startup fault can still report that status.
        const handshakeResponse = response;
        const open = await createOpenInfo(
          handshakeResponse,
          options.handshakeError,
          attemptAbort,
        ).catch((error: unknown) => {
          latestOpen = toOpenInfo(handshakeResponse, null, false);
          throw error;
        });
        latestOpen = open;

        validateOpenResponse(open);

        if (!response.body) {
          throw new EventStreamFatalError(
            "RES_DECODE_FAILED",
            "Missing response body for event stream",
          );
        }

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

        readerStarted = true;
        await consumeEventStream(response.body, attemptAbort);
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
        // retried: no observer, reconnect policy or delay, and the caller gets the real failure. Keyed on the body
        // type, not `locked`: when a failed attempt locks the stream differs by runtime.
        if (isReadableStreamBody(request.body)) {
          finishError(retryError);
          return;
        }

        let retryDelay: number | null;
        try {
          retryDelay = await resolveRetryDelay(retryError, retryAbort);
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
        let result: Promise<TEvent | undefined> | TEvent | undefined;
        try {
          signal.throwIfAborted();
          result = options.transformMessage
            ? options.transformMessage(message, signal)
            : // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve HEAD's two truthy mapper reads and options receiver; without a mapper yield the raw caller-selected event value
              (message as TEvent);
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
        enqueue(result);
        return undefined;
      },
      { maxBufferSize: options.maxBufferSize },
    );

    function enqueue(transformed: TEvent | undefined): void {
      if (typeof transformed !== "undefined") {
        try {
          queue.push(transformed);
        } catch (error) {
          // AsyncQueue.push has one failure mode: exceeding its configured bound.
          throw new EventStreamFatalError(
            "CAP_QUEUE_OVERFLOW",
            "Event stream queue exceeded maxQueueSize",
            {
              cause: error,
            },
          );
        }
      }
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

    // Opt-in reconnect (match WebSocket): no reconnect object → do not retry.
    if (!reconnect) {
      return null;
    }

    // 2. The caller's policy decides; without one, only an idempotent request is sent again.
    if (options.reconnect?.shouldReconnect) {
      const should = await awaitWithSignal(
        () =>
          options.reconnect?.shouldReconnect?.({
            attempt: retryCount,
            cause: error,
            lastEventId,
            method: request.method,
            open: latestOpen,
          }),
        signal,
      );
      if (!should) {
        return null;
      }
    } else if (!IDEMPOTENT_METHODS.has(request.method.toUpperCase())) {
      return null;
    }

    // 3. Check attempts limit (default 3 when reconnect is configured, like WebSocket)
    if (retryCount > reconnect.attempts) {
      return null;
    }

    const delayMs = typeof next === "number" ? next : retryInterval;
    return computeReconnectDelay({ ...reconnect, delayMs }, retryCount);
  }

  async function observeFatalError(
    error: EventStreamFatalError,
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

    if (settledOpen) {
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
  return code === "REQ_BUILD_FAILED" || code === "REQ_OPTIONS_INVALID";
}

function getEventStreamFaultCode(error: unknown): EventStreamFaultCode {
  const fatal = getEventStreamFatalCode(error);
  if (fatal) {
    return fatal;
  }
  if (isEventStreamPickFault(error)) {
    return error.code === "REQ_OPTIONS_INVALID"
      ? "REQ_OPTIONS_INVALID"
      : "REQ_BUILD_FAILED";
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

async function createOpenInfo(
  response: Response,
  handshakeError: AnyStruct | undefined,
  signal: AbortSignal,
): Promise<EventStreamOpenInfo> {
  if (!response.ok && handshakeError) {
    const representation = resolveInboundRepresentation(handshakeError);
    // No bytes arrived. Text is the empty string; every other representation failed to decode.
    // A decoded JSON null still requires a body, so null stays reserved for that value.
    if (!response.body && representation !== "text") {
      throw new EventStreamFatalError(
        "RES_DECODE_FAILED",
        "Failed to decode event stream handshake body",
      );
    }

    // Philosophy 3, same as HTTP: a JSON declaration is an assertion about the media type.
    // A mismatch is a decode fault, not an undecoded status, and the body stays unread.
    if (response.body && representation === "json") {
      const contentType = getContentType(response.headers);
      if (!isJsonMediaType(contentType)) {
        discardStreamBody(response.body);
        throw new EventStreamFatalError(
          "RES_MEDIA_TYPE_INVALID",
          `Expected a JSON media type, received ${contentType || "<none>"}`,
        );
      }
    }

    try {
      const raw = response.body
        ? await readHandshakeBody(
            response.body,
            representation,
            signal,
            getContentType(response.headers),
          )
        : "";
      // JSON uses the same alias-aware decoder as HTTP. Other kinds stay raw values.
      const body: unknown =
        representation === "json"
          ? decodeJson(handshakeError, raw)
          : parseStructValue(handshakeError, raw);
      return toOpenInfo(response, body, true);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      // The published contract: a declared handshake body that cannot be read is RES_DECODE_FAILED.
      throw new EventStreamFatalError(
        "RES_DECODE_FAILED",
        "Failed to decode event stream handshake body",
        { cause: error },
      );
    }
  }

  if (!response.ok && response.body) {
    discardStreamBody(response.body);
  }

  return toOpenInfo(response, null, false);
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

function validateOpenResponse(open: EventStreamOpenInfo): void {
  const { response } = open;
  // A non-2xx handshake is a status fault, which the event-stream operation builds from the open
  // info; the code here is only the fallback for a response that never carried a status.
  if (!response.ok) {
    throw new EventStreamFatalError(
      "RES_DECODE_FAILED",
      "Event stream request failed",
      { statusSignal: true },
    );
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
