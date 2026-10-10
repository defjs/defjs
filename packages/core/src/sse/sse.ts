import { COMMAND_EXECUTE, COMMAND_TYPE, EVENT_STREAM_COMMAND, type CommandExecutor } from '../client/command'
import type { BaseCommand } from '../client/command'
import type { ClientConfig, ClientSSEOptions } from '../client/config'
import type { AnyFault, Fault, PreflightFault } from '../error'
import {
  createDecodeFault,
  createHttpStatusFault,
  createNetworkFault,
  createPreflightFault,
  createUndecodedHttpStatusFault,
} from '../error'
import type { SSEHandler } from '../interceptor/interceptor'
import { makeChain, resolveSSEInterceptors } from '../interceptor/interceptor'
import type { UseCancellationConfig } from '../internal/abort'
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
} from '../internal/abort'
import type { EndpointCallable } from '../internal/endpoint_command'
import { resolveInboundRepresentation } from '../internal/inbound_representation'
import type { EndpointInput, ParsedInput } from '../internal/endpoint_input'
import { parseEndpointInput } from '../internal/endpoint_input'
import { isTransportOrigin, markTransportOrigin } from '../internal/transport_origin'
import type { HttpMeta, HttpResponse } from '../internal/http_response'
import type { BuilderField, EventStreamRequestShape } from '../internal/builder_types'
import type { OutboundBuilder } from '../internal/outbound_request'
import { createBaseTransportRequest } from '../internal/transport_request'
import type { AnyStruct, Infer } from '../struct'
import { decodeJson } from '../struct/codec/json'
import { parseStructValue } from '../struct/introspection'
import type { EventStreamHandle, EventStreamOpenInfo } from './transport/event_stream'
import {
  fetchEventStream,
  getErrorOpenInfo,
  getEventStreamFatalCode,
  handshakeDecodeCause,
  isHandshakeStatusSignal,
} from './transport/event_stream'
import type { EventStreamMessage } from './transport/parser'

/** Map of SSE event names to payload structs. Declare `__proto__` with a computed own key. */
export type EventStructs = { [key: string]: AnyStruct }

type EventName<TKey extends string | number> = `${TKey}`

type KnownEventUnion<TEvents extends EventStructs> = {
  [K in keyof TEvents & (number | string)]: EventName<K> extends 'default'
    ? never
    : {
        data: Infer<TEvents[K]>
        event: EventName<K>
        id?: string
      }
}[keyof TEvents & (number | string)]

type DefaultEventUnion<TEvents extends EventStructs> = 'default' extends keyof TEvents
  ? {
      data: Infer<TEvents['default']>
      event: string
      id?: string
    }
  : never

/** Parsed SSE event payload inferred from an `EventStructs` map. */
export type EventStreamData<TEvents extends EventStructs> = TEvents extends EventStructs
  ? KnownEventUnion<TEvents> | DefaultEventUnion<TEvents>
  : never

interface EventStreamDefinitionBase<TEvents extends EventStructs = EventStructs> {
  events: TEvents
  maxBufferSize: number
  maxQueueSize: number
  method?: string
  operation?: string
  path: string
}

/** Makes `error` required only when an error struct is declared, so omission stays `Fault<undefined>`. */
type EventStreamErrorField<TError extends AnyStruct | undefined> = [TError] extends [undefined] ? { error?: never } : { error: TError }

/** Contract describing an SSE endpoint. Declared input requires an explicit builder. */
export type EventStreamDefinition<
  TInput extends AnyStruct | undefined = undefined,
  TEvents extends EventStructs = EventStructs,
  TError extends AnyStruct | undefined = undefined,
> = EventStreamDefinitionBase<TEvents> &
  EventStreamErrorField<TError> & {
    builder?: OutboundBuilder
    input?: TInput
  }

export type { EventStreamRequestShape } from '../internal/builder_types'

