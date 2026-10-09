import { COMMAND_EXECUTE, COMMAND_TYPE, WEB_SOCKET_COMMAND, type CommandExecutor } from '../client/command'
import type { BaseCommand } from '../client/command'
import type { ClientConfig, ClientWebSocketOptions, WebSocketHandle } from '../client/config'

import type { AnyFault, Fault, PreflightFault } from '../error'
import { createNetworkFault, createPreflightFault, ERR_ABORTED } from '../error'
import type { WebSocketSessionLike } from '../interceptor/interceptor'
import { makeChain, resolveWebSocketInterceptors } from '../interceptor/interceptor'
import type { UseCancellationConfig } from '../internal/abort'
import {
  armTransportDeadline,
  awaitWithSignal,
  createAbortTimeoutConflictFault,
  hasAbortTimeoutConflict,
  mergeAbortSignals,
  releaseAbortSignal,
  resolveAbortedFault,
  resolveAbortFault,
  resolveTransportCancellation,
  snapshotCancellationConfig,
  validateTransportTimeout,
} from '../internal/abort'
import { AsyncQueue } from '../internal/async_queue'
import type { EndpointCallable } from '../internal/endpoint_command'
import type { EndpointInput, ParsedInput } from '../internal/endpoint_input'
import { parseEndpointInput } from '../internal/endpoint_input'
import type { HttpRequest } from '../internal/http_request'
import type { RequestBuildValue } from '../internal/request_values'
import type { BuilderField, WebSocketRequestShape } from '../internal/builder_types'
import type { MaterializedRequest, OutboundBuilder } from '../internal/outbound_request'
import { materializeOutboundRequest, runOutboundBuilder } from '../internal/outbound_request'
import type { AnyStruct, Infer, StructInput } from '../struct'
import { createWebSocketRequest, createWebSocketUrlFromRequest } from './build'
import { decodeWebSocketMessage, extractCloseInfo, serializeOutgoingWebSocketMessage } from './codec'
import type { WebSocketCloseSnapshot } from './codec'
import type { HeartbeatRuntime } from './heartbeat'
import { startHeartbeat, stopHeartbeat, validateHeartbeatConfig } from './heartbeat'
import { computeReconnectDelay, wait } from '../internal/backoff'
import { normalizeReconnectConfig, shouldReconnect } from './reconnect'

/** Lifecycle state of a managed WebSocket session. */
export type WebSocketState = 'aborted' | 'closed' | 'closing' | 'connecting' | 'error' | 'idle' | 'open' | 'reconnecting'

/** Decoded incoming frame. Alias fields use their logical names. */
export type WebSocketIncomingData<TIncoming extends AnyStruct> = Infer<TIncoming>

/** Value accepted by `session.send`. `never` when the endpoint declares no outgoing struct. */
export type WebSocketOutgoingData<TOutgoing extends AnyStruct | undefined> = TOutgoing extends AnyStruct ? StructInput<TOutgoing> : never

interface WebSocketDefinitionBase<TIncoming extends AnyStruct = AnyStruct, TOutgoing extends AnyStruct | undefined = undefined> {
  incoming: TIncoming
  maxIncomingQueueSize: number
  maxOutgoingQueueSize?: number
  operation?: string
  outgoing?: TOutgoing
  path: string
  protocols?: readonly string[]
}

/** Contract describing a WebSocket endpoint: path, message structs, and queue limits. */
export type WebSocketDefinition<
  TInput extends AnyStruct | undefined = undefined,
  TIncoming extends AnyStruct = AnyStruct,
  TOutgoing extends AnyStruct | undefined = undefined,
> = WebSocketDefinitionBase<TIncoming, TOutgoing> & {
  builder?: OutboundBuilder
  input?: TInput
}

export type { WebSocketRequestShape } from '../internal/builder_types'

/** Connection metadata for the current WebSocket generation. */
export interface WebSocketConnectionInfo {
  extensions?: string
  generation: number
  protocol?: string
  url?: string
}

/** How a WebSocket session ended: closed, aborted, or error. */
export type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }

/** Typed WebSocket session: send/receive messages, observe state, and close. */
export interface WebSocketSession<TIncoming = unknown, TOutgoing = never> extends AsyncDisposable {
  readonly bufferedAmount: number
  readonly connection: WebSocketConnectionInfo
  readonly closed: Promise<WebSocketCloseInfo>
  readonly receive: AsyncIterable<TIncoming>
  readonly state: WebSocketState
  close(code?: number, reason?: string): void
  [Symbol.asyncDispose](): PromiseLike<void>
  onRuntimeError(listener: (error: unknown) => void): () => void
  onStateChange(listener: (state: WebSocketState) => void): () => void
  send(message: TOutgoing): void
}

/** Await-result tuple from opening a WebSocket via `client.execute`. */
export type SocketAwaitResult<TIncoming, TOutgoing = never> =
  | [error: null, socket: WebSocketSession<TIncoming, TOutgoing>, connection: WebSocketConnectionInfo]
  | [error: Fault<undefined>, socket: undefined, connection: WebSocketConnectionInfo | undefined]

interface UseWebSocketBaseConfig<TIncoming = unknown, TOutgoing = unknown> {
  beforeConnect?: ClientWebSocketOptions['beforeConnect']
  heartbeat?: WebSocketHeartbeatConfig<TIncoming, TOutgoing>
  protocols?: readonly string[]
  reconnect?: ClientWebSocketOptions['reconnect']
}

/** Client configuration for WebSocket execute (heartbeat, reconnect, abort). */
export type UseWebSocketConfig<TIncoming = unknown, TOutgoing = unknown> = UseWebSocketBaseConfig<TIncoming, TOutgoing> &
  UseCancellationConfig

/** Per-execute options for WebSocket commands, including an optional `AbortSignal`. */
export type WebSocketExecuteOptions<TIncoming = unknown, TOutgoing = unknown> = UseWebSocketConfig<TIncoming, TOutgoing> & {
  signal?: AbortSignal
}

/** Executable WebSocket command produced by a `WebSocketEndpoint`. */
export interface WebSocketCommand<
  TInput extends AnyStruct | undefined,
  TIncoming extends AnyStruct,
  TOutgoing extends AnyStruct | undefined,
