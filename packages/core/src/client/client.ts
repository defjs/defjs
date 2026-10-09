import type { Command, CommandExecutor } from './command'
import { COMMAND_EXECUTE, isEventStreamCommand, isHttpCommand, isWebSocketCommand } from './command'
import type { ClientConfig } from './config'
import { createClientConfig } from './config'
import type { ClientOption } from './option'
import type { HttpCommand, HttpExecuteOptions } from '../http/http'
import type { executeHttpCommand } from '../http/http'
import type { EventStructs, EventStreamCommand, EventStreamData, EventStreamExecuteOptions, StreamAwaitResult } from '../sse/sse'
import type { AnyStruct } from '../struct'
import type {
  SocketAwaitResult,
  WebSocketCommand,
  WebSocketExecuteOptions,
  WebSocketIncomingData,
  WebSocketOutgoingData,
} from '../web_socket/web_socket'

export const CLIENT = Symbol('Client')

/**
 * Defjs client: holds config and `execute`s HTTP, SSE, and WebSocket commands.
 */
export type Client = {
  readonly [CLIENT]: ClientConfig

  /** Open an SSE command and return stream open/await results. */
  execute<TInput extends AnyStruct | undefined, TEvents extends EventStructs, TError extends AnyStruct | undefined = undefined>(
    command: EventStreamCommand<TInput, TEvents, TError>,
    options?: EventStreamExecuteOptions,
  ): Promise<StreamAwaitResult<EventStreamData<TEvents>, TError>>

  /** Open a WebSocket command and return session await results. */
  execute<TInput extends AnyStruct | undefined, TIncoming extends AnyStruct, TOutgoing extends AnyStruct | undefined>(
    command: WebSocketCommand<TInput, TIncoming, TOutgoing>,
    options?: WebSocketExecuteOptions<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>,
  ): Promise<SocketAwaitResult<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>>

  /** Run an HTTP command and return an await-result tuple. */
  execute<TInput extends AnyStruct | undefined, TOutput extends AnyStruct | undefined, TError extends AnyStruct | undefined>(
    command: HttpCommand<TInput, TOutput, TError>,
    options?: HttpExecuteOptions,
  ): ReturnType<typeof executeHttpCommand<TInput, TOutput, TError>>
}

/**
 * Create a Defjs client from option helpers.
 *
 * Options are applied in order. Prefer creating the client inside the
 * request boundary when interceptors close over auth or tenants.
 *
 * @param options - Client option helpers such as `withEndpoint`.
 * @returns A client that can `execute` HTTP, SSE, and WebSocket commands.
 *
 * @example
 * ```ts
 * const client = createClient(withEndpoint('https://api.example.com'))
 * ```
 */
export function createClient(...options: ClientOption[]): Client {
  const conf = createClientConfig()
  for (const option of options) {
    option(conf)
  }

  function execute<TInput extends AnyStruct | undefined, TEvents extends EventStructs, TError extends AnyStruct | undefined = undefined>(
    command: EventStreamCommand<TInput, TEvents, TError>,
    options?: EventStreamExecuteOptions,
  ): Promise<StreamAwaitResult<EventStreamData<TEvents>, TError>>
  function execute<TInput extends AnyStruct | undefined, TIncoming extends AnyStruct, TOutgoing extends AnyStruct | undefined>(
    command: WebSocketCommand<TInput, TIncoming, TOutgoing>,
    options?: WebSocketExecuteOptions<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>,
  ): Promise<SocketAwaitResult<WebSocketIncomingData<TIncoming>, WebSocketOutgoingData<TOutgoing>>>
  function execute<TInput extends AnyStruct | undefined, TOutput extends AnyStruct | undefined, TError extends AnyStruct | undefined>(
    command: HttpCommand<TInput, TOutput, TError>,
    options?: HttpExecuteOptions,
  ): ReturnType<typeof executeHttpCommand<TInput, TOutput, TError>>
  function execute(command: Command, options?: unknown): Promise<unknown> {
    if (isHttpCommand(command) || isEventStreamCommand(command) || isWebSocketCommand(command)) {
      return (command[COMMAND_EXECUTE] as (config: ClientConfig, command: Command, options: unknown) => ReturnType<CommandExecutor>)(
        conf,
        command,
        options,
      )
    }

    return Promise.reject(new Error('Unsupported command'))
  }

  return {
    [CLIENT]: conf,
    execute,
  }
}