/** Await-result tuple from opening an SSE stream via `client.execute`. */
export type StreamAwaitResult<TEvent, TError extends AnyStruct | undefined = undefined> =
  | [error: null, stream: EventStreamHandle<TEvent>, open: EventStreamOpenInfo]
  | [error: Fault<TError>, stream: undefined, open: EventStreamOpenInfo | undefined]

/** Executable SSE command produced by an `EventStreamEndpoint`. */
export interface EventStreamCommand<
  TInput extends AnyStruct | undefined,
  TEvents extends EventStructs,
  TError extends AnyStruct | undefined = undefined,
> extends BaseCommand<typeof EVENT_STREAM_COMMAND> {
  readonly endpoint: ResolvedEventStreamDefinition<TInput, TEvents, TError>
  readonly input: EndpointInput<TInput> | undefined
}

/** Per-execute options for SSE commands (abort, timeout). */
export type EventStreamExecuteOptions = UseCancellationConfig & { signal?: AbortSignal }

/** Endpoint returned by `defineEventStream`; call it to create an `EventStreamCommand`. */
export type EventStreamEndpoint<
  TInput extends AnyStruct | undefined,
  TEvents extends EventStructs,
  TError extends AnyStruct | undefined = undefined,
> = EndpointCallable<TInput, EventStreamCommand<TInput, TEvents, TError>>

type ResolvedEventStreamDefinition<
  TInput extends AnyStruct | undefined = undefined,
  TEvents extends EventStructs = EventStructs,
  TError extends AnyStruct | undefined = undefined,
> = EventStreamDefinition<TInput, TEvents, TError> & {
  readonly method: string
}

/**
 * Declare a typed Server-Sent Events endpoint.
 *
 * Pass path, event structs, and buffer/queue limits. Call the returned endpoint
 * with input to get an `EventStreamCommand` for `client.execute`.
 *
 * @param definition - SSE contract (path, events, buffer limits, optional input).
 * @returns An endpoint that creates `EventStreamCommand` values from input.
 *
 * @example
 * ```ts
 * const useEvents = defineEventStream({
 *   maxBufferSize: 1024,
 *   maxQueueSize: 16,
 *   path: '/events',
 *   events: { message: struct.object({ text: struct.string() }) },
 * })
 * ```
 */
export function defineEventStream<
  const P extends string,
  const M extends string = 'GET',
  TInput extends AnyStruct | undefined = undefined,
  TEvents extends EventStructs = EventStructs,
  TError extends AnyStruct | undefined = undefined,
>(
  definition: Omit<EventStreamDefinitionBase<TEvents>, 'method' | 'path'> &
    EventStreamErrorField<TError> & {
      input?: TInput
      method?: M
      path: P
    } & BuilderField<NoInfer<TInput>, EventStreamRequestShape<NoInfer<P>, NoInfer<M>>>,
): EventStreamEndpoint<TInput, TEvents, TError> {
  // EventStreamErrorField is conditional, so this parameter is not directly the resolved endpoint.
  const endpoint = {
    ...definition,
    method: definition.method ?? 'GET',
  } as unknown as ResolvedEventStreamDefinition<TInput, TEvents, TError>

  function create(input?: EndpointInput<TInput>): EventStreamCommand<TInput, TEvents, TError> {
    const command: EventStreamCommand<TInput, TEvents, TError> = {
      [COMMAND_EXECUTE]: executeEventStreamCommand as CommandExecutor,
      [COMMAND_TYPE]: EVENT_STREAM_COMMAND,
      endpoint,
      input,
    }

    return command
  }

  return ((input?: EndpointInput<TInput>) => create(input)) as EventStreamEndpoint<TInput, TEvents, TError>
}

function castParsedEventStreamInput<TInput extends AnyStruct | undefined>(value: unknown): ParsedInput<TInput> {
  // Type boundary: parseEndpointInput validates with endpoint.input before this helper is called.
  return value as ParsedInput<TInput>
}