> extends BaseCommand<typeof WEB_SOCKET_COMMAND> {
  readonly endpoint: WebSocketDefinition<TInput, TIncoming, TOutgoing>
  readonly input: EndpointInput<TInput> | undefined
}

/** Endpoint returned by `defineWebSocket`; call it to create a `WebSocketCommand`. */
export type WebSocketEndpoint<
  TInput extends AnyStruct | undefined,
  TIncoming extends AnyStruct,
  TOutgoing extends AnyStruct | undefined,
> = EndpointCallable<TInput, WebSocketCommand<TInput, TIncoming, TOutgoing>>

type SocketRefState = {
  connection?: WebSocketConnectionInfo
  error?: AnyFault
  listeners: {
    runtimeError: Set<(error: unknown) => void>
    stateChange: Set<(state: WebSocketState) => void>
  }
  status: WebSocketState
  transition: number
}

/** Reason recorded when the session is closed via `session.close()`. */
export type ManualSocketCloseReason = {
  code?: number
  kind: 'manual-web-socket-close'
  reason?: string
}

/** Heartbeat ping/ack configuration for a live WebSocket session. */
export interface WebSocketHeartbeatConfig<TIncoming = unknown, TOutgoing = unknown> {
  intervalMs: number
  isAck?: (message: TIncoming) => boolean
  message?: () => TOutgoing
  timeoutMs?: number
}

function castParsedWebSocketInput<TInput extends AnyStruct | undefined>(value: unknown): ParsedInput<TInput> {
  // Type boundary: parseEndpointInput validates with endpoint.input before this helper is called.
  return value as ParsedInput<TInput>
}

/**
 * Declare a typed WebSocket endpoint.
 *
 * Pass path, incoming (and optional outgoing) message structs, and queue limits.
 * Call the returned endpoint with input to get a `WebSocketCommand` for `client.execute`.
 *
 * @param definition - WebSocket contract (path, structs, queue limits, optional input).
 * @returns An endpoint that creates `WebSocketCommand` values from input.
 *
 * @example
 * ```ts
 * const useChat = defineWebSocket({
 *   maxIncomingQueueSize: 16,
 *   path: '/ws/chat',
 *   incoming: struct.object({ text: struct.string(), type: struct.literal('message') }),
 *   outgoing: struct.object({ text: struct.string(), type: struct.literal('message') }),
 * })
 * ```
 */
export function defineWebSocket<
  const P extends string,
  TInput extends AnyStruct | undefined = undefined,
  TIncoming extends AnyStruct = AnyStruct,
  TOutgoing extends AnyStruct | undefined = undefined,
>(
  definition: Omit<WebSocketDefinitionBase<TIncoming, TOutgoing>, 'path'> & {
    input?: TInput
    path: P
  } & BuilderField<NoInfer<TInput>, WebSocketRequestShape<NoInfer<P>>>,
): WebSocketEndpoint<TInput, TIncoming, TOutgoing> {
  // Snapshot the top-level definition so a later mutation of the caller's object cannot retarget this endpoint.
  const endpoint = { ...definition } as WebSocketDefinition<TInput, TIncoming, TOutgoing>

  function create(input?: EndpointInput<TInput>): WebSocketCommand<TInput, TIncoming, TOutgoing> {
    const command: WebSocketCommand<TInput, TIncoming, TOutgoing> = {
      [COMMAND_EXECUTE]: executeWebSocketCommand as CommandExecutor,
      [COMMAND_TYPE]: WEB_SOCKET_COMMAND,
      endpoint,
      input,
    }

    return command
  }

  return ((input?: EndpointInput<TInput>) => create(input)) as WebSocketEndpoint<TInput, TIncoming, TOutgoing>
}

