import {
  COMMAND_EXECUTE,
  COMMAND_TYPE,
  EVENT_STREAM_COMMAND,
  type CommandExecutor,
} from "../client/command";
import type { BaseCommand } from "../client/command";
import type { ClientConfig, ClientSSEOptions } from "../client/config";
import { DEFAULT_FETCH, ERR_FETCH_UNSUPPORTED } from "../client/config";
import type { AnyFault, Fault, PreflightFault } from "../error";
import {
  createDecodeFault,
  createHttpStatusFault,
  createNetworkFault,
  createPreflightFault,
  createUndecodedHttpStatusFault,
} from "../error";
import type { SSEHandler } from "../interceptor/interceptor";
import { makeChain, resolveSSEInterceptors } from "../interceptor/interceptor";
import type { UseCancellationConfig } from "../internal/abort";
import {
  armTransportDeadline,
  awaitWithSignal,
  createAbortTimeoutConflictFault,
  hasAbortTimeoutConflict,
  mergeAbortSignals,
  releaseAbortSignal,
  resolveAbortCause,
  resolveAbortedFault,
  resolveTransportCancellation,
  snapshotCancellationConfig,
  validateTransportTimeout,
} from "../internal/abort";
import type { EndpointCallable } from "../internal/endpoint_command";
import { resolveInboundRepresentation } from "../internal/inbound_representation";
import type { EndpointInput, ParsedInput } from "../internal/endpoint_input";
import { parseEndpointInput } from "../internal/endpoint_input";
import { createTransportOrigin } from "../internal/transport_origin";
import { normalizeReconnectOptions } from "../internal/reconnect_options";
import { RequestUrlError, resolveRequestUrl } from "../internal/url";
import type { HttpMeta, HttpResponse } from "../internal/http_response";
import type {
  BuilderField,
  EventStreamRequestShape,
} from "../internal/builder_types";
import type { OutboundBuilder } from "../internal/outbound_request";
import { ERR_STREAMING_REQUEST_UNSUPPORTED } from "../http/transport/fetch_init";
import { createBaseTransportRequest } from "../internal/transport_request";
import type { AnyStruct, Infer } from "../struct";
import { decodeJson } from "../struct/codec/json";
import { parseStructValue } from "../struct/introspection";
import type { Guide } from "../struct/guide";
import type {
  EventStreamFailureInfo,
  EventStreamHandle,
  EventStreamOpenInfo,
  FetchEventStreamOptions,
} from "./transport/event_stream";
import { SSE_RECONNECT_DEFAULTS } from "./transport/event_stream";
import {
  fetchEventStream,
  getEventStreamFatalCode,
  handshakeDecodeCause,
  isHandshakeStatusSignal,
} from "./transport/event_stream";
import type { EventStreamMessage } from "./transport/parser";

/**
 * Map from SSE event names to the structs that decode their data.
 *
 * An event with no `event:` field is named `message`. An event whose name has no own entry uses the `default` struct; with neither, the event is skipped and `onInvalidEvent` is called. Declare the event name `__proto__` with a computed own key.
 *
 * A `string` event struct keeps the raw `data` text. Every other kind is JSON text: `JSON.parse`, then the struct. A bare `struct.literal` therefore needs JSON text, not an unquoted token.
 *
 * Reconnect lives on the client (`withSSEReconnect`). SSE `jitter` is a **0-1 multiplicative factor**, same as WebSocket.
 *
 * @group sse
 */
export type EventStructs = { [key: string]: AnyStruct };

type EventName<TKey extends string | number> = `${TKey}`;

type KnownEventUnion<TEvents extends EventStructs> = {
  [K in keyof TEvents & (number | string)]: EventName<K> extends "default"
    ? never
    : {
        data: Infer<TEvents[K]>;
        event: EventName<K>;
        id?: string;
      };
}[keyof TEvents & (number | string)];

type DefaultEventUnion<TEvents extends EventStructs> =
  "default" extends keyof TEvents
    ? {
        data: Infer<TEvents["default"]>;
        event: string;
        id?: string;
      }
    : never;