/**
 * Open an SSE command against the given client config.
 *
 * Prefer `client.execute(command)` in application code; this is the low-level entry used by the client.
 *
 * @param clientConfig - Resolved client configuration.
 * @param command - SSE command from an `EventStreamEndpoint`.
 * @param options - Optional execute options (abort, timeout).
 * @returns Await-result tuple of `[error, stream, open]`.
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
  const { endpoint, input } = command
  const config = options ?? {}
  const controller = new AbortController()
  return runEventStreamCommand(clientConfig, endpoint, input, config, controller)
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
  let cancellation
  try {
    cancellation = snapshotCancellationConfig(config)
  } catch (error) {
    return [createPreflightFault('REQ_OPTIONS_INVALID', error), undefined, undefined]
  }

  if (hasAbortTimeoutConflict(cancellation)) {
    return [createAbortTimeoutConflictFault(), undefined, undefined]
  }

  try {
    validateTransportTimeout(cancellation.timeout)
  } catch (error) {
    return [createPreflightFault('REQ_OPTIONS_INVALID', error), undefined, undefined]
  }

  // Fast path: caller already aborted before we did any struct work.
  const preAbortedSignal = [cancellation.abort, cancellation.signal].find((signal) => signal?.aborted)
  if (preAbortedSignal) {
    return [resolveAbortedFault(preAbortedSignal), undefined, undefined]
  }

  try {
    validateEventStreamLimits(endpoint)
  } catch (error) {
    return [createPreflightFault('REQ_OPTIONS_INVALID', error), undefined, undefined]
  }

  // The execute timeout is a startup deadline: armed before parse and the synchronous builder,
  // then released once startup settles so it cannot abort the open stream.
  const deadline = armTransportDeadline(cancellation.timeout)
  const requestSignal = mergeAbortSignals(controller.signal, [cancellation.abort, cancellation.signal, deadline.signal])
  deadline.releaseOnAbort(requestSignal)
  const stopBeforeTransport = (fault: PreflightFault): StreamAwaitResult<EventStreamData<TEvents>, TError> => {
    deadline.release()
    releaseAbortSignal(requestSignal)
    return [fault, undefined, undefined]
  }

  let parsedInput: ParsedInput<TInput>
  try {
    parsedInput = castParsedEventStreamInput<TInput>(await parseEndpointInput(endpoint.input, input))
  } catch (error) {
    return stopBeforeTransport(resolveTransportCancellation(deadline, requestSignal, createPreflightFault('REQ_INPUT_INVALID', error)))
  }

  const parsedCancellation = resolveTransportCancellation(deadline, requestSignal)
  if (parsedCancellation) {
    return stopBeforeTransport(parsedCancellation)
  }

  let request
  try {
    request = createBaseTransportRequest(endpoint.method, endpoint.path, parsedInput, endpoint.builder, {
      abort: requestSignal,
      baseEndpoint: clientConfig.endpoint,
      defaultHeaders: clientConfig.headers,
      inputDeclared: endpoint.input !== undefined,
      operation: endpoint.operation,
      querySerializer: clientConfig.querySerializer,
      timeout: cancellation.timeout,
      transport: 'sse',
      withCredentials: clientConfig.withCredentials,
    })
  } catch (error) {
    return stopBeforeTransport(resolveTransportCancellation(deadline, requestSignal, createPreflightFault('REQ_BUILD_FAILED', error)))
  }

  const builtCancellation = resolveTransportCancellation(deadline, requestSignal)
  if (builtCancellation) {
    return stopBeforeTransport(builtCancellation)
  }

  type OwnedStream = {
    controller: AbortController
    release?: () => void
    stream?: EventStreamHandle<unknown>
  }
  let chainSettled = false
  let streamDelivered = false
  const ownedStreams = new Set<OwnedStream>()
  try {
    const sseInterceptors = resolveSSEInterceptors(clientConfig.interceptors)
    const sseHandler: SSEHandler = (req) => {
      if (chainSettled) {
        const rejected = Promise.reject<EventStreamHandle<unknown>>(
          new Error('SSE interceptor next() cannot be called after the chain has settled'),
        )
        void rejected.catch(() => undefined)
        return rejected
      }
      // Interceptors run after the post-builder check. A deadline that expired there must not start the fetch.
      const transportAbort = mergeAbortSignals(requestSignal, [req.abort])
      const due = resolveTransportCancellation(deadline, transportAbort)
      if (due) {
        // `due` exists only after this signal has aborted, so the cause is the abort sentinel.
        // Reject with that sentinel, not the fault: the startup catch classifies sentinels.
        const rejected = Promise.reject<EventStreamHandle<unknown>>(markTransportOrigin(resolveAbortCause(transportAbort) as Error))
        releaseAbortSignal(transportAbort)
        void rejected.catch(() => undefined)
        return rejected
      }
      const ownerController = new AbortController()
      const owned: OwnedStream = {
        controller: ownerController,
      }
      ownedStreams.add(owned)
      const streamAbort = mergeAbortSignals(ownerController.signal, [transportAbort])
      owned.release = () => {
        releaseAbortSignal(streamAbort)
        releaseAbortSignal(transportAbort)
      }
      // Type boundary: SSEHandler returns EventStreamHandle<unknown>; the concrete type is narrowed by the interceptor chain.
      const promise = fetchEventStream(
        { ...req, abort: streamAbort },
        {
          fetch: clientConfig.sse.handle,
          handshakeError: endpoint.error,
          transformMessage(message, signal) {
            return transformStreamMessage(endpoint.events, message, clientConfig.sse.onInvalidEvent, signal)
          },
          reconnect: clientConfig.sse.reconnect,
          maxBufferSize: endpoint.maxBufferSize,
          maxQueueSize: endpoint.maxQueueSize,
        },
      ).then(
        (stream) => {
          owned.stream = stream
          void stream.closed.then(owned.release, owned.release)
          return stream
        },
        (cause: unknown) => {
          owned.release?.()
          throw markTransportOrigin(cause)
        },
      )
      void promise.catch(() => undefined)
      return promise
    }
    const sseChain = makeChain(sseInterceptors)
    // Type boundary: interceptor chain returns EventStreamHandle<unknown>; runtime message transform narrows it to the endpoint's event types.
    const stream = (await awaitWithSignal(() => sseChain(request, sseHandler), requestSignal)) as EventStreamHandle<
      EventStreamData<TEvents>
    >
    chainSettled = true
    streamDelivered = true
    void stream.closed.then(() => releaseAbortSignal(requestSignal))

    const open = stream.open

    discardOwnedStreams(new Error('SSE interceptor discarded an opened stream'), stream)

    return [null, stream, open]
  } catch (error) {
    chainSettled = true
    discardOwnedStreams(error)

    const fromTransport = isTransportOrigin(error)
    const cause = error
    const openInfo = getErrorOpenInfo(cause)
    const fault = requestSignal.aborted
      ? resolveAbortedFault(requestSignal)
      : createEventStreamFault(cause, fromTransport, openInfo?.response)
    return [fault as Fault<TError>, undefined, openInfo]
  } finally {
    deadline.release()
    if (!streamDelivered) {
      releaseAbortSignal(requestSignal)
    }
  }

  function discardOwnedStreams(reason: unknown, delivered?: EventStreamHandle<unknown>): void {
    for (const owned of ownedStreams) {
      if (owned.stream && delivered && (owned.stream === delivered || owned.stream.closed === delivered.closed)) {
        continue
      }
      owned.controller.abort(reason)
      owned.stream?.close(reason)
      owned.release?.()
    }
    ownedStreams.clear()
  }
}

// Synchronous on the valid path. Only an invalid event awaits the observer.
function transformStreamMessage<TEvents extends EventStructs>(
  events: TEvents,
  message: EventStreamMessage,
  onInvalidEvent: ClientSSEOptions['onInvalidEvent'],
  signal: AbortSignal,
): EventStreamData<TEvents> | Promise<undefined> {
  const eventName = message.event || 'message'
  const eventStruct = resolveEventStruct(events, eventName)

  if (!eventStruct) {
    return notifyInvalidEvent(onInvalidEvent, {
      reason: 'missing-struct',
      message: {
        id: message.id || '',
        event: eventName,
        data: message.data,
      },
      signal,
    })
  }

  try {
    return {
      data: decodeSSEEventData(eventStruct, message.data),
      event: eventName,
      id: message.id || undefined,
      // Type boundary: decodeSSEEventData validates against the resolved event struct; the shape matches EventStreamData<TEvents>.
    } as EventStreamData<TEvents>
  } catch (error) {
    return notifyInvalidEvent(onInvalidEvent, {
      reason: 'validation-failed',
      message: {
        id: message.id || '',
        event: eventName,
        data: message.data,
      },
      cause: error,
      signal,
    })
  }
}

async function notifyInvalidEvent(
  onInvalidEvent: ClientSSEOptions['onInvalidEvent'],
  context: {
    reason: 'missing-struct' | 'validation-failed'
    message: { id: string; event: string; data: string }
    cause?: unknown
    signal: AbortSignal
  },
): Promise<undefined> {
  if (!onInvalidEvent) {
    return undefined
  }

  try {
    await awaitWithSignal(() => onInvalidEvent(context), context.signal)
  } catch (error) {
    if (context.signal.aborted) {
      throw error
    }
    // onInvalidEvent is an observer; observer failures must not tear down the stream.
  }
  return undefined
}

function validateEventStreamLimits(endpoint: { maxBufferSize: number; maxQueueSize: number }): void {
  for (const name of ['maxBufferSize', 'maxQueueSize'] as const) {
    if (!Number.isSafeInteger(endpoint[name]) || endpoint[name] < 1) {
      throw new TypeError(`SSE ${name} must be a positive safe integer`)
    }
  }
}

function resolveEventStruct<TEvents extends EventStructs>(events: TEvents, eventName: string): AnyStruct | undefined {
  // Security: event declarations must be own properties. Declare the valid `__proto__` event name with a computed key.
  if (Object.hasOwn(events, eventName)) {
    return events[eventName]
  }

  if (Object.hasOwn(events, 'default')) {
    return events['default']
  }

  return undefined
}

function decodeSSEEventData(struct: AnyStruct, data: string): unknown {
  // Only a string struct keeps the raw data field. Every other kind is JSON text.
  if (resolveInboundRepresentation(struct) === 'text') {
    return parseStructValue(struct, data)
  }

  return decodeJson(struct, JSON.parse(data) as unknown)
}

function toEventStreamMeta(response: HttpResponse<unknown>): HttpMeta {
  return {
    headers: response.headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  }
}

function createEventStreamFault(cause: unknown, fromTransport: boolean, response?: HttpResponse<unknown>): AnyFault {
  const fatal = getEventStreamFatalCode(cause)
  // The JSON media-type precheck is a decode fault on every status.
  if (response && fatal === 'RES_MEDIA_TYPE_INVALID') {
    return createDecodeFault(fatal, handshakeDecodeCause(cause), toEventStreamMeta(response))
  }

  if (response && !response.ok) {
    const meta = toEventStreamMeta(response)
    // Decoded null is a real body. Only an unread handshake leaves `body` undefined.
    if (response.body !== undefined) {
      return createHttpStatusFault({ ...meta, body: response.body })
    }
    if (fatal === 'RES_DECODE_FAILED' && !isHandshakeStatusSignal(cause)) {
      return createDecodeFault(fatal, handshakeDecodeCause(cause), meta)
    }
    return createUndecodedHttpStatusFault(meta)
  }

  // `CAP_*` and `EXT_*` happen after the stream opens, so they settle `closed` rather than startup.
  if (response && fatal === 'RES_DECODE_FAILED') {
    return createDecodeFault(fatal, handshakeDecodeCause(cause), toEventStreamMeta(response))
  }

  return fromTransport ? createNetworkFault(cause) : createPreflightFault('EXT_INTERCEPTOR_FAILED', cause)
}