async function runWebSocketCommand<
  TInput extends AnyStruct | undefined,
  TIncoming extends AnyStruct,
  TOutgoing extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  endpoint: WebSocketDefinition<TInput, TIncoming, TOutgoing>,
  input: EndpointInput<TInput> | undefined,
  config: WebSocketExecuteOptions<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>,
  controller: AbortController,
  state: SocketRefState,
): Promise<SocketAwaitResult<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>> {
  setSocketState(state, 'connecting')

  let cancellationConfig: ReturnType<typeof snapshotCancellationConfig>
  try {
    cancellationConfig = snapshotCancellationConfig(config)
  } catch (error) {
    const definitionError = createPreflightFault('REQ_OPTIONS_INVALID', error)
    state.error = definitionError
    setSocketState(state, 'error')
    return [definitionError, undefined, undefined]
  }

  if (hasAbortTimeoutConflict(cancellationConfig)) {
    const definitionError = createAbortTimeoutConflictFault()
    state.error = definitionError
    setSocketState(state, 'error')
    return [definitionError, undefined, undefined]
  }

  try {
    validateTransportTimeout(cancellationConfig.timeout)
  } catch (error) {
    const definitionError = createPreflightFault('REQ_OPTIONS_INVALID', error)
    state.error = definitionError
    setSocketState(state, 'error')
    return [definitionError, undefined, undefined]
  }

  // Same fast path as HTTP/SSE: an already aborted call does not parse, build, or validate the socket.
  const preAbortedSignal = [cancellationConfig.abort, cancellationConfig.signal].find((signal) => signal?.aborted)
  if (preAbortedSignal) {
    const aborted = resolveAbortedFault(preAbortedSignal)
    state.error = aborted
    setSocketState(state, aborted.code === 'NET_ABORTED' ? 'aborted' : 'error')
    return [aborted, undefined, undefined]
  }

  try {
    validateWebSocketQueueLimits(endpoint.maxIncomingQueueSize, endpoint.maxOutgoingQueueSize)
  } catch (error) {
    const definitionError = createPreflightFault('REQ_OPTIONS_INVALID', error)
    state.error = definitionError
    setSocketState(state, 'error')
    return [definitionError, undefined, undefined]
  }

  let beforeConnectOption: ClientWebSocketOptions['beforeConnect']
  let protocolsOption: readonly string[] | undefined
  let reconnect: ReturnType<typeof normalizeReconnectConfig>
  let heartbeatConfig: WebSocketHeartbeatConfig<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>> | undefined
  try {
    beforeConnectOption = config.beforeConnect
    const configuredProtocols = config.protocols
    protocolsOption = configuredProtocols ? [...configuredProtocols] : undefined
    const reconnectOption = config.reconnect ?? clientConfig.webSocket.reconnect
    const heartbeatOption = (config.heartbeat ?? clientConfig.webSocket.heartbeat) as
      // Type boundary: client config stores the heartbeat as a generic shape; the local type adds incoming/outgoing specificity.
      WebSocketHeartbeatConfig<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>> | undefined
    heartbeatConfig = heartbeatOption
      ? {
          intervalMs: heartbeatOption.intervalMs,
          isAck: heartbeatOption.isAck,
          message: heartbeatOption.message,
          timeoutMs: heartbeatOption.timeoutMs,
        }
      : undefined
    validateHeartbeatConfig(heartbeatConfig)
    reconnect = normalizeReconnectConfig(reconnectOption)
  } catch (error) {
    const definitionError = createPreflightFault('REQ_OPTIONS_INVALID', error)
    state.error = definitionError
    setSocketState(state, 'error')
    return [definitionError, undefined, undefined]
  }

  // Startup deadline: armed before parse and the synchronous builder, released when startup
  // settles. A later reconnect does not re-arm it.
  const deadline = armTransportDeadline(cancellationConfig.timeout)
  const chainController = new AbortController()
  const chainSignal = mergeAbortSignals(chainController.signal, [cancellationConfig.abort, cancellationConfig.signal, deadline.signal])
  const signal = mergeAbortSignals(controller.signal, [chainSignal])
  deadline.releaseOnAbort(chainSignal)
  const stopBeforeTransport = (
    fault: PreflightFault,
  ): SocketAwaitResult<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>> => {
    deadline.release()
    releaseAbortSignal(chainSignal)
    releaseAbortSignal(signal)
    state.error = fault
    setSocketState(state, fault.code === 'NET_ABORTED' ? 'aborted' : 'error')
    return [fault, undefined, undefined]
  }

  let parsedInput: ParsedInput<TInput>
  try {
    parsedInput = castParsedWebSocketInput<TInput>(await parseEndpointInput(endpoint.input, input))
  } catch (error) {
    return stopBeforeTransport(resolveTransportCancellation(deadline, signal, createPreflightFault('REQ_INPUT_INVALID', error)))
  }

  const parsedCancellation = resolveTransportCancellation(deadline, signal)
  if (parsedCancellation) {
    return stopBeforeTransport(parsedCancellation)
  }

  let built: MaterializedRequest
  try {
    built = materializeOutboundRequest(runOutboundBuilder(parsedInput, endpoint.builder), 'webSocket')
  } catch (error) {
    return stopBeforeTransport(resolveTransportCancellation(deadline, signal, createPreflightFault('REQ_BUILD_FAILED', error)))
  }

  const builtCancellation = resolveTransportCancellation(deadline, signal)
  if (builtCancellation) {
    return stopBeforeTransport(builtCancellation)
  }

  let wsRequest: HttpRequest
  try {
    wsRequest = createWebSocketRequest({
      abort: signal,
      baseEndpoint: clientConfig.endpoint,
      operation: endpoint.operation,
      params: built.params,
      path: endpoint.path,
      query: built.query as { [key: string]: RequestBuildValue } | URLSearchParams | undefined,
      querySerializer: clientConfig.querySerializer,
      withCredentials: clientConfig.withCredentials,
    })
  } catch (error) {
    return stopBeforeTransport(resolveTransportCancellation(deadline, signal, createPreflightFault('REQ_BUILD_FAILED', error)))
  }

  const WebSocketCtor = clientConfig.webSocket.handle ?? globalThis.WebSocket
  if (typeof WebSocketCtor !== 'function') {
    return stopBeforeTransport(createPreflightFault('ENV_UNSUPPORTED', new Error('WebSocket is not supported in current runtime')))
  }
  const WebSocketImpl = WebSocketCtor as unknown as new (url: string | URL, protocols?: string | string[]) => WebSocketHandle

  let startupConnection: WebSocketConnectionInfo | undefined
  const undeliveredSessions = new Set<WebSocketSessionLike>()
  const pendingSessions = new Set<Promise<WebSocketSessionLike>>()
  let wsHandlerInvoked = false
  let chainSettled = false
  const wsHandler = (req: HttpRequest): Promise<WebSocketSessionLike> => {
    if (chainSettled || wsHandlerInvoked) {
      const rejection = Promise.reject(
        new Error(
          chainSettled
            ? 'WebSocket interceptor next() may not be called after the chain settles'
            : 'WebSocket interceptor next() may only be called once',
        ),
      )
      void rejection.catch(() => undefined)
      return rejection
    }
    wsHandlerInvoked = true
    // Captured before the executor shadows `signal`. Both the caller and an interceptor replacement stay live.
    const executionSignal = signal
    const pendingSession = new Promise<WebSocketSessionLike>((resolveSession, rejectSession) => {
      const signal = mergeAbortSignals(executionSignal, [req.abort])
      const incomingQueue = new AsyncQueue<WebSocketIncomingData<TIncoming>>({
        maxSize: endpoint.maxIncomingQueueSize,
      })
      const closedDeferred = Promise.withResolvers<WebSocketCloseInfo>()
      const sessionController = {
        currentSocket: undefined as WebSocketHandle | undefined,
        heartbeat: undefined as HeartbeatRuntime<WebSocketIncomingData<TIncoming>> | undefined,
      }
      const sendQueue: string[] = []
      let startupSettled = false
      let finished = false
      let latestConnection: WebSocketConnectionInfo | undefined
      let attempt = 0
      let generation = 0
      let activeAttempt: ActiveSocketAttempt | undefined
      let manualClose: ManualSocketCloseReason | undefined
      const messagePumpTasks = new Set<Promise<void>>()
      let disposeTask: Promise<void> | undefined
      let disposeTimer: ReturnType<typeof setTimeout> | undefined
      let disposeTimeout: DOMException | undefined
      let hasCloseError = false
      let closeError: unknown
      let physicalCleanupDetach: (() => void) | undefined

      const hasReconnectPredicate = reconnect?.hasShouldReconnect ?? false
      const beforeConnect = (beforeConnectOption ?? clientConfig.webSocket.beforeConnect) as
        | ((context: { attempt: number; signal: AbortSignal }) => Promise<void> | void)
        | undefined
      const baseProtocols = [...(protocolsOption ?? clientConfig.webSocket.protocols ?? endpoint.protocols ?? [])]
      const session = createWebSocketSession(
        endpoint.outgoing,
        incomingQueue,
        closedDeferred.promise,
        state,
        sessionController,
        sendQueue,
        endpoint.maxOutgoingQueueSize ?? 0,
        WebSocketCtor.OPEN,
        () => finished || signal.aborted,
        requestClose,
        disposeSession,
        // Type boundary: createWebSocketSession is generic over TIncoming/TOutgoing; the cast aligns the locally-typed session with the endpoint's struct types.
      ) as WebSocketSession<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>

      const lifecycleTask = run().catch((cause) => {
        finish({ cause, kind: 'error' })
      })

      async function run(): Promise<void> {
        while (!finished) {
          if (signal.aborted) {
            finishFromSignal()
            return
          }

          const nextState = attempt === 0 ? 'connecting' : 'reconnecting'
          setSocketState(state, nextState)

          const prepared = await prepareAttempt()
          if (finished) {
            return
          }
          if (!prepared.ok) {
            if (prepared.aborted) {
              finishFromSignal()
            } else {
              finish({ cause: prepared.error, kind: 'error' }, { startupError: prepared.error })
            }
            return
          }
          if (signal.aborted) {
            finishFromSignal()
            return
          }

          const outcome = await connectOnce(prepared.url, prepared.protocols)
          if (finished) {
            return
          }

          if (!startupSettled && outcome.connection) {
            latestConnection = outcome.connection
            state.connection = latestConnection
          }

          if (signal.aborted) {
            finishFromSignal(outcome.closeInfo)
            return
          }

          if (manualClose) {
            finish(toClosedInfo(outcome.closeInfo, manualClose))
            return
          }

          const nextAttempt = attempt + 1
          let reconnectRequested = false
          let reconnectPredicateDeclined = false
          if (reconnect && nextAttempt <= reconnect.attempts) {
            try {
              reconnectRequested = shouldReconnect(reconnect, outcome, nextAttempt)
              reconnectPredicateDeclined = hasReconnectPredicate && !reconnectRequested
            } catch (cause) {
              if (finished) {
                return
              }
              if (signal.aborted) {
                finishFromSignal(outcome.closeInfo)
              } else {
                finish(toErrorInfo(outcome.closeInfo, cause))
              }
              return
            }
          }
          if (finished) {
            return
          }
          if (signal.aborted) {
            finishFromSignal(outcome.closeInfo)
            return
          }

          if (reconnectRequested && reconnect) {
            attempt = nextAttempt
            setSocketState(state, 'reconnecting')
            if (finished) {
              return
            }
            if (signal.aborted) {
              finishFromSignal(outcome.closeInfo)
              return
            }
            const delayMs = computeReconnectDelay(reconnect, nextAttempt)
            if (delayMs > 0) {
              try {
                await wait(delayMs, signal)
              } catch {
                if (!finished) {
                  finishFromSignal(outcome.closeInfo)
                }
                return
              }
            }
            continue
          }

          if (!startupSettled) {
            const cause = outcome.cause ?? new Error('WebSocket closed before open')
            const startupError = createNetworkFault(cause)
            finish(toErrorInfo(outcome.closeInfo, cause), { startupError })
            return
          }

          if (reconnectPredicateDeclined) {
            finish(toClosedInfo(outcome.closeInfo))
            return
          }

          if (typeof outcome.cause === 'undefined') {
            finish(toClosedInfo(outcome.closeInfo))
          } else {
            finish(toErrorInfo(outcome.closeInfo, outcome.cause))
          }
          return
        }
      }

      async function prepareAttempt(): Promise<
        | { aborted: false; error: AnyFault; ok: false }
        | { aborted: true; ok: false }
        | { ok: true; protocols: readonly string[]; url: string }
      > {
        let url: string
        try {
          url = createWebSocketUrlFromRequest(req)
        } catch (error) {
          return {
            aborted: false,
            error: createPreflightFault('REQ_BUILD_FAILED', error),
            ok: false,
          }
        }

        if (beforeConnect) {
          try {
            await awaitWithSignal(() => beforeConnect({ attempt, signal }), signal)
            signal.throwIfAborted()
          } catch (error) {
            if (signal.aborted) {
              return { aborted: true, ok: false }
            }
            return {
              aborted: false,
              error: createPreflightFault('EXT_HOOK_FAILED', error),
              ok: false,
            }
          }
        }

        return {
          ok: true,
          protocols: baseProtocols,
          url,
        }
      }

      async function connectOnce(url: string, protocols: readonly string[]): Promise<SocketLifecycleOutcome> {
        // Query serialization and interceptors have already run. Do not construct a socket once cancelled.
        const due = resolveTransportCancellation(deadline, signal)
        if (due) {
          return {
            cause: due,
            closeInfo: { cause: due, reason: due.message },
            opened: false,
          }
        }

        let socket: WebSocketHandle
        try {
          socket = protocols.length > 0 ? new WebSocketImpl(url, [...protocols]) : new WebSocketImpl(url)
          /* istanbul ignore else -- @preserve defensive: binaryType may not exist on injected nonstandard WebSocket handles */
          if ('binaryType' in socket) {
            socket.binaryType = 'arraybuffer'
          }
        } catch (error) {
          return {
            closeInfo: { cause: error, reason: error instanceof Error ? error.message : 'WebSocket connection error' },
            connection: undefined,
            cause: error,
            opened: false,
          }
        }

        sessionController.currentSocket = socket
        let opened = false
        let runtimeCause: unknown

        return await new Promise<SocketLifecycleOutcome>((resolveAttempt) => {
          let closeOutcome: SocketLifecycleOutcome | undefined
          let closeObserved = false
          let errorCloseTimer: ReturnType<typeof setTimeout> | undefined
          let messagePumpRunning = false
          const messageController = new AbortController()
          const messageSignal = mergeAbortSignals(signal, [messageController.signal])
          const rawMessages: MessageEvent[] = []
          let settled = false

          const clearErrorCloseTimer = () => {
            if (typeof errorCloseTimer === 'undefined') {
              return
            }
            clearTimeout(errorCloseTimer)
            errorCloseTimer = undefined
          }

          const cleanup = (keepCurrentSocket: boolean) => {
            clearErrorCloseTimer()
            stopHeartbeat(sessionController)
            messageController.abort()
            releaseAbortSignal(messageSignal)
            rawMessages.length = 0
            socket.removeEventListener('open', handleOpen)
            socket.removeEventListener('message', onMessage)
            socket.removeEventListener('close', handleClose)
            socket.removeEventListener('error', handleError)
            signal.removeEventListener('abort', handleAbort)
            if (!keepCurrentSocket && sessionController.currentSocket === socket) {
              sessionController.currentSocket = undefined
            }
          }

          const connectionInfo = (): WebSocketConnectionInfo => ({
            extensions: socket.extensions || undefined,
            generation,
            protocol: socket.protocol || undefined,
            url: socket.url,
          })

          const settleAttempt = (outcome: SocketLifecycleOutcome, keepCurrentSocket = false) => {
            /* istanbul ignore if -- @preserve defensive: every physical attempt is settled through this once-only gate */
            if (settled) {
              return
            }
            settled = true
            cleanup(keepCurrentSocket)
            /* istanbul ignore else -- @preserve invariant: activeAttempt refers to the sole physical socket until settlement */
            if (activeAttempt?.socket === socket) {
              activeAttempt = undefined
            }
            resolveAttempt(outcome)
          }

          const handleAbort = () => {
            if (finished) {
              return
            }
            if (!startupSettled) {
              latestConnection = connectionInfo()
              state.connection = latestConnection
            }
            finishFromSignal(extractCloseInfo(undefined, signal.reason))
          }

          const handleOpen = () => {
            if (finished || opened) {
              return
            }
            opened = true
            generation += 1
            latestConnection = connectionInfo()
            state.connection = latestConnection
            try {
              flushSendQueue(socket, sendQueue, WebSocketCtor.OPEN)
            } catch (cause) {
              finish({ cause, kind: 'error' })
              return
            }
            if (finished || manualClose) {
              return
            }
            setSocketState(state, 'open')
            if (finished) {
              return
            }
            if (!startupSettled) {
              startupConnection = latestConnection
              startupSettled = true
              deadline.release()
              // Type boundary: session is created as WebSocketSession<...> above; resolveSession expects WebSocketSessionLike (structural match).
              resolveSession(session as WebSocketSessionLike)
            }
            if (state.status === 'open') {
              startHeartbeat(
                socket,
                sessionController,
                heartbeatConfig,
                endpoint.outgoing,
                (cause) => {
                  finish({ cause, kind: 'error' })
                },
                WebSocketCtor.OPEN,
              )
            }
          }

          const handleMessage = async (event: MessageEvent) => {
            /* istanbul ignore if -- @preserve defensive: stale physical listeners are removed before logical settlement */
            if (finished || sessionController.currentSocket !== socket) {
              return
            }
            let transformed: WebSocketIncomingData<TIncoming> | undefined
            try {
              messageSignal.throwIfAborted()
              // Text and byte frames decode synchronously. Only a Blob read waits, so only it races the signal.
              const decoded = decodeWebSocketMessage(endpoint.incoming, event.data)
              transformed = (decoded instanceof Promise ? await awaitWithSignal(() => decoded, messageSignal) : decoded) as
                | WebSocketIncomingData<TIncoming>
                | undefined
            } catch (error) {
              if (finished || messageController.signal.aborted) {
                return
              }
              emitRuntimeError(state, error)
              return
            }
            if (finished || sessionController.currentSocket !== socket || typeof transformed === 'undefined') {
              return
            }

            try {
              const heartbeat = sessionController.heartbeat
              const isAck = heartbeat?.isAck?.(transformed) ?? false
              if (finished || sessionController.currentSocket !== socket || sessionController.heartbeat !== heartbeat) {
                return
              }
              if (isAck && heartbeat) {
                heartbeat.markAck()
                return
              }
              incomingQueue.push(transformed)
            } catch (cause) {
              if (!finished) {
                finish({ cause, kind: 'error' })
              }
            }
          }

          const pumpMessages = async () => {
            if (messagePumpRunning) {
              return
            }
            messagePumpRunning = true
            try {
              while (!finished && rawMessages.length > 0) {
                const event = rawMessages.shift() as MessageEvent
                await handleMessage(event)
              }
              if (!finished && closeOutcome && rawMessages.length === 0) {
                settleAttempt(closeOutcome)
              }
            } catch (cause) {
              /* istanbul ignore next -- @preserve defensive: handleMessage and settleAttempt contain their own failure boundaries */
              finish({ cause, kind: 'error' })
            } finally {
              messagePumpRunning = false
              if (finished) {
                rawMessages.length = 0
              }
            }
          }

          const onMessage = (event: MessageEvent) => {
            /* istanbul ignore if -- @preserve defensive: physical message listeners are removed as soon as close is observed */
            if (finished || closeObserved || sessionController.currentSocket !== socket) {
              return
            }
            if (rawMessages.length >= endpoint.maxIncomingQueueSize) {
              finish({ cause: new Error('WebSocket raw message queue overflow'), kind: 'error' })
              return
            }
            rawMessages.push(event)
            const messagePumpTask = pumpMessages()
            messagePumpTasks.add(messagePumpTask)
            void messagePumpTask.finally(() => {
              messagePumpTasks.delete(messagePumpTask)
            })
          }

          const handleError = () => {
            runtimeCause = runtimeCause ?? new Error('WebSocket connection error')
            stopHeartbeat(sessionController)
            socket.removeEventListener('error', handleError)
            errorCloseTimer = setTimeout(() => {
              errorCloseTimer = undefined
              finish({ cause: runtimeCause, kind: 'error' }, { skipNativeClose: true })
            }, SOCKET_CLOSE_GRACE_MS)
            try {
              socket.close()
            } catch {
              clearErrorCloseTimer()
              finish({ cause: runtimeCause, kind: 'error' }, { skipNativeClose: true })
            }
          }

          const handleClose = (event: CloseEvent) => {
            if (closeObserved) {
              return
            }
            closeObserved = true
            clearErrorCloseTimer()
            sessionController.heartbeat?.stop()
            socket.removeEventListener('open', handleOpen)
            socket.removeEventListener('message', onMessage)
            socket.removeEventListener('error', handleError)
            closeOutcome = {
              closeInfo: extractCloseInfo(event, runtimeCause),
              connection: connectionInfo(),
              cause: runtimeCause,
              opened,
            }
            if (disposeTask) {
              activeAttempt?.abortMessagePumpForDisposal()
            }
            if (typeof runtimeCause !== 'undefined') {
              rawMessages.length = 0
              settleAttempt(closeOutcome)
              return
            }
            if (!messagePumpRunning && rawMessages.length === 0) {
              settleAttempt(closeOutcome)
            }
          }

          activeAttempt = {
            abortMessagePumpForDisposal() {
              if (closeObserved) {
                messageController.abort()
              }
            },
            cancel(keepCurrentSocket = false) {
              settleAttempt(
                {
                  closeInfo: extractCloseInfo(undefined, runtimeCause),
                  connection: connectionInfo(),
                  cause: runtimeCause,
                  opened,
                },
                keepCurrentSocket,
              )
            },
            socket,
          }

          signal.addEventListener('abort', handleAbort, { once: true })
          socket.addEventListener('open', handleOpen)
          socket.addEventListener('message', onMessage)
          socket.addEventListener('close', handleClose)
          socket.addEventListener('error', handleError)
          if (signal.aborted) {
            handleAbort()
          }
        })
      }

      function finish(final: WebSocketCloseInfo, options: FinishOptions = {}): void {
        /* istanbul ignore if -- @preserve defensive once-only gate: terminal callers and reentrant state transitions check finished before invoking finish */
        if (finished) {
          return
        }

        finished = true
        deadline.release()
        stopHeartbeat(sessionController)

        const activeSocket = sessionController.currentSocket
        if (final.kind !== 'closed' && activeSocket && !options.skipNativeClose) {
          requestNativeCloseBestEffort(activeSocket)
        }
        if (activeSocket && options.keepPhysicalCleanup) {
          physicalCleanupDetach = installPhysicalCleanup(activeSocket, sessionController)
        }
        activeAttempt?.cancel(options.keepPhysicalCleanup)

        sendQueue.length = 0
        if (final.kind === 'closed') {
          incomingQueue.close()
          state.error = undefined
        } else {
          const terminalCause = final.cause ?? new DOMException('Aborted', 'AbortError')
          incomingQueue.fail(terminalCause)
          state.error = options.startupError ?? faultFromCloseInfo(final)
          if (final.kind === 'error') {
            emitRuntimeError(state, final.cause)
          }
        }

        state.connection = latestConnection
        setSocketState(state, final.kind === 'closed' ? 'closed' : final.kind)
        state.listeners.runtimeError.clear()
        state.listeners.stateChange.clear()

        if (!controller.signal.aborted) {
          controller.abort(final)
        }

        closedDeferred.resolve(final)
        releaseAbortSignal(signal)
        if (!startupSettled) {
          const startupError = options.startupError ?? faultFromCloseInfo(final)
          state.error = startupError
          rejectSession(startupError)
        }
      }

      function finishFromSignal(snapshot: WebSocketCloseSnapshot = {}): void {
        /* istanbul ignore next -- @preserve invariant: finishFromSignal is called only after the merged signal aborts */
        const transportError = resolveAbortFault(signal) ?? createNetworkFault(ERR_ABORTED)
        if (transportError.code === 'NET_TIMEOUT') {
          finish(toErrorInfo(snapshot, signal.reason), { startupError: transportError })
          return
        }
        finish(toAbortedInfo(snapshot, signal.reason), { startupError: transportError })
      }

      function requestClose(code?: number, reason?: string): void {
        validateWebSocketClose(code, reason)
        if (finished || manualClose) {
          return
        }

        manualClose = { code, kind: 'manual-web-socket-close', reason }
        sessionController.heartbeat?.stop()
        setSocketState(state, 'closing')
        if (finished) {
          return
        }
        const socket = sessionController.currentSocket
        if (!socket) {
          finish(toClosedInfo({}, manualClose))
          return
        }

        try {
          socket.close(code, reason)
        } catch (cause) {
          try {
            socket.close()
          } catch {
            finish({ cause, kind: 'error' }, { keepPhysicalCleanup: true, skipNativeClose: true })
          }
          throw cause
        }
      }

      function disposeSession(): Promise<void> {
        return (disposeTask ??= Promise.resolve().then(disposeOnce))
      }

      async function disposeOnce(): Promise<void> {
        try {
          try {
            session.close()
          } catch (cause) {
            hasCloseError = true
            closeError = cause
          }
          activeAttempt?.abortMessagePumpForDisposal()

          if (!finished) {
            disposeTimer = setTimeout(() => {
              /* istanbul ignore if -- @preserve defensive: lifecycle completion clears this timer before a later timer task can run */
              if (finished) {
                return
              }
              disposeTimeout = new DOMException('WebSocket close event was not observed before teardown timeout', 'TimeoutError')
              finish(toClosedInfo({}, manualClose), { skipNativeClose: true })
            }, SOCKET_CLOSE_GRACE_MS)
          }

          await lifecycleTask
          await Promise.allSettled([...messagePumpTasks])
        } finally {
          clearTimeout(disposeTimer)
          disposeTimer = undefined
          physicalCleanupDetach?.()
        }

        if (hasCloseError) {
          throw closeError
        }
        if (disposeTimeout) {
          throw disposeTimeout
        }
      }
    })
    pendingSessions.add(pendingSession)
    void pendingSession.then(
      (createdSession) => {
        pendingSessions.delete(pendingSession)
        undeliveredSessions.add(createdSession)
      },
      () => {
        pendingSessions.delete(pendingSession)
      },
    )
    return pendingSession
  }

  const wsInterceptors = resolveWebSocketInterceptors(clientConfig.interceptors)
  const wsChain = makeChain(wsInterceptors)

  try {
    const session = await awaitWithSignal(() => wsChain(wsRequest, wsHandler), chainSignal)
    chainSettled = true
    deadline.release()
    releaseAbortSignal(chainSignal)
    let deliveredSession = [...undeliveredSessions].some(
      (createdSession) => createdSession === session || createdSession.closed === session.closed,
    )
    const pendingSessionSnapshot = [...pendingSessions]
    if (!deliveredSession && (undeliveredSessions.size > 0 || pendingSessionSnapshot.length > 0) && !controller.signal.aborted) {
      controller.abort(new Error('WebSocket session was replaced by interceptor'))
    }
    await Promise.allSettled(pendingSessionSnapshot)
    deliveredSession = [...undeliveredSessions].some(
      (createdSession) => createdSession === session || createdSession.closed === session.closed,
    )
    const discardedSessions = [...undeliveredSessions].filter(
      (createdSession) => createdSession !== session && createdSession.closed !== session.closed,
    )
    await Promise.allSettled(discardedSessions.map((discardedSession) => discardedSession.closed))
    pendingSessions.clear()
    undeliveredSessions.clear()
    if (!deliveredSession) {
      startupConnection = undefined
      releaseAbortSignal(signal)
    }
    // Type boundary: interceptor chain returns WebSocketSessionLike; the concrete type matches the endpoint's incoming/outgoing structs.
    const typedSession = session as WebSocketSession<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>
    return [null, typedSession, startupConnection ?? typedSession.connection]
  } catch (error) {
    chainSettled = true
    deadline.release()
    releaseAbortSignal(chainSignal)
    const signalError = resolveAbortFault(chainSignal)
    // The startup catch funnels every failure: a value that is already a fault (a refused
    // connection, a bad URL, a rejected hook) crosses unchanged, and only an unclassified throw
    // is attributed to the extension that produced it.
    const requestError = signalError ?? (isFault(error) ? error : createPreflightFault('EXT_INTERCEPTOR_FAILED', error))
    if (signalError) {
      state.error = signalError
      setSocketState(state, signalError.code === 'NET_ABORTED' ? 'aborted' : 'error')
    }
    const pendingSessionSnapshot = [...pendingSessions]
    if (undeliveredSessions.size > 0 || pendingSessionSnapshot.length > 0) {
      if (!controller.signal.aborted) {
        controller.abort(error)
      }
      await Promise.allSettled(pendingSessionSnapshot)
      await Promise.allSettled([...undeliveredSessions].map((session) => session.closed))
      pendingSessions.clear()
      undeliveredSessions.clear()
    }
    releaseAbortSignal(signal)
    return [requestError as Fault<undefined>, undefined, state.connection]
  }
}