/**
 * Union of parsed SSE events inferred from an EventStructs map.
 *
 * For each declared event name except `default`, the union has `{ event: <name>; data: Infer<TEvents[name]>; id?: string }`. When a `default` struct is declared, it adds `{ event: string; data: Infer<TEvents['default']>; id?: string }` for every event name that has no struct of its own. `KnownEventUnion` and `DefaultEventUnion` are internal helper types.
 *
 * @group sse
 */
export type EventStreamData<TEvents extends EventStructs> =
  TEvents extends EventStructs
    ? KnownEventUnion<TEvents> | DefaultEventUnion<TEvents>
    : never;

interface EventStreamDefinitionBase<
  TEvents extends EventStructs = EventStructs,
> {
  events: TEvents;
  maxBufferSize: number;
  maxQueueSize: number;
  method?: string;
  operation?: string;
  path: string;
}

/** Makes `error` required only when an error struct is declared, so omission stays `Fault<undefined>`. */
type EventStreamErrorField<TError extends AnyStruct | undefined> = [
  TError,
] extends [undefined]
  ? { error?: never }
  : { error: TError };

/**
 * Contract that describes an SSE endpoint for defineEventStream.
 *
 * The composed members are:
 *
 * - `events`, `maxBufferSize`, and `maxQueueSize` (both limits are required positive safe integers), optional `method`, `operation`, and a required `path`.
 *
 * - `error`, required only when `TError` is a struct. It decodes the body of a failed handshake (a non-2xx response). The kind rule is the same as for HTTP: `string` is text, `blob` and `file` are blobs, `arrayBuffer` is bytes, and everything else is JSON.
 *
 * - `input` and `builder`. The request shape matches HTTP, including `body`; `GET` and `HEAD` cannot return a body. A declared `input` always requires an explicit `builder`. `input` only defines the parameters; the builder alone decides where each value goes. Only definitions without `input` may omit `builder`.
 *
 * `EventStreamDefinitionBase` and `EventStreamErrorField` are internal helper types.
 *
 * @group sse
 */
export type EventStreamDefinition<
  TInput extends AnyStruct | undefined = undefined,
  TEvents extends EventStructs = EventStructs,
  TError extends AnyStruct | undefined = undefined,
> = EventStreamDefinitionBase<TEvents> &
  EventStreamErrorField<TError> & {
    builder?: OutboundBuilder;
    input?: TInput;
  };

export type { EventStreamRequestShape } from "../internal/builder_types";

/**
 * Await-result tuple from opening an SSE stream via `client.execute`.
 *
 * - On success: `[null, stream, open]`. `open` is the returned connection's first successful handshake snapshot for native Defjs handles or wrappers forwarding the same live `open` object; custom handles or wrappers overriding `open` use their current public `open` even after reconnect, while `stream.open` stays live.
 *
 * - On failure: `[fault, undefined, open]`. `open` carries the response snapshot when the failure happened after a response arrived, for example a non-2xx handshake, and is `undefined` otherwise.
 *
 * - `TError` is the declared `error` struct. It types the decoded error body on the fault.
 *
 * @group sse
 */
export type StreamAwaitResult<
  TEvent,
  TError extends AnyStruct | undefined = undefined,
> =
  | [error: null, stream: EventStreamHandle<TEvent>, open: EventStreamOpenInfo]
  | [
      error: Fault<TError>,
      stream: undefined,
      open: EventStreamOpenInfo | undefined,
    ];

/**
 * Opaque executable SSE command produced by an `EventStreamEndpoint`.
 *
 * Created by calling an `EventStreamEndpoint` with input. It also has internal symbol-keyed members that identify and run the command. Treat it as opaque and pass it to `client.execute`. `endpoint` is the definition plus `method`, which is always a string (it defaults to `'GET'` when the definition omits it). `ResolvedEventStreamDefinition` names that shape and is not exported.
 *
 * @group sse
 */
export interface EventStreamCommand<
  TInput extends AnyStruct | undefined,
  TEvents extends EventStructs,
  TError extends AnyStruct | undefined = undefined,
> extends BaseCommand<typeof EVENT_STREAM_COMMAND> {
  readonly endpoint: ResolvedEventStreamDefinition<TInput, TEvents, TError>;
  readonly input: EndpointInput<TInput> | undefined;
}

