import type { Client } from "../client/client";
import { CLIENT } from "../client/client";
import type {
  ClientConfig,
  ClientSSEOptions,
  RetryOptions,
} from "../client/config";
import { DEFAULT_FETCH, ERR_FETCH_UNSUPPORTED } from "../client/config";
import type {
  DecodeFault,
  Fault,
  HttpStatusFaultOf,
  PreflightFault,
} from "../error";
import {
  createDecodeFault,
  createNetworkFault,
  createPreflightFault,
} from "../error";
import type { SSEHandler } from "../interceptor/interceptor";
import { makeChain, resolveSSEInterceptors } from "../interceptor/interceptor";
import {
  awaitWithSignal,
  mergeAbortSignals,
  releaseAbortSignal,
  resolveAbortedCause,
  resolveAbortedFault,
  resolveAbortFault,
} from "../internal/abort";
import type { EndpointArgs } from "../internal/endpoint_command";
import { resolveInboundRepresentation } from "../internal/inbound_representation";
import type { EndpointInput } from "../internal/endpoint_input";
import { parseEndpointInput } from "../internal/endpoint_input";
import { createTransportOrigin } from "../internal/transport_origin";
import { resolveRetryPolicy } from "../internal/retry";
import { RequestUrlError, resolveRequestUrl } from "../internal/url";
import type { DecodedResponse, HttpResponse } from "../internal/http_response";
import type {
  BuilderField,
  EventStreamRequestShape,
} from "../internal/builder_types";
import type { OutboundBuilder } from "../internal/outbound_request";
import { ERR_STREAMING_REQUEST_UNSUPPORTED } from "../http/transport/fetch_init";
import { createBaseTransportRequest } from "../internal/transport_request";
import { pickEndpoint } from "../balancer/runtime";
import type { AnyStruct, Infer } from "../struct";
import { decodeJson } from "../struct/codec/json";
import { parseStructValue } from "../struct/introspection";
import type { Guide } from "../struct/guide";
import type {
  EventStreamFailureInfo,
  EventStreamHandle,
  EventStreamOpenInfo,
  HandshakeBody,
} from "./transport/event_stream";
import {
  createHandshakeStatusFault,
  fetchEventStream,
  getEventStreamFatalCode,
  isEventStreamPickFault,
  toEventStreamMeta,
} from "./transport/event_stream";
import type { EventStreamMessage } from "./transport/parser";

/**
 * Map from SSE event names to the structs that decode their data.
 *
 * An event with no `event:` field is named `message`. An event whose name has no own entry uses the `default` struct; with neither, the event is skipped and `onInvalidEvent` is called. Declare the event name `__proto__` with a computed own key.
 *
 * A `string` event struct keeps the raw `data` text. Every other kind is JSON text: `JSON.parse`, then the struct. A bare `struct.literal` therefore needs JSON text, not an unquoted token.
 *
 * Retries live on the client (`withRetry`).
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

const DEFAULT_MAX_BUFFER_SIZE = 64 * 1024;

interface EventStreamDefinitionBase<
  TEvents extends EventStructs = EventStructs,
> {
  events: TEvents;
  maxBufferSize?: number;
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
 * - `path` and `events`, plus optional `method` (default `'GET'`), `operation`, and `maxBufferSize` (default `64 * 1024` bytes, a positive safe integer when provided). A frame larger than `maxBufferSize` ends the stream with `CAP_BUFFER_EXCEEDED`. The library holds at most 1024 events waiting for the `for await` consumer; when they are full, reading the response pauses until the consumer takes one. No event is dropped for lack of room and the stream does not fail.
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
 * Await-result tuple from opening an SSE stream.
 *
 * - On success: `[null, stream, open]`. `open` is the returned connection's first successful handshake snapshot for native Defjs handles or wrappers forwarding the same live `open` object; custom handles or wrappers overriding `open` use their current public `open` even after reconnect, while `stream.open` stays live.
 *
 * - On failure: `[fault, undefined, open]`. `open` carries the response snapshot when the failure happened after a response arrived, for example a non-2xx handshake, and is `undefined` otherwise.
 *
 * - `TError` is the declared `error` struct. It types the decoded error body on the fault.
 *
 * - A non-2xx handshake is an `HTTP_STATUS` fault whose `data` is the decoded `error` body. When the declared `error` body could not be decoded, startup returns the decode fault instead, as `defineRequest` does: `RES_MEDIA_TYPE_INVALID` for a JSON declaration that meets another media type, `RES_DECODE_FAILED` for an unreadable or unparsable body, `RES_STRUCT_MISMATCH` for a body that does not match the struct. Its `status` and `response` carry the handshake status as metadata and `cause` holds the reason. Interceptors, `shouldRetry` and a reconnect's `closed` still receive `HTTP_STATUS`, with the same `cause`, so a gateway `503` is retried however its body looks.
 *
 * - A 2xx handshake whose media type is not `text/event-stream` is `RES_MEDIA_TYPE_INVALID`. One with that media type and no body (a `204` or `205` on Node.js and Bun) is an empty stream: the call succeeds and `closed` settles `{ kind: 'eof' }` at once.
 *
 * @group sse
 */