/**
 * Open a WebSocket command against the given client config.
 *
 * Prefer `client.execute(command)` in application code; this is the low-level entry used by the client.
 *
 * @param clientConfig - Resolved client configuration.
 * @param command - WebSocket command from a `WebSocketEndpoint`.
 * @param options - Optional execute options (heartbeat, reconnect, abort).
 * @returns Await-result tuple of `[error, socket, connection]`.
 */
export async function executeWebSocketCommand<
  TInput extends AnyStruct | undefined,
  TIncoming extends AnyStruct,
  TOutgoing extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  command: WebSocketCommand<TInput, TIncoming, TOutgoing>,
  options?: WebSocketExecuteOptions<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>,
): Promise<SocketAwaitResult<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>> {
  const { endpoint, input } = command
  const config = options ?? {}
  const controller = new AbortController()
  const state: SocketRefState = {
    listeners: {
      runtimeError: new Set(),
      stateChange: new Set(),
    },
    status: 'idle',
    transition: 0,
  }
  return runWebSocketCommand(clientConfig, endpoint, input, config, controller, state)
}

/** Outcome of a single WebSocket connect attempt used by reconnect logic. */
export type SocketLifecycleOutcome = {
  closeInfo: WebSocketCloseSnapshot
  connection?: WebSocketConnectionInfo
  cause?: unknown
  opened: boolean
}