/**
 * Per-call options for opening an SSE stream: abort or timeout, plus an optional signal.
 *
 * Cancellation is `abort` **or** `timeout`, not both; passing both makes the call resolve with a `REQ_OPTIONS_INVALID` fault. `signal` combines with either and is not an alias for `abort`. `timeout` must be a positive safe integer up to 2147483647.
 *
 * For SSE, `timeout` is a startup deadline. It covers input parsing, the builder, the interceptors, and opening the connection, and stops applying once the stream is open. The client-level `withTimeout` default does not apply to SSE.
 *
 * @group sse
 */
export type EventStreamExecuteOptions = UseCancellationConfig & {
  signal?: AbortSignal;
};

/**
 * Callable endpoint returned by defineEventStream.
 *
 * Returned by `defineEventStream`. Call it to get an `EventStreamCommand`: with no arguments when the endpoint declares no `input`, with an optional argument when the input struct accepts `undefined`, and otherwise with the struct's input value.
 *
 * @group sse
 */
export type EventStreamEndpoint<
  TInput extends AnyStruct | undefined,
  TEvents extends EventStructs,
  TError extends AnyStruct | undefined = undefined,
> = EndpointCallable<TInput, EventStreamCommand<TInput, TEvents, TError>>;

type ResolvedEventStreamDefinition<
  TInput extends AnyStruct | undefined = undefined,
  TEvents extends EventStructs = EventStructs,
  TError extends AnyStruct | undefined = undefined,
> = EventStreamDefinition<TInput, TEvents, TError> & {
  readonly method: string;
};

/**
 * Declare a typed Server-Sent Events endpoint.
 *
 * Pass path, event structs, and buffer/queue limits. Call the returned endpoint
 * with input to get an `EventStreamCommand` for `client.execute`.
 *
 * - **definition** — `path`, an `events` map, and the required `maxBufferSize` and `maxQueueSize` limits (positive safe integers). Optional `method` (default `'GET'`), `operation`, `input`, and `error`. A declared `input` always requires an explicit `builder`. `input` only defines the parameters; the builder alone decides where each value goes. Only definitions without `input` may omit `builder`.
 *
 * `EventStreamDefinitionBase`, `EventStreamErrorField`, and `BuilderField` are internal helper types: `error` is required only when `TError` is a struct, and `builder` is `(input: BuilderInput<TInput>) => EventStreamRequestShape` when `input` is declared.
 *
 * @param definition - SSE contract (path, events, buffer limits, optional input).
 * @returns An endpoint that creates `EventStreamCommand` values from input.
 *
 * @group sse
 * @exampleFile examples/api/define-event-stream.ts#example
 */
export function defineEventStream<
  const P extends string,
  const M extends string = "GET",
  TInput extends AnyStruct | undefined = undefined,
  TEvents extends EventStructs = EventStructs,
  TError extends AnyStruct | undefined = undefined,
>(
  definition: Omit<EventStreamDefinitionBase<TEvents>, "method" | "path"> &
    EventStreamErrorField<TError> & {
      input?: TInput;
      method?: M;
      path: P;
    } & BuilderField<
      NoInfer<TInput>,
      EventStreamRequestShape<NoInfer<P>, NoInfer<M>>
    >,
): EventStreamEndpoint<TInput, TEvents, TError> {
  // EventStreamErrorField is conditional, so this parameter is not directly the resolved endpoint.
  const endpoint = {
    ...definition,
    method: definition.method ?? "GET",
  } as unknown as ResolvedEventStreamDefinition<TInput, TEvents, TError>;

  function create(
    input?: EndpointInput<TInput>,
  ): EventStreamCommand<TInput, TEvents, TError> {
    const command: EventStreamCommand<TInput, TEvents, TError> = {
      [COMMAND_EXECUTE]: executeEventStreamCommand as CommandExecutor,
      [COMMAND_TYPE]: EVENT_STREAM_COMMAND,
      endpoint,
      input,
    };

    return command;
  }

  return ((input?: EndpointInput<TInput>) =>
    create(input)) as EventStreamEndpoint<TInput, TEvents, TError>;
}