export type StreamAwaitResult<
  TEvent,
  TError extends AnyStruct | undefined = undefined,
> =
  | [error: null, stream: EventStreamHandle<TEvent>, open: EventStreamOpenInfo]
  | [
      error: Fault<TError> | HttpStatusFaultOf<undefined>,
      stream: undefined,
      open: EventStreamOpenInfo | undefined,
    ];

/**
 * SSE fields of {@link RequestOptions}. HTTP progress and WebSocket fields are ignored.
 *
 * `signal` covers the whole stream, including after it opens. There is no startup-only deadline. `retry` replaces the client's retry policy for this call.
 *
 * @group sse
 */
export type EventStreamExecuteOptions = {
  /** Aborts the stream, including after it is open. */
  signal?: AbortSignal;
  /** Retry policy for this call. Replaces the client policy as a whole value; the `budget` is HTTP only. */
  retry?: Omit<RetryOptions, "budget">;
};

/**
 * Operation returned by `defineEventStream`.
 *
 * The first argument is a {@link Client}. Further arguments are the input only. Calling it opens the stream and returns the existing error-first tuple.
 *
 * @group sse
 */
export type EventStreamEndpoint<
  Args extends unknown[],
  Event,
  TError extends AnyStruct | undefined = undefined,
> = (
  client: Client,
  ...args: Args
) => Promise<StreamAwaitResult<Event, TError>>;

type ResolvedEventStreamDefinition<
  TInput extends AnyStruct | undefined = undefined,
  TError extends AnyStruct | undefined = undefined,
> = Omit<EventStreamDefinitionBase, "events" | "maxBufferSize"> & {
  builder?: OutboundBuilder;
  /** The copied dictionary. Its event types live in the operation's own type, not in this copy. */
  events: EventStructs;
  input?: TInput;
  error?: TError;
  readonly maxBufferSize: number;
  readonly method: string;
};

// A descriptor's getter is a plain function value here, so it is typed as a property, not a method.
type SnapshotDescriptor = Omit<PropertyDescriptor, "get"> & {
  get?: (this: unknown) => unknown;
};

function snapshotEventDictionary(events: EventStructs): EventStructs {
  if (typeof events !== "object" || events === null) {
    return events;
  }
  const descriptors: { [key: string]: SnapshotDescriptor } =
    Object.getOwnPropertyDescriptors(events);
  for (const descriptor of Object.values(descriptors)) {
    const get = descriptor.get;
    if (get) {
      descriptor.get = () => get.call(events);
    }
  }
  // Runs once per definition. The copy has no prototype, so only own declarations name events.
  const snapshot: EventStructs = {};
  Object.setPrototypeOf(snapshot, null);
  return Object.defineProperties(snapshot, descriptors);
}