type ActiveSocketAttempt = {
  abortMessagePumpForDisposal(): void
  cancel(keepCurrentSocket?: boolean): void
  socket: WebSocketHandle
}

type FinishOptions = {
  keepPhysicalCleanup?: boolean
  skipNativeClose?: boolean
  startupError?: AnyFault
}

const SOCKET_CLOSE_GRACE_MS = 1_000
const noop = () => undefined

function createWebSocketSession<TIncoming, TOutgoing extends AnyStruct | undefined>(
  outgoing: TOutgoing,
  queue: AsyncQueue<TIncoming>,
  closed: Promise<WebSocketCloseInfo>,
  state: SocketRefState,
  sessionController: {
    currentSocket: WebSocketHandle | undefined
    heartbeat: HeartbeatRuntime<TIncoming> | undefined
  },
  sendQueue: string[],
  maxOutgoingQueueSize: number,
  openState: number,
  isUnavailable: () => boolean,
  requestClose: (code?: number, reason?: string) => void,
  disposeSession: () => PromiseLike<void>,
): WebSocketSession<TIncoming, WebSocketOutgoingData<TOutgoing>> {
  return {
    get bufferedAmount() {
      return sessionController.currentSocket?.bufferedAmount ?? 0
    },
    get connection() {
      return (
        state.connection ??
          /* istanbul ignore next -- @preserve invariant: concrete sessions are delivered only after their first open snapshot */
          { generation: 0 }
      )
    },
    closed,
    close(code?: number, reason?: string) {
      requestClose(code, reason)
    },
    [Symbol.asyncDispose]() {
      return disposeSession()
    },
    get state() {
      return state.status
    },
    onRuntimeError(listener) {
      if (isUnavailable()) {
        return noop
      }
      // Type boundary: listener is typed as (error: unknown) => void at the call site; the set stores the same runtime value.
      state.listeners.runtimeError.add(listener as (error: unknown) => void)
      return () => {
        state.listeners.runtimeError.delete(listener as (error: unknown) => void)
      }
    },
    onStateChange(listener) {
      if (isUnavailable()) {
        return noop
      }
      state.listeners.stateChange.add(listener)
      return () => {
        state.listeners.stateChange.delete(listener)
      }
    },
    receive: queue,
    send(message: WebSocketOutgoingData<TOutgoing>) {
      if (isUnavailable()) {
        throw new DOMException('WebSocket session is closed', 'InvalidStateError')
      }
      const socket = sessionController.currentSocket
      const initialState = state.status
      const initialReadyState = socket?.readyState
      const destination =
        initialState === 'open' && initialReadyState === openState ? 'socket' : initialState === 'reconnecting' ? 'queue' : undefined
      if (!destination) {
        throw new DOMException('WebSocket session is not writable', 'InvalidStateError')
      }

      const serialized = serializeOutgoingWebSocketMessage(outgoing, message)
      if (
        isUnavailable() ||
        state.status !== initialState ||
        sessionController.currentSocket !== socket ||
        socket?.readyState !== initialReadyState
      ) {
        throw new DOMException('WebSocket session is not writable', 'InvalidStateError')
      }

      if (destination === 'socket') {
        // Type boundary: destination is "socket" only when the captured socket readyState equals the numeric open state.
        const openSocket = socket as WebSocketHandle
        openSocket.send(serialized)
        return
      }
      if (maxOutgoingQueueSize === 0) {
        throw new Error('WebSocket outgoing queue is disabled')
      }
      if (sendQueue.length >= maxOutgoingQueueSize) {
        throw new Error('WebSocket send queue overflow')
      }
      sendQueue.push(serialized)
    },
  }
}