/**
 * Open an SSE command against the given client config.
 *
 * Prefer `client.execute(command)` in application code; this is the low-level entry used by the client.
 *
 * The result is `[null, stream, open]` or `[fault, undefined, open | undefined]`. The fault is `Fault<TError>`: the decoded handshake body is on `data` when `error` is declared, and `Fault<undefined>` otherwise.
 *
 * @param clientConfig - Resolved client configuration.
 * @param command - SSE command from an `EventStreamEndpoint`.
 * @param options - Optional execute options (abort, timeout).
 * @returns Await-result tuple of `[error, stream, open]`.
 * @group sse
 */
export async function executeEventStreamCommand<
  TInput extends AnyStruct | undefined,
  TEvents extends EventStructs,
  TError extends AnyStruct | undefined = undefined,
>(
  clientConfig: ClientConfig,
  command: EventStreamCommand<TInput, TEvents, TError>,
  options?: EventStreamExecuteOptions,
): Promise<StreamAwaitResult<EventStreamData<TEvents>, TError>> {
  const { endpoint, input } = command;
  const config = options ?? {};
  const controller = new AbortController();
  return runEventStreamCommand(
    clientConfig,
    endpoint,
    input,
    config,
    controller,
  );
}

async function runEventStreamCommand<
  TInput extends AnyStruct | undefined,
  TEvents extends EventStructs,
  TError extends AnyStruct | undefined = undefined,