/**
 * Declare a typed Server-Sent Events endpoint.
 *
 * Pass path and event structs. Call the returned operation
 * with a client and, when declared, the input.
 *
 * - **definition** — `path` and an `events` map. Optional `method` (default `'GET'`), `operation`, `input`, `error`, and `maxBufferSize` (default `64 * 1024`, a positive safe integer when provided). A frame larger than `maxBufferSize` ends the stream with `CAP_BUFFER_EXCEEDED`; the library holds at most 1024 unread events, and a full queue pauses reading the response until the consumer takes an event. A declared `input` always requires an explicit `builder`. `input` only defines the parameters; the builder alone decides where each value goes. Only definitions without `input` may omit `builder`.
 *
 * `EventStreamDefinitionBase`, `EventStreamErrorField`, and `BuilderField` are internal helper types: `error` is required only when `TError` is a struct, and `builder` is `(input: BuilderInput<TInput>) => EventStreamRequestShape` when `input` is declared.
 *
 * Known fields are copied when the definition is created. The `events` dictionary container is copied, including own non-enumerable keys, and inherited names are left behind. Struct values keep their identity. An accessor on that dictionary still runs when a message arrives, with the original dictionary as `this`. A missing or non-object dictionary is left as given. A getter on a fixed definition field runs during `defineEventStream`.
 *
 * @param definition - SSE contract (path, events, optional input and limits).
 * @returns An operation `(client, ...input) => Promise<error-first tuple>`.
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
): EventStreamEndpoint<EndpointArgs<TInput>, EventStreamData<TEvents>, TError> {
  // Copy known fields. The events container is copied; struct values and accessors stay lazy.
  const builder = definition.builder;
  const error = definition.error;
  const events = snapshotEventDictionary(definition.events);
  const input = definition.input;
  const { maxBufferSize = DEFAULT_MAX_BUFFER_SIZE } = definition;
  const declaredMethod = definition.method;
  const operation = definition.operation;
  const path = definition.path;
  const endpoint = {
    builder,
    error,
    events,
    input,
    maxBufferSize,
    method: declaredMethod ?? "GET",
    operation,
    path,
  };

  return async (client: Client, input?: EndpointInput<TInput>) =>
    runEventStreamCommand<TInput, TEvents, TError>(
      client[CLIENT].config,
      endpoint,
      input,
      client[CLIENT].options,
      new AbortController(),
    );
}

async function runEventStreamCommand<
  TInput extends AnyStruct | undefined,
  TEvents extends EventStructs,
  TError extends AnyStruct | undefined = undefined,
>(
  clientConfig: ClientConfig,
  endpoint: ResolvedEventStreamDefinition<TInput, TError>,
  input: EndpointInput<TInput> | undefined,
  config: EventStreamExecuteOptions | undefined,
  controller: AbortController,
): Promise<StreamAwaitResult<EventStreamData<TEvents>, TError>> {
  const callerAbort = config?.signal;

  // Fast path: caller already aborted before we did any struct work.
  if (callerAbort?.aborted) {
    return [resolveAbortedFault(callerAbort), undefined, undefined];
  }

  // Resolve the retry policy at preflight so an interceptor cannot change it.
  const retry = resolveRetryPolicy(config?.retry ?? clientConfig.retry);
  try {
    validateEventStreamLimits(endpoint);
  } catch (error) {
    return [
      createPreflightFault("REQ_OPTIONS_INVALID", error),
      undefined,
      undefined,
    ];
  }

  // `signal` stays in force after open. Listeners stay off the caller's signal.
  const requestSignal = mergeAbortSignals(controller.signal, [callerAbort]);
  const stopBeforeTransport = (
    fault: PreflightFault,
  ): StreamAwaitResult<EventStreamData<TEvents>, TError> => {
    releaseAbortSignal(requestSignal);
    return [fault, undefined, undefined];
  };

  const inputGuides = new WeakMap<object, Guide>();
  let parsedInput: unknown;
  try {
    parsedInput = endpoint.input
      ? parseEndpointInput(endpoint.input, input, inputGuides)
      : input;
  } catch (error) {
    return stopBeforeTransport(
      resolveAbortFault(requestSignal) ??
        createPreflightFault("REQ_INPUT_INVALID", error),
    );
  }

  const parsedCancellation = resolveAbortFault(requestSignal);
  if (parsedCancellation) {
    return stopBeforeTransport(parsedCancellation);
  }

  const picked = pickEndpoint(clientConfig.balancer, {
    endpoints: clientConfig.endpoints,
    operation: endpoint.operation,
  });
  if (picked[0] !== null) {
    return stopBeforeTransport(picked[0]);
  }
  const resolved = picked[1];

  // Exits before the first sseHandler entry belong to this call. The handler
  // takes the one `done` as soon as it is entered.
  let handedOff = false;
  try {
    let request;
    try {
      request = createBaseTransportRequest(
        endpoint.method,
        endpoint.path,
        parsedInput,
        endpoint.builder,
        {
          signal: requestSignal,
          baseEndpoint: resolved.endpoint,
          defaultHeaders: clientConfig.headers,
          inputDeclared: endpoint.input !== undefined,
          inputGuides,
          operation: endpoint.operation,
          querySerializer: clientConfig.querySerializer,
          transport: "sse",
          withCredentials: clientConfig.withCredentials,
        },
      );
    } catch (error) {
      return stopBeforeTransport(
        resolveAbortFault(requestSignal) ??
          createPreflightFault("REQ_BUILD_FAILED", error),
      );
    }

    const builtCancellation = resolveAbortFault(requestSignal);
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
    // Headers an interceptor handed to next() and the platform refused; the interceptor is shown that error itself.
    const refusedHeaders = new Set<unknown>();
    const errorFailure = new Map<
      unknown,
      EventStreamFailureInfo<HandshakeBody<TError>>
    >();
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
        const attributed = !handedOff;
        if (attributed) {
          handedOff = true;
        }
        let settled = !attributed;
        const settleUnattempted = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          resolved.done({ attempted: false });
        };
        if (attributed && req.baseEndpoint !== resolved.endpoint) {
          settleUnattempted();
        }
        let transportAbort: AbortSignal;
        try {
          resolveRequestUrl(req);
          // Headers rejects an invalid name or value with a TypeError. Checking here makes that a request that cannot be
          // built, not a NET_UNREACHABLE that only surfaces once the transport builds its own Headers.
          try {
            void new Headers(req.headers);
          } catch (error) {
            refusedHeaders.add(error);
            throw error;
          }
          transportAbort = mergeAbortSignals(requestSignal, [req.signal]);
        } catch (error) {
          settleUnattempted();
          const rejected = Promise.reject<EventStreamHandle<unknown>>(error);
          void rejected.catch(() => undefined);
          return rejected;
        }
        const due = resolveAbortFault(transportAbort);
        if (due) {
          settleUnattempted();
          // `due` exists only after this signal has aborted, so the cause is the abort sentinel.
          // Reject with that sentinel, not the fault: the startup catch classifies sentinels.
          const rejected = Promise.reject<EventStreamHandle<unknown>>(
            transportOrigin.mark(resolveAbortedCause(transportAbort)),
          );
          releaseAbortSignal(transportAbort);
          void rejected.catch(() => undefined);
          return rejected;
        }
        if (
          clientConfig.sse.handle === DEFAULT_FETCH &&
          typeof globalThis.fetch !== "function"
        ) {
          settleUnattempted();
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
        const failure: EventStreamFailureInfo<HandshakeBody<TError>> = {};
        const endpointAttempt =
          attributed && !settled
            ? {
                start: resolved.start,
                end: resolved.end,
                done: resolved.done,
                pickNext: () =>
                  pickEndpoint(clientConfig.balancer, {
                    endpoints: clientConfig.endpoints,
                    operation: endpoint.operation,
                  }),
              }
            : undefined;
        if (endpointAttempt) {
          settled = true;
        }
        const promise = fetchEventStream(
          { ...req, signal: streamAbort },
          {
            endpointAttempt,
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
            retry,
            maxBufferSize: endpoint.maxBufferSize,
          },
        ).then(
          (stream) => {
            owned.stream = stream;
            void stream.closed.then(owned.release, owned.release);
            return stream;
          },
          (cause: unknown) => {
            // A no-op once the transport has reported; it only takes effect when fetchEventStream fails before its first attempt starts.
            endpointAttempt?.done({ attempted: false });
            owned.release?.();
            errorFailure.set(cause, {
              open: failure.open,
              decoded: failure.decoded,
              bodyFault: failure.bodyFault,
            });
            throw transportOrigin.mark(cause);
          },
        );
        void promise.catch(() => undefined);
        return promise;
      };
      const sseChain = makeChain(sseInterceptors);
      const stream = await awaitWithSignal(
        () => sseChain(request, sseHandler),
        requestSignal,
      );
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
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the published SSEInterceptor/SSEHandler types carry EventStreamHandle<unknown>, and an interceptor may return its own handle, which is delivered by identity, while the published StreamAwaitResult needs EventStreamData<TEvents>, a type that exists only in the caller's generic. Unasserted: TS2322, `EventStreamHandle<unknown>` is not assignable to `EventStreamHandle<EventStreamData<TEvents>>`. A validating wrapper would replace the delivered handle
      const delivered = stream as EventStreamHandle<EventStreamData<TEvents>>;
      return [null, delivered, open];
    } catch (error) {
      chainSettled = true;
      discardOwnedStreams(error);

      const fromTransport = transportOrigin.has(error);
      const cause = error;
      const {
        open: openInfo,
        decoded,
        bodyFault,
      } = errorFailure.get(cause) ?? {};
      const fault = requestSignal.aborted
        ? resolveAbortedFault(requestSignal)
        : error instanceof RequestUrlError || refusedHeaders.has(error)
          ? createPreflightFault("REQ_BUILD_FAILED", error)
          : createEventStreamFault(
              cause,
              fromTransport,
              openInfo?.response,
              decoded,
              bodyFault,
            );
      return [fault, undefined, openInfo];
    } finally {
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
          (owned.stream === delivered ||
            owned.stream.closed === delivered.closed)
        ) {
          continue;
        }
        owned.controller.abort(reason);
        owned.stream?.close(reason);
        owned.release?.();
      }
      ownedStreams.clear();
    }
  } finally {
    if (!handedOff) {
      resolved.done({ attempted: false });
    }
  }
}

/** An event decoded with the struct its name selects. The operation's own type relates `event` to `data`. */
type DecodedStreamEvent = {
  data: unknown;
  event: string;
  id: string | undefined;
};