function flushSendQueue(socket: WebSocketHandle, queue: string[], openState: number): void {
  while (socket.readyState === openState) {
    const next = queue.shift()
    if (typeof next === 'undefined') {
      return
    }

    socket.send(next)
  }
}

function setSocketState(state: SocketRefState, next: WebSocketState): void {
  if (state.status === next) {
    return
  }

  state.status = next
  state.transition += 1
  const transition = state.transition
  for (const listener of [...state.listeners.stateChange]) {
    if (state.transition !== transition) {
      break
    }
    try {
      const result = (listener as (state: WebSocketState) => unknown)(next)
      const runtimeErrorListeners = [...state.listeners.runtimeError]
      consumeObserverResult(result, (error) => emitRuntimeErrorToListeners(runtimeErrorListeners, error))
    } catch (error) {
      emitRuntimeError(state, error)
    }
  }
}

function emitRuntimeError(state: SocketRefState, error: unknown): void {
  emitRuntimeErrorToListeners([...state.listeners.runtimeError], error)
}

function emitRuntimeErrorToListeners(listeners: readonly ((error: unknown) => void)[], error: unknown): void {
  for (const listener of listeners) {
    try {
      const result = (listener as (error: unknown) => unknown)(error)
      consumeObserverResult(result, reportObserverError)
    } catch (observerError) {
      reportObserverError(observerError)
    }
  }
}