>(
  clientConfig: ClientConfig,
  endpoint: ResolvedEventStreamDefinition<TInput, TEvents, TError>,
  input: EndpointInput<TInput> | undefined,
  config: EventStreamExecuteOptions,
  controller: AbortController,
): Promise<StreamAwaitResult<EventStreamData<TEvents>, TError>> {
  let cancellation;
  try {
    cancellation = snapshotCancellationConfig(config);
  } catch (error) {
    return [
      createPreflightFault("REQ_OPTIONS_INVALID", error),
      undefined,
      undefined,
    ];
  }

  if (hasAbortTimeoutConflict(cancellation)) {
    return [createAbortTimeoutConflictFault(), undefined, undefined];
  }

  try {
    validateTransportTimeout(cancellation.timeout);
  } catch (error) {
    return [
      createPreflightFault("REQ_OPTIONS_INVALID", error),
      undefined,
      undefined,
    ];
  }

  // Fast path: caller already aborted before we did any struct work.
  const preAbortedSignal = [cancellation.abort, cancellation.signal].find(
    (signal) => signal?.aborted,
  );
  if (preAbortedSignal) {
    return [resolveAbortedFault(preAbortedSignal), undefined, undefined];
  }

  // Snapshot the validated reconnect policy at preflight so an interceptor cannot change it.
  let reconnect: FetchEventStreamOptions<unknown>["reconnect"];
  try {
    validateEventStreamLimits(endpoint);
    const configured = clientConfig.sse.reconnect;
    const normalized = normalizeReconnectOptions(
      configured,
      SSE_RECONNECT_DEFAULTS,
      "SSE",
    );
    reconnect = normalized && {
      ...normalized,
      shouldReconnect: configured?.shouldReconnect,
    };
  } catch (error) {
    return [
      createPreflightFault("REQ_OPTIONS_INVALID", error),
      undefined,
      undefined,
    ];
  }

  // The execute timeout is a startup deadline: armed before parse and the synchronous builder,
  // then released once startup settles so it cannot abort the open stream.
  const deadline = armTransportDeadline(cancellation.timeout);
  const requestSignal = mergeAbortSignals(controller.signal, [
    cancellation.abort,
    cancellation.signal,
    deadline.signal,
  ]);
  deadline.releaseOnAbort(requestSignal);
  const stopBeforeTransport = (
    fault: PreflightFault,
  ): StreamAwaitResult<EventStreamData<TEvents>, TError> => {
    deadline.release();
    releaseAbortSignal(requestSignal);
    return [fault, undefined, undefined];
  };

  const inputGuides = new WeakMap<object, Guide>();
  let parsedInput: ParsedInput<TInput>;
  try {
    parsedInput = parseEndpointInput<TInput>(
      endpoint.input,
      input,
      inputGuides,
    );
  } catch (error) {
    return stopBeforeTransport(
      resolveTransportCancellation(
        deadline,
        requestSignal,
        createPreflightFault("REQ_INPUT_INVALID", error),
      ),
    );
  }

  const parsedCancellation = resolveTransportCancellation(
    deadline,
    requestSignal,
  );
  if (parsedCancellation) {
    return stopBeforeTransport(parsedCancellation);
  }

  let request;
  try {
    request = createBaseTransportRequest(
      endpoint.method,
      endpoint.path,
      parsedInput,
      endpoint.builder,
      {
        abort: requestSignal,
        baseEndpoint: clientConfig.endpoint,
        defaultHeaders: clientConfig.headers,
        inputDeclared: endpoint.input !== undefined,
        inputGuides,
        operation: endpoint.operation,
        querySerializer: clientConfig.querySerializer,
        timeout: cancellation.timeout,
        transport: "sse",
        withCredentials: clientConfig.withCredentials,
      },
    );
  } catch (error) {
    return stopBeforeTransport(
      resolveTransportCancellation(
        deadline,
        requestSignal,
        createPreflightFault("REQ_BUILD_FAILED", error),
      ),
    );
  }

  const builtCancellation = resolveTransportCancellation(
    deadline,
    requestSignal,
  );
  if (builtCancellation) {
    return stopBeforeTransport(builtCancellation);
  }

  type OwnedStream = {
    controller: AbortController;
    initialOpen?: EventStreamOpenInfo;
    release?: () => void;
    stream?: EventStreamHandle<unknown>;
  };
  let chainSettled = false;
  let streamDelivered = false;
  const ownedStreams = new Set<OwnedStream>();
  const transportOrigin = createTransportOrigin();
  const errorOpenInfo = new Map<unknown, EventStreamOpenInfo | undefined>();
  try {
    const sseInterceptors = resolveSSEInterceptors(clientConfig.interceptors);
    const sseHandler: SSEHandler = (req) => {
      if (chainSettled) {
        const rejected = Promise.reject<EventStreamHandle<unknown>>(
          new Error(
            "SSE interceptor next() cannot be called after the chain has settled",
          ),
        );
        void rejected.catch(() => undefined);
        return rejected;
      }
      try {
        resolveRequestUrl(req);
      } catch (error) {
        const rejected = Promise.reject<EventStreamHandle<unknown>>(error);
        void rejected.catch(() => undefined);
        return rejected;
      }
      // Interceptors run after the post-builder check. A deadline that expired there must not start the fetch.
      const transportAbort = mergeAbortSignals(requestSignal, [req.abort]);
      const due = resolveTransportCancellation(deadline, transportAbort);
      if (due) {
        // `due` exists only after this signal has aborted, so the cause is the abort sentinel.
        // Reject with that sentinel, not the fault: the startup catch classifies sentinels.
        const rejected = Promise.reject<EventStreamHandle<unknown>>(
          transportOrigin.mark(resolveAbortCause(transportAbort) as Error),
        );
        releaseAbortSignal(transportAbort);
        void rejected.catch(() => undefined);
        return rejected;
      }
      if (
        clientConfig.sse.handle === DEFAULT_FETCH &&
        typeof globalThis.fetch !== "function"
      ) {
        const rejected = Promise.reject<EventStreamHandle<unknown>>(
          transportOrigin.mark(ERR_FETCH_UNSUPPORTED),
        );
        releaseAbortSignal(transportAbort);
        void rejected.catch(() => undefined);
        return rejected;
      }
      const ownerController = new AbortController();
      const owned: OwnedStream = {
        controller: ownerController,
      };
      ownedStreams.add(owned);
      const streamAbort = mergeAbortSignals(ownerController.signal, [
        transportAbort,
      ]);
      owned.release = () => {
        releaseAbortSignal(streamAbort);
        releaseAbortSignal(transportAbort);
      };
      // Type boundary: SSEHandler returns EventStreamHandle<unknown>; the concrete type is narrowed by the interceptor chain.
      const failure: EventStreamFailureInfo = {};
      const promise = fetchEventStream(
        { ...req, abort: streamAbort },
        {
          fetch: clientConfig.sse.handle,
          failure,
          handshakeError: endpoint.error,
          onopen(open) {
            owned.initialOpen ??= open;
          },
          transformMessage(message, signal) {
            return transformStreamMessage(
              endpoint.events,
              message,
              clientConfig.sse.onInvalidEvent,
              signal,
            );
          },
          reconnect,
          maxBufferSize: endpoint.maxBufferSize,
          maxQueueSize: endpoint.maxQueueSize,
        },
      ).then(
        (stream) => {
          owned.stream = stream;
          void stream.closed.then(owned.release, owned.release);
          return stream;
        },
        (cause: unknown) => {
          owned.release?.();
          errorOpenInfo.set(cause, failure.open);
          throw transportOrigin.mark(cause);
        },
      );
      void promise.catch(() => undefined);
      return promise;
    };
    const sseChain = makeChain(sseInterceptors);
    // Type boundary: interceptor chain returns EventStreamHandle<unknown>; runtime message transform narrows it to the endpoint's event types.
    const stream = (await awaitWithSignal(
      () => sseChain(request, sseHandler),
      requestSignal,
    )) as EventStreamHandle<EventStreamData<TEvents>>;
    const publicOpen = stream?.open;
    if (
      typeof stream?.closed?.then !== "function" ||
      typeof stream.close !== "function" ||
      typeof stream[Symbol.asyncIterator] !== "function" ||
      typeof stream[Symbol.asyncDispose] !== "function" ||
      typeof publicOpen?.url !== "string"
    ) {
      throw new TypeError(
        "SSE interceptor must resolve an event stream handle",
      );
    }
    chainSettled = true;
    const release = () => releaseAbortSignal(requestSignal);
    void stream.closed.then(release, release);

    let open: EventStreamOpenInfo | undefined;
    for (const owned of ownedStreams) {
      if (
        owned.stream &&
        (owned.stream === stream ||
          (owned.stream.closed === stream.closed &&
            publicOpen === owned.stream.open))
      ) {
        open = owned.initialOpen;
        break;
      }
    }
    open ??= publicOpen;

    discardOwnedStreams(
      new Error("SSE interceptor discarded an opened stream"),
      stream,
    );
    // Only transfer listener ownership after every startup operation has succeeded.
    streamDelivered = true;
    return [null, stream, open];
  } catch (error) {
    chainSettled = true;
    discardOwnedStreams(error);

    const fromTransport = transportOrigin.has(error);
    const cause = error;
    const openInfo = errorOpenInfo.get(cause);
    const fault = requestSignal.aborted
      ? resolveAbortedFault(requestSignal)
      : error instanceof RequestUrlError
        ? createPreflightFault("REQ_BUILD_FAILED", error)
        : createEventStreamFault(cause, fromTransport, openInfo?.response);
    return [fault as Fault<TError>, undefined, openInfo];
  } finally {
    deadline.release();
    if (!streamDelivered) {
      releaseAbortSignal(requestSignal);
    }
  }

  function discardOwnedStreams(
    reason: unknown,
    delivered?: EventStreamHandle<unknown>,
  ): void {
    for (const owned of ownedStreams) {
      if (
        owned.stream &&
        delivered &&
        (owned.stream === delivered || owned.stream.closed === delivered.closed)
      ) {
        continue;
      }
      owned.controller.abort(reason);
      owned.stream?.close(reason);
      owned.release?.();
    }
    ownedStreams.clear();
  }
}

