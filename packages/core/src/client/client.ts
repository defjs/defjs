import type { Command, CommandExecutor } from "./command";
import {
  COMMAND_EXECUTE,
  isEventStreamCommand,
  isHttpCommand,
  isWebSocketCommand,
} from "./command";
import type { ClientConfig } from "./config";
import { createClientConfig } from "./config";
import type { ClientOption } from "./option";
import type { HttpCommand, HttpExecuteOptions } from "../http/http";
import type { executeHttpCommand } from "../http/http";
import type {
  EventStructs,
  EventStreamCommand,
  EventStreamData,
  EventStreamExecuteOptions,
  StreamAwaitResult,
} from "../sse/sse";
import type { AnyStruct } from "../struct";
import type {
  SocketAwaitResult,
  WebSocketCommand,
  WebSocketExecuteOptions,
  WebSocketIncomingData,
  WebSocketOutgoingData,
} from "../web_socket/web_socket";

export const CLIENT = Symbol("Client");

/**
 * A client returned by `createClient` holds the resolved {@link ClientConfig} and executes HTTP, SSE, and WebSocket commands.
 *
 * The command type selects the `execute` overload. Failures are returned as faults in the result tuple rather than thrown; the promise rejects only for a value that is not a Defjs command (`Error: Unsupported command`). `[CLIENT]` is an internal symbol key that holds the resolved {@link ClientConfig}; it is not part of the call surface.
 *
 * @group client
 * @see {@link HttpAwaitResult}
 * @see {@link StreamAwaitResult}
 * @see {@link SocketAwaitResult}
 */
export type Client = {
  /** Internal symbol key for the resolved client configuration. */
  readonly [CLIENT]: ClientConfig;

  /** Open an SSE command and return stream open/await results. */
  execute<
    TInput extends AnyStruct | undefined,
    TEvents extends EventStructs,
    TError extends AnyStruct | undefined = undefined,
  >(
    command: EventStreamCommand<TInput, TEvents, TError>,
    options?: EventStreamExecuteOptions,
  ): Promise<StreamAwaitResult<EventStreamData<TEvents>, TError>>;

  /** Open a WebSocket command and return session await results. */
  execute<
    TInput extends AnyStruct | undefined,
    TIncoming extends AnyStruct,
    TOutgoing extends AnyStruct | undefined,
  >(
    command: WebSocketCommand<TInput, TIncoming, TOutgoing>,
    options?: WebSocketExecuteOptions<
      WebSocketIncomingData<TIncoming>,
      WebSocketOutgoingData<TOutgoing>
    >,
  ): Promise<
    SocketAwaitResult<
      WebSocketIncomingData<TIncoming>,
      WebSocketOutgoingData<TOutgoing>
    >
  >;

  /** Run an HTTP command and return an await-result tuple. */
  execute<
    TInput extends AnyStruct | undefined,
    TOutput extends AnyStruct | undefined,
    TError extends AnyStruct | undefined,
  >(
    command: HttpCommand<TInput, TOutput, TError>,
    options?: HttpExecuteOptions,
  ): ReturnType<typeof executeHttpCommand<TInput, TOutput, TError>>;
};

/**
 * Creates a Defjs client from option helpers.
 *
 * Options apply in order: a later option overwrites an earlier one for the same setting, and interceptors accumulate. Prefer creating the client inside the request boundary when interceptors close over auth or tenants. Default HTTP/SSE fetch availability is checked when the interceptor chain invokes transport.
 *
 * @param options - Client option helpers such as `withEndpoint`.
 * @returns A client that can `execute` HTTP, SSE, and WebSocket commands.
 *
 * @group client
 * @see {@link Client}
 * @see {@link ClientOption}
 * @exampleFile examples/api/create-client.ts#example
 */
export function createClient(...options: ClientOption[]): Client {
  const conf = createClientConfig();
  for (const option of options) {
    option(conf);
  }

  function execute<
    TInput extends AnyStruct | undefined,
    TEvents extends EventStructs,
    TError extends AnyStruct | undefined = undefined,
  >(
    command: EventStreamCommand<TInput, TEvents, TError>,
    options?: EventStreamExecuteOptions,
  ): Promise<StreamAwaitResult<EventStreamData<TEvents>, TError>>;
  function execute<
    TInput extends AnyStruct | undefined,
    TIncoming extends AnyStruct,
    TOutgoing extends AnyStruct | undefined,
  >(
    command: WebSocketCommand<TInput, TIncoming, TOutgoing>,
    options?: WebSocketExecuteOptions<
      WebSocketIncomingData<TIncoming>,
      WebSocketOutgoingData<TOutgoing>
    >,
  ): Promise<
    SocketAwaitResult<
      WebSocketIncomingData<TIncoming>,
      WebSocketOutgoingData<TOutgoing>
    >
  >;
  function execute<
    TInput extends AnyStruct | undefined,
    TOutput extends AnyStruct | undefined,
    TError extends AnyStruct | undefined,
  >(
    command: HttpCommand<TInput, TOutput, TError>,
    options?: HttpExecuteOptions,
  ): ReturnType<typeof executeHttpCommand<TInput, TOutput, TError>>;
  function execute(command: Command, options?: unknown): Promise<unknown> {
    if (
      isHttpCommand(command) ||
      isEventStreamCommand(command) ||
      isWebSocketCommand(command)
    ) {
      return (
        command[COMMAND_EXECUTE] as (
          config: ClientConfig,
          command: Command,
          options: unknown,
        ) => ReturnType<CommandExecutor>
      )(conf, command, options);
    }

    return Promise.reject(new Error("Unsupported command"));
  }

  return {
    [CLIENT]: conf,
    execute,
  };
}