function reportObserverError(error: unknown): void {
  const reportError = (globalThis as typeof globalThis & { reportError?: (error: unknown) => void }).reportError
  if (typeof reportError !== 'function') {
    return
  }
  try {
    const result = (reportError as (error: unknown) => unknown)(error)
    consumeObserverResult(result, () => undefined)
  } catch {
    // Reporting observer failures must never re-enter the session lifecycle.
  }
}

function consumeObserverResult(result: unknown, onRejected: (error: unknown) => void): void {
  if ((typeof result !== 'object' || result === null) && typeof result !== 'function') {
    return
  }
  void Promise.resolve(result).catch(onRejected)
}

function validateWebSocketQueueLimits(maxIncomingQueueSize: number, maxOutgoingQueueSize: number | undefined): void {
  if (!Number.isSafeInteger(maxIncomingQueueSize) || maxIncomingQueueSize < 1) {
    throw new TypeError('maxIncomingQueueSize must be a positive safe integer')
  }

  const outgoingSize = maxOutgoingQueueSize ?? 0
  if (!Number.isSafeInteger(outgoingSize) || outgoingSize < 0) {
    throw new TypeError('maxOutgoingQueueSize must be a non-negative safe integer')
  }
}

function validateWebSocketClose(code: number | undefined, reason: string | undefined): void {
  if (typeof code !== 'undefined' && (!Number.isInteger(code) || (code !== 1000 && (code < 3000 || code > 4999)))) {
    throw new DOMException('The close code must be 1000 or between 3000 and 4999', 'InvalidAccessError')
  }
  if (typeof reason !== 'undefined' && new TextEncoder().encode(reason).byteLength > 123) {
    throw new DOMException('The close reason must not exceed 123 UTF-8 bytes', 'SyntaxError')
  }
}