// Synchronous on the valid path. Only an invalid event awaits the observer.
function transformStreamMessage<TEvents extends EventStructs>(
  events: TEvents,
  message: EventStreamMessage,
  onInvalidEvent: ClientSSEOptions["onInvalidEvent"],
  signal: AbortSignal,
): EventStreamData<TEvents> | Promise<undefined> {
  const eventName = message.event || "message";
  const eventStruct = resolveEventStruct(events, eventName);

  if (!eventStruct) {
    return notifyInvalidEvent(onInvalidEvent, {
      reason: "missing-struct",
      message: {
        id: message.id || "",
        event: eventName,
        data: message.data,
      },
      signal,
    });
  }

  try {
    return {
      data: decodeSSEEventData(eventStruct, message.data),
      event: eventName,
      id: message.id || undefined,
      // Type boundary: decodeSSEEventData validates against the resolved event struct; the shape matches EventStreamData<TEvents>.
    } as EventStreamData<TEvents>;
  } catch (error) {
    return notifyInvalidEvent(onInvalidEvent, {
      reason: "validation-failed",
      message: {
        id: message.id || "",
        event: eventName,
        data: message.data,
      },
      cause: error,
      signal,
    });
  }
}

async function notifyInvalidEvent(
  onInvalidEvent: ClientSSEOptions["onInvalidEvent"],
  context: {
    reason: "missing-struct" | "validation-failed";
    message: { id: string; event: string; data: string };
    cause?: unknown;
    signal: AbortSignal;
  },
): Promise<undefined> {
  if (!onInvalidEvent) {
    return undefined;
  }

  try {
    await awaitWithSignal(() => onInvalidEvent(context), context.signal);
  } catch (error) {
    if (context.signal.aborted) {
      throw error;
    }
    // onInvalidEvent is an observer; observer failures must not tear down the stream.
  }
  return undefined;
}