// Synchronous on the valid path. Only an invalid event awaits the observer.
function transformStreamMessage(
  events: EventStructs,
  message: EventStreamMessage,
  onInvalidEvent: ClientSSEOptions["onInvalidEvent"],
  signal: AbortSignal,
): DecodedStreamEvent | Promise<undefined> {
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
    };
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

function validateEventStreamLimits(endpoint: { maxBufferSize: number }): void {
  if (
    !Number.isSafeInteger(endpoint.maxBufferSize) ||
    endpoint.maxBufferSize < 1
  ) {
    throw new TypeError("SSE maxBufferSize must be a positive safe integer");
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

  return decodeJson(struct, JSON.parse(data));
}

function createEventStreamFault<TBody>(
  cause: unknown,
  fromTransport: boolean,
  response?: HttpResponse<unknown>,
  decoded?: DecodedResponse<TBody>,
  bodyFault?: DecodeFault,
):
  | DecodeFault
  | HttpStatusFaultOf<TBody>
  | HttpStatusFaultOf<undefined>
  | PreflightFault {
  // Only a reconnect pick inside the transport produces these; an interceptor-thrown fault keeps its old mapping.
  if (fromTransport && isEventStreamPickFault(cause)) {
    return cause;
  }

  const fatal = getEventStreamFatalCode(cause);
  if (response && fatal === "RES_MEDIA_TYPE_INVALID") {
    return createDecodeFault(fatal, cause, toEventStreamMeta(response));
  }

  // A non-2xx handshake is `HTTP_STATUS` for everything past the transport. Typed `data` exists only
  // when the declared error body decoded, so one that did not is reported as its decode fault, as
  // `defineRequest` does, with the status in its metadata.
  if (response && !response.ok) {
    return bodyFault ?? createHandshakeStatusFault(response, decoded);
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