function requestNativeCloseBestEffort(socket: WebSocketHandle): void {
  try {
    socket.close()
  } catch {
    // Logical settlement must not depend on a conforming native close implementation.
  }
}

function installPhysicalCleanup(socket: WebSocketHandle, sessionController: { currentSocket: WebSocketHandle | undefined }): () => void {
  let detached = false
  const cleanup = () => {
    if (detached) {
      return
    }
    detached = true
    socket.removeEventListener('close', cleanup)
    /* istanbul ignore else -- @preserve invariant: no replacement socket is created while physical cleanup is pending */
    if (sessionController.currentSocket === socket) {
      sessionController.currentSocket = undefined
    }
  }
  socket.addEventListener('close', cleanup, { once: true })
  return cleanup
}

function toClosedInfo(snapshot: WebSocketCloseSnapshot, fallback?: ManualSocketCloseReason): WebSocketCloseInfo {
  return {
    code: snapshot.code ?? fallback?.code,
    kind: 'closed',
    reason: snapshot.reason ?? fallback?.reason,
    wasClean: snapshot.wasClean,
  }
}

function toAbortedInfo(snapshot: WebSocketCloseSnapshot, cause: unknown): WebSocketCloseInfo {
  return {
    cause,
    code: snapshot.code,
    kind: 'aborted',
    reason: snapshot.reason,
    wasClean: snapshot.wasClean,
  }
}

function toErrorInfo(snapshot: WebSocketCloseSnapshot, cause: unknown): WebSocketCloseInfo {
  return {
    cause,
    code: snapshot.code,
    kind: 'error',
    reason: snapshot.reason,
    wasClean: snapshot.wasClean,
  }
}

function faultFromCloseInfo(closeInfo: WebSocketCloseInfo): AnyFault {
  if (closeInfo.kind !== 'closed' && isFault(closeInfo.cause)) {
    return closeInfo.cause
  }
  /* istanbul ignore if -- @preserve invariant: internal abort terminal paths always supply startupError directly */
  if (closeInfo.kind === 'aborted') {
    return createNetworkFault(ERR_ABORTED)
  }
  /* istanbul ignore else -- @preserve invariant: pre-open closed paths supply startupError before this helper is reached */
  if (closeInfo.kind === 'error') {
    return createNetworkFault(closeInfo.cause)
  }
  /* istanbul ignore next -- @preserve invariant: pre-open closed paths supply startupError before this helper is reached */
  return createNetworkFault(new Error('WebSocket closed before open'))
}

function isFault(value: unknown): value is AnyFault {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    value instanceof Error
  )
}