function validateEventStreamLimits(endpoint: {
  maxBufferSize: number;
  maxQueueSize: number;
}): void {
  for (const name of ["maxBufferSize", "maxQueueSize"] as const) {
    if (!Number.isSafeInteger(endpoint[name]) || endpoint[name] < 1) {
      throw new TypeError(`SSE ${name} must be a positive safe integer`);
    }
  }
}

function resolveEventStruct<TEvents extends EventStructs>(
  events: TEvents,
  eventName: string,
): AnyStruct | undefined {
  // Security: event declarations must be own properties. Declare the valid `__proto__` event name with a computed key.
  if (Object.hasOwn(events, eventName)) {
    return events[eventName];
  }

  if (Object.hasOwn(events, "default")) {
    return events["default"];
  }

  return undefined;
}

function decodeSSEEventData(struct: AnyStruct, data: string): unknown {
  // Only a string struct keeps the raw data field. Every other kind is JSON text.
  if (resolveInboundRepresentation(struct) === "text") {
    return parseStructValue(struct, data);
  }

  return decodeJson(struct, JSON.parse(data) as unknown);
}

function toEventStreamMeta(response: HttpResponse<unknown>): HttpMeta {
  return {
    headers: response.headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  };
}

function createEventStreamFault(
  cause: unknown,
  fromTransport: boolean,
  response?: HttpResponse<unknown>,
): AnyFault {
  const fatal = getEventStreamFatalCode(cause);
  // The JSON media-type precheck is a decode fault on every status.
  if (response && fatal === "RES_MEDIA_TYPE_INVALID") {
    return createDecodeFault(
      fatal,
      handshakeDecodeCause(cause),
      toEventStreamMeta(response),
    );
  }

  if (response && !response.ok) {
    const meta = toEventStreamMeta(response);
    // Decoded null is a real body. Only an unread handshake leaves `body` undefined.
    if (response.body !== undefined) {
      return createHttpStatusFault({ ...meta, body: response.body });
    }
    if (fatal === "RES_DECODE_FAILED" && !isHandshakeStatusSignal(cause)) {
      return createDecodeFault(fatal, handshakeDecodeCause(cause), meta);
    }
    return createUndecodedHttpStatusFault(meta);
  }

  // `CAP_*` and `EXT_*` happen after the stream opens, so they settle `closed` rather than startup.
  if (response && fatal === "RES_DECODE_FAILED") {
    return createDecodeFault(
      fatal,
      handshakeDecodeCause(cause),
      toEventStreamMeta(response),
    );
  }

  if (
    fromTransport &&
    (cause === ERR_STREAMING_REQUEST_UNSUPPORTED ||
      cause === ERR_FETCH_UNSUPPORTED)
  ) {
    return createPreflightFault("ENV_UNSUPPORTED", cause);
  }

  return fromTransport
    ? createNetworkFault(cause)
    : createPreflightFault("EXT_INTERCEPTOR_FAILED", cause);
}
