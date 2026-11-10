import type { Client, RequestOptions } from "../client/client";
import { CLIENT } from "../client/client";
import { snapshotProtocols } from "../client/capture";
import type {
  ClientConfig,
  ClientWebSocketOptions,
  WebSocketHandle,
} from "../client/config";

import type { DoneInfo } from "../balancer/balancer";
import { pickEndpoint, type ResolvedEndpoint } from "../balancer/runtime";
import type { AnyFault, Fault, PreflightFault } from "../error";
import {
  createNetworkFault,
  createPreflightFault,
  ERR_ABORTED,
  ERR_TIMEOUT,
} from "../error";
import type { WebSocketSessionLike } from "../interceptor/interceptor";
import {
  makeChain,
  resolveWebSocketInterceptors,
} from "../interceptor/interceptor";
import {
  awaitWithSignal,
  mergeAbortSignals,
  releaseAbortSignal,
  resolveAbortedFault,
  resolveAbortFault,
} from "../internal/abort";
import { AsyncQueue } from "../internal/async_queue";
import type { EndpointArgs } from "../internal/endpoint_command";
import type { EndpointInput } from "../internal/endpoint_input";
import { parseEndpointInput } from "../internal/endpoint_input";
import type { HttpRequest } from "../internal/http_request";
import type {
  BuilderField,
  WebSocketRequestShape,
} from "../internal/builder_types";
import type {
  MaterializedRequest,
  OutboundBuilder,
} from "../internal/outbound_request";
import {
  materializeOutboundRequest,
  runOutboundBuilder,
} from "../internal/outbound_request";
import type { AnyStruct, Infer, StructInput } from "../struct";
import type { Guide } from "../struct/guide";
import { createWebSocketRequest, createWebSocketUrlFromRequest } from "./build";
import {
  decodeWebSocketMessage,
  extractCloseInfo,
  serializeOutgoingWebSocketMessage,
} from "./codec";
import type { WebSocketCloseSnapshot } from "./codec";
import type { HeartbeatRuntime, HeartbeatSession } from "./heartbeat";
import {
  startHeartbeat,
  stopHeartbeat,
  validateHeartbeatConfig,
} from "./heartbeat";
import { computeReconnectDelay, wait } from "../internal/backoff";
import { normalizeReconnectConfig, shouldReconnect } from "./reconnect";

/**
 * Lifecycle state of a managed WebSocket session.
 *
 * | State          | Meaning                                                                |
 * | -------------- | ---------------------------------------------------------------------- |
 * | `idle`         | Before the first connect attempt                                       |
 * | `connecting`   | Preparing and opening the first connection                             |
 * | `open`         | The physical socket is open                                            |
 * | `reconnecting` | Preparing or waiting for a replacement socket after a close            |
 * | `closing`      | Closure was requested with `session.close()` or disposal               |
 * | `closed`       | Terminal: the session ended without an error or cancellation           |
 * | `aborted`      | Terminal: the session was cancelled through `signal`                   |
 * | `error`        | Terminal: the session failed, including a startup failure or `timeout` |
 *
 * Observe it with `session.state` and `session.onStateChange`.
 *
 * @group web-socket
 */
export type WebSocketState =
  | "aborted"
  | "closed"
  | "closing"
  | "connecting"
  | "error"
  | "idle"
  | "open"
  | "reconnecting";

/**
 * Decoded type of a received WebSocket message.
 *
 * The type of each message yielded by `session.receive`: the {@link Infer} output of the endpoint's `incoming` struct. Aliased fields use their logical names.
 *
 * @group web-socket
 */
export type WebSocketIncomingData<TIncoming extends AnyStruct> =
  Infer<TIncoming>;

/**
 * Type accepted by WebSocket session send.
 *
 * The type `session.send` accepts: the {@link StructInput} of the endpoint's `outgoing` struct, or `never` when the endpoint declares none, so `send` cannot be called with a value.
 *
 * @group web-socket
 */
export type WebSocketOutgoingData<TOutgoing extends AnyStruct | undefined> =
  TOutgoing extends AnyStruct ? StructInput<TOutgoing> : never;

interface WebSocketDefinitionBase<
  TIncoming extends AnyStruct = AnyStruct,
  TOutgoing extends AnyStruct | undefined = undefined,
> {
  incoming: TIncoming;
  maxIncomingQueueSize: number;
  maxOutgoingQueueSize?: number;
  operation?: string;
  outgoing?: TOutgoing;
  path: string;
  protocols?: readonly string[];
}

/**
 * Contract object passed to defineWebSocket.
 *
 * - `incoming` is the struct every received frame is parsed with. Frames are JSON text.
 *
 * - `outgoing` is the struct `session.send` validates and encodes with. Without it, `send` throws.
 *
 * - `maxIncomingQueueSize` bounds both raw frames waiting to decode and decoded messages waiting for the consumer. Overflow is judged after the current task finishes, so frames a platform delivers in one read do not count while the consumer keeps draining; the transient excess is bounded by what arrives before that check runs. Overflow is fatal with `CAP_QUEUE_OVERFLOW` on the error delivered through `receive`, `onRuntimeError`, and `closed.cause`. It is required and must be a positive safe integer. `maxOutgoingQueueSize` must be a non-negative safe integer; it defaults to `0`, which disables queueing of messages sent while the session is `reconnecting`.
 *
 * - `protocols` is the static default subprotocol list. `RequestOptions.protocols` and {@link withWebSocketProtocols} override it.
 *
 * - `operation` is a static, low-cardinality name for telemetry.
 *
 * - `input` is the struct for the operation input. A declared `input` always requires an explicit `builder`. `input` only defines the parameters; the builder alone decides where each value goes. Only definitions without `input` may omit `builder`. The builder may return `path` and `query` only; see {@link WebSocketRequestShape}.
 *
 * Invalid queue limits are reported when the operation runs, as a `REQ_OPTIONS_INVALID` fault.
 *
 * @group web-socket
 */
export type WebSocketDefinition<
  TInput extends AnyStruct | undefined = undefined,
  TIncoming extends AnyStruct = AnyStruct,
  TOutgoing extends AnyStruct | undefined = undefined,
> = WebSocketDefinitionBase<TIncoming, TOutgoing> & {
  builder?: OutboundBuilder;
  input?: TInput;
};

export type { WebSocketRequestShape } from "../internal/builder_types";

/**
 * Connection metadata for the current WebSocket generation.
 *
 * - `url` is the URL the socket reports.
 *
 * - `protocol` is the negotiated subprotocol and `extensions` the negotiated extensions. Both are `undefined` when the socket reports an empty string.
 *
 * - `generation` counts the physical sockets that reached `open`: `1` after the first open, one more after each reconnect. A snapshot taken before any open has `0`.
 *
 * `session.connection` exposes the session's current public connection info. The `connection` in the operation result preserves the first successful snapshot only for a native Defjs session or a wrapper forwarding the same live `connection` object. Custom sessions and wrappers that transform `connection` instead return their current public `connection`. Sharing `closed` cannot bypass URL sanitization or metadata filtering, and Defjs does not reconstruct first-connection metadata from arbitrary transformations.
 *
 * @group web-socket
 */
export interface WebSocketConnectionInfo {
  extensions?: string;
  generation: number;
  protocol?: string;
  url?: string;
}

/**
 * Logical terminal outcome of a WebSocket session.
 *
 * What `session.closed` resolves with, once the session has ended for good.
 *
 * - `closed`: the session ended normally, including a manual `session.close()`.
 *
 * - `aborted`: the session was cancelled; `cause` is the abort reason.
 *
 * - `error`: the session failed; `cause` is required. Incoming raw-frame or decoded-message queue overflow supplies a `Fault` with `cause.code === "CAP_QUEUE_OVERFLOW"`. The same fault rejects `receive` and is passed to `onRuntimeError`. Other runtime causes need not carry a Defjs fault code; heartbeat timeout and exhausted reconnects can retain plain errors.
 *
 * - `code`, `reason`, and `wasClean` come from the native close event when one was observed. A manual `session.close(code, reason)` fills `code` and `reason` when the close event does not.
 *
 * @group web-socket
 */
export type WebSocketCloseInfo =
  | { kind: "closed"; code?: number; reason?: string; wasClean?: boolean }
  | {
      kind: "aborted";
      cause?: unknown;
      code?: number;
      reason?: string;
      wasClean?: boolean;
    }
  | {
      kind: "error";
      cause: unknown;
      code?: number;
      reason?: string;
      wasClean?: boolean;
    };

/**
 * Typed WebSocket session: send and receive messages, observe state, and close.
 *
 * - `state` is the logical {@link WebSocketState}; `connection` is the latest {@link WebSocketConnectionInfo}. `bufferedAmount` is the native unsent byte count, or `0` with no physical socket.
 *
 * - `receive` yields incoming messages already parsed with the `incoming` struct. It is one-consumer: asking for a second iterator throws a `TypeError`. A frame that cannot be parsed is reported to `onRuntimeError` listeners and skipped.
 *
 * - `send(message)` validates and encodes the message with the `outgoing` struct, then sends JSON text. It sends immediately while `open`, queues while `reconnecting` when `maxOutgoingQueueSize` allows, and throws a `DOMException` named `InvalidStateError` when the session is not writable. It also throws when no `outgoing` struct is declared, the message fails the struct, or the queue is disabled or full.
 *
 * - After encoding, a value JSON cannot faithfully represent throws `TypeError` before sending or entering the queue. This includes non-finite numbers, functions, symbols, `Map`, `Set`, streams, and class instances without a JSON representation, at the root or nested. The same guard protects heartbeat messages; a heartbeat serialization failure ends the session. Struct validation may reject a value first.
 *
 * - `close(code?, reason?)` requests closure and stops the heartbeat. `code` must be `1000` or in `3000..4999`, and `reason` at most 123 UTF-8 bytes; invalid arguments throw before the state changes.
 *
 * - `closed` resolves with the logical terminal {@link WebSocketCloseInfo}.
 *
 * - `onStateChange` and `onRuntimeError` return an unsubscribe function.
 *
 * Prefer `await using ownedSession = session` for owned scope cleanup. Manual `session.close()` and `await session.closed` remain available.
 *
 * ```ts
 * async function consume(
 *   session: WebSocketSession<unknown, never>,
 * ): Promise<void> {
 *   await using ownedSession = session;
 *   for await (const message of ownedSession.receive) console.log(message);
 * }
 * ```
 *
 * The async disposer requests native close and waits for Defjs-owned teardown, but it bounds a missing close event at one second and may reject with a `DOMException` named `TimeoutError`. It cannot prove that the physical TCP connection closed.
 *
 * @group web-socket
 */
export interface WebSocketSession<
  TIncoming = unknown,
  TOutgoing = never,
> extends AsyncDisposable {
  readonly bufferedAmount: number;
  readonly connection: WebSocketConnectionInfo;
  readonly closed: Promise<WebSocketCloseInfo>;
  readonly receive: AsyncIterable<TIncoming>;
  readonly state: WebSocketState;
  close(code?: number, reason?: string): void;
  [Symbol.asyncDispose](): PromiseLike<void>;
  onRuntimeError(listener: (error: unknown) => void): () => void;
  onStateChange(listener: (state: WebSocketState) => void): () => void;
  send(message: TOutgoing): void;
}

/**
 * Await-result tuple from opening a WebSocket.
 *
 * - On success: `[null, session, connection]`. `session.connection` moves forward on reconnect. The tuple's `connection` preserves the first successful snapshot only for a native Defjs session or a wrapper forwarding the same live `connection` object. Custom sessions and wrappers that transform `connection` instead return their current public `connection`. Sharing `closed` cannot bypass URL sanitization or metadata filtering, and Defjs does not reconstruct first-connection metadata from arbitrary transformations.
 *
 * - On failure: `[fault, undefined, connection]`. `connection` may be `undefined`, for example when the constructor failed before the socket opened.
 *
 * - Only startup failures arrive here. Once the session is returned, later errors surface through `onRuntimeError`, `receive`, and `closed`.
 *
 * @group web-socket
 */
export type SocketAwaitResult<TIncoming, TOutgoing = never> =
  | [
      error: null,
      socket: WebSocketSession<TIncoming, TOutgoing>,
      connection: WebSocketConnectionInfo,
    ]
  | [
      error: Fault<undefined>,
      socket: undefined,
      connection: WebSocketConnectionInfo | undefined,
    ];

interface UseWebSocketBaseConfig<TIncoming = unknown, TOutgoing = unknown> {
  beforeConnect?: ClientWebSocketOptions["beforeConnect"];
  heartbeat?: WebSocketHeartbeatConfig<TIncoming, TOutgoing>;
  protocols?: readonly string[];
  reconnect?: ClientWebSocketOptions["reconnect"];
}

/**
 * WebSocket fields of {@link RequestOptions}, plus `signal`.
 *
 * `beforeConnect`, `heartbeat`, `protocols`, and `reconnect` override the client-level options for one call. `signal` covers the whole session, including after it opens. There is no startup-only deadline and no `abort` field.
 *
 * @group web-socket
 */
export type UseWebSocketConfig<
  TIncoming = unknown,
  TOutgoing = unknown,
> = UseWebSocketBaseConfig<TIncoming, TOutgoing> & {
  /** Aborts the session, including after it is open. */
  signal?: AbortSignal;
};

/**
 * WebSocket fields read from {@link RequestOptions} for one call.
 *
 * See {@link UseWebSocketConfig}. `heartbeat` callbacks are not inferred from the operation; narrow `unknown` messages yourself.
 *
 * @group web-socket
 * @see {@link WebSocketHeartbeatConfig}
 */
export type WebSocketExecuteOptions<
  TIncoming = unknown,
  TOutgoing = unknown,
> = UseWebSocketConfig<TIncoming, TOutgoing>;

/**
 * Operation returned by `defineWebSocket`.
 *
 * The first argument is a {@link Client}. Further arguments are the input only. Calling it opens the session and returns the existing error-first tuple.
 *
 * @group web-socket
 */
export type WebSocketEndpoint<
  Args extends unknown[],
  Incoming,
  Outgoing = never,
> = (
  client: Client,
  ...args: Args
) => Promise<SocketAwaitResult<Incoming, Outgoing>>;

type SocketRefState = {
  connection?: WebSocketConnectionInfo;
  error?: AnyFault;
  listeners: {
    runtimeError: Set<(error: unknown) => void>;
    stateChange: Set<(state: WebSocketState) => void>;
  };
  status: WebSocketState;
  transition: number;
};

/**
 * Close code and reason recorded when a session is closed with session.close.
 *
 * Records the `code` and `reason` passed to `session.close(code?, reason?)`. They fill `code` and `reason` of the final `{ kind: 'closed' }` close info when the peer's close event carries none. `close` throws a `DOMException` when a provided `code` is not the integer `1000` or an integer from `3000` through `4999`, and when `reason` exceeds 123 UTF-8 bytes. Omitting `code` is allowed.
 *
 * @group web-socket
 */
export type ManualSocketCloseReason = {
  code?: number;
  kind: "manual-web-socket-close";
  reason?: string;
};

/**
 * Heartbeat ping and acknowledgement settings for a live WebSocket session.
 *
 * - `intervalMs` is the delay between heartbeat messages.
 *
 * - `message()` builds the payload. It is sent through the `outgoing` struct. Nothing is sent when it is omitted or returns `undefined`.
 *
 * - After struct encoding, non-JSON values fail with `TypeError` through the same serializer as `session.send`; that heartbeat failure ends the logical session without reconnecting.
 *
 * - `isAck(message)` receives each decoded incoming message. When it returns `true`, the message is treated as the acknowledgement and is not delivered to `receive`.
 *
 * - `timeoutMs` is how long to wait for an acknowledgement after a heartbeat. Missing it fails the session and reports `NET_UNREACHABLE` for the endpoint to the balancer. A throwing `message()` or a serialization failure also fails the session, but is not attributed to the endpoint.
 *
 * - `intervalMs` and `timeoutMs` must be positive, finite, and at most `2_147_483_647`.
 *
 * Set it with {@link withWebSocketHeartbeat} or the `heartbeat` request option.
 *
 * @group web-socket
 */
export interface WebSocketHeartbeatConfig<
  TIncoming = unknown,
  TOutgoing = unknown,
> {
  intervalMs: number;
  isAck?: (message: TIncoming) => boolean;
  message?: () => TOutgoing;
  timeoutMs?: number;
}

/**
 * Declare a typed WebSocket endpoint.
 *
 * Pass path, incoming (and optional outgoing) message structs, and queue limits.
 * Call the returned operation with a client and, when declared, the input.
 *
 * - **definition** — `path`, one `incoming` struct, and the required `maxIncomingQueueSize` (a positive safe integer). Optional `outgoing` and `input` structs, static `protocols`, `maxOutgoingQueueSize` (a non-negative safe integer), and `operation`. A declared `input` always requires an explicit `builder`. `input` only defines the parameters; the builder alone decides where each value goes. Only definitions without `input` may omit `builder`.
 *
 * A WebSocket `builder` may return `path` and `query` only; `headers` and `body` are rejected. `WebSocketDefinitionBase` and `BuilderField` are internal helper types.
 *
 * Known fields are copied when the definition is created. Structs and `builder` keep their identity. A `protocols` array is copied, so a later edit of the original array does not retarget the endpoint. A getter on a fixed field runs during `defineWebSocket`.
 *
 * @param definition - WebSocket contract (path, structs, queue limits, optional input).
 * @returns An operation `(client, ...input) => Promise<error-first tuple>`.
 *
 * @group web-socket
 * @exampleFile examples/api/define-web-socket.ts#example
 */
export function defineWebSocket<
  const P extends string,
  TInput extends AnyStruct | undefined = undefined,
  TIncoming extends AnyStruct = AnyStruct,
  TOutgoing extends AnyStruct | undefined = undefined,
>(
  definition: Omit<WebSocketDefinitionBase<TIncoming, TOutgoing>, "path"> & {
    input?: TInput;
    path: P;
  } & BuilderField<NoInfer<TInput>, WebSocketRequestShape<NoInfer<P>>>,
): WebSocketEndpoint<
  EndpointArgs<TInput>,
  WebSocketIncomingData<TIncoming>,
  WebSocketOutgoingData<TOutgoing>
> {
  // Copy known definition fields. Structs stay shared; the protocols array does not.
  const builder = definition.builder;
  const incoming = definition.incoming;
  const input = definition.input;
  const maxIncomingQueueSize = definition.maxIncomingQueueSize;
  const maxOutgoingQueueSize = definition.maxOutgoingQueueSize;
  const operation = definition.operation;
  const outgoing = definition.outgoing;
  const path = definition.path;
  const protocols = snapshotProtocols(definition.protocols);
  const endpoint = {
    builder,
    incoming,
    input,
    maxIncomingQueueSize,
    maxOutgoingQueueSize,
    operation,
    outgoing,
    path,
    protocols,
  };

  return async (client: Client, input?: EndpointInput<TInput>) => {
    const requestOptions = client[CLIENT].options;
    const controller = new AbortController();
    const socketState: SocketRefState = {
      listeners: {
        runtimeError: new Set(),
        stateChange: new Set(),
      },
      status: "idle",
      transition: 0,
    };
    return runWebSocketCommand(
      client[CLIENT].config,
      endpoint,
      input,
      requestOptions,
      controller,
      socketState,
    );
  };
}

type StageOutcome<T> =
  [fault: PreflightFault, value: undefined] | [fault: undefined, value: T];

type ResolvedCallOptions = {
  beforeConnect: ClientWebSocketOptions["beforeConnect"];
  heartbeat: ClientWebSocketOptions["heartbeat"];
  protocols: readonly string[] | undefined;
  reconnect: ReturnType<typeof normalizeReconnectConfig>;
};

function readQueueLimits(
  maxIncomingQueueSize: number,
  maxOutgoingQueueSize: number | undefined,
): StageOutcome<true> {
  try {
    validateWebSocketQueueLimits(maxIncomingQueueSize, maxOutgoingQueueSize);
    return [undefined, true];
  } catch (error) {
    return [createPreflightFault("REQ_OPTIONS_INVALID", error), undefined];
  }
}

function readCallOptions(
  config: RequestOptions | undefined,
  webSocket: ClientWebSocketOptions,
): StageOutcome<ResolvedCallOptions> {
  try {
    const beforeConnect = config?.beforeConnect;
    const configuredProtocols = config?.protocols;
    const protocols = configuredProtocols
      ? [...configuredProtocols]
      : undefined;
    const reconnectOption = config?.reconnect ?? webSocket.reconnect;
    const heartbeatOption = config?.heartbeat ?? webSocket.heartbeat;
    const heartbeat = heartbeatOption
      ? {
          intervalMs: heartbeatOption.intervalMs,
          isAck: heartbeatOption.isAck,
          message: heartbeatOption.message,
          timeoutMs: heartbeatOption.timeoutMs,
        }
      : undefined;
    validateHeartbeatConfig(heartbeat);
    const reconnect = normalizeReconnectConfig(reconnectOption);
    return [undefined, { beforeConnect, heartbeat, protocols, reconnect }];
  } catch (error) {
    return [createPreflightFault("REQ_OPTIONS_INVALID", error), undefined];
  }
}

function parseInput<TInput extends AnyStruct | undefined>(
  inputStruct: TInput | undefined,
  input: EndpointInput<TInput> | undefined,
  guides: WeakMap<object, Guide>,
  signal: AbortSignal,
): StageOutcome<unknown> {
  try {
    return [
      undefined,
      inputStruct ? parseEndpointInput(inputStruct, input, guides) : input,
    ];
  } catch (error) {
    return [
      resolveAbortFault(signal) ??
        createPreflightFault("REQ_INPUT_INVALID", error),
      undefined,
    ];
  }
}

function buildOutbound(
  parsedInput: unknown,
  builder: OutboundBuilder | undefined,
  inputDeclared: boolean,
  guides: WeakMap<object, Guide>,
  signal: AbortSignal,
): StageOutcome<MaterializedRequest> {
  try {
    return [
      undefined,
      materializeOutboundRequest(
        runOutboundBuilder(parsedInput, builder, inputDeclared),
        "webSocket",
        guides,
      ),
    ];
  } catch (error) {
    return [
      resolveAbortFault(signal) ??
        createPreflightFault("REQ_BUILD_FAILED", error),
      undefined,
    ];
  }
}

function createSocketRequest(
  args: Parameters<typeof createWebSocketRequest>[0],
): StageOutcome<HttpRequest> {
  try {
    return [undefined, createWebSocketRequest(args)];
  } catch (error) {
    return [
      resolveAbortFault(args.signal) ??
        createPreflightFault("REQ_BUILD_FAILED", error),
      undefined,
    ];
  }
}

function resolveSocketConstructor(
  handle: ClientWebSocketOptions["handle"],
): StageOutcome<
  NonNullable<ClientWebSocketOptions["handle"] | typeof WebSocket>
> {
  const candidate = handle ?? globalThis.WebSocket;
  if (typeof candidate !== "function") {
    return [
      createPreflightFault(
        "ENV_UNSUPPORTED",
        new Error("WebSocket is not supported in current runtime"),
      ),
      undefined,
    ];
  }
  return [undefined, candidate];
}

async function runWebSocketCommand<
  TInput extends AnyStruct | undefined,
  TIncoming extends AnyStruct,
  TOutgoing extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  endpoint: WebSocketDefinition<TInput, TIncoming, TOutgoing>,
  input: EndpointInput<TInput> | undefined,
  config: RequestOptions | undefined,
  controller: AbortController,
  state: SocketRefState,
): Promise<
  SocketAwaitResult<
    WebSocketIncomingData<TIncoming>,
    WebSocketOutgoingData<TOutgoing>
  >
> {
  setSocketState(state, "connecting");

  const callerAbort = config?.signal;

  // Same fast path as HTTP/SSE: an already aborted call does not parse, build, or validate the socket.
  if (callerAbort?.aborted) {
    const aborted = resolveAbortedFault(callerAbort);
    state.error = aborted;
    setSocketState(state, aborted.code === "NET_ABORTED" ? "aborted" : "error");
    return [aborted, undefined, undefined];
  }

  // Queue limits and call options run before the abort signals exist.
  const stopInvalidOptions = (
    fault: PreflightFault,
  ): SocketAwaitResult<
    WebSocketIncomingData<TIncoming>,
    WebSocketOutgoingData<TOutgoing>
  > => {
    state.error = fault;
    setSocketState(state, "error");
    return [fault, undefined, undefined];
  };

  const [queueFault] = readQueueLimits(
    endpoint.maxIncomingQueueSize,
    endpoint.maxOutgoingQueueSize,
  );
  if (queueFault) {
    return stopInvalidOptions(queueFault);
  }

  const [optionsFault, callOptions] = readCallOptions(
    config,
    clientConfig.webSocket,
  );
  if (optionsFault) {
    return stopInvalidOptions(optionsFault);
  }
  const beforeConnectOption = callOptions.beforeConnect;
  const protocolsOption = callOptions.protocols;
  const reconnect = callOptions.reconnect;
  const heartbeatConfig = callOptions.heartbeat;

  // `signal` stays in force after open and across reconnects.
  const chainController = new AbortController();
  const chainSignal = mergeAbortSignals(chainController.signal, [callerAbort]);
  const signal = mergeAbortSignals(controller.signal, [chainSignal]);
  const stopBeforeTransport = (
    fault: PreflightFault,
  ): SocketAwaitResult<
    WebSocketIncomingData<TIncoming>,
    WebSocketOutgoingData<TOutgoing>
  > => {
    releaseAbortSignal(chainSignal);
    releaseAbortSignal(signal);
    state.error = fault;
    setSocketState(state, fault.code === "NET_ABORTED" ? "aborted" : "error");
    return [fault, undefined, undefined];
  };

  const inputGuides = new WeakMap<object, Guide>();
  const [inputFault, parsedInput] = parseInput(
    endpoint.input,
    input,
    inputGuides,
    signal,
  );
  if (inputFault) {
    return stopBeforeTransport(inputFault);
  }

  const parsedCancellation = resolveAbortFault(signal);
  if (parsedCancellation) {
    return stopBeforeTransport(parsedCancellation);
  }

  const [pickFault, initialPick] = pickEndpoint(clientConfig.balancer, {
    endpoints: clientConfig.endpoints,

    operation: endpoint.operation,
  });
  if (pickFault) {
    return stopBeforeTransport(pickFault);
  }

  let handedToHandler = false;
  try {
    const [buildFault, built] = buildOutbound(
      parsedInput,
      endpoint.builder,
      endpoint.input !== undefined,
      inputGuides,
      signal,
    );
    if (buildFault) {
      return stopBeforeTransport(buildFault);
    }

    const builtCancellation = resolveAbortFault(signal);
    if (builtCancellation) {
      return stopBeforeTransport(builtCancellation);
    }

    const [requestFault, wsRequest] = createSocketRequest({
      signal,
      baseEndpoint: initialPick.endpoint,
      operation: endpoint.operation,
      params: built.params,
      path: endpoint.path,
      query: built.query,
      querySerializer: clientConfig.querySerializer,
      withCredentials: clientConfig.withCredentials,
    });
    if (requestFault) {
      return stopBeforeTransport(requestFault);
    }

    const constructorStage = resolveSocketConstructor(
      clientConfig.webSocket.handle,
    );
    if (constructorStage[0]) {
      return stopBeforeTransport(constructorStage[0]);
    }
    const WebSocketCtor = constructorStage[1];
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the published WebSocketHandleConstructor is `{ readonly OPEN: number } & (new (...args: never[]) => WebSocketHandle)`, so its construct parameters are erased and `new` cannot pass the URL unasserted (TS2345, `string` is not assignable to `never`); giving it real parameters changes that published declaration
    const WebSocketImpl = WebSocketCtor as unknown as new (
      url: string | URL,
      protocols?: string | string[],
    ) => WebSocketHandle;

    let startupConnection: WebSocketConnectionInfo | undefined;
    const undeliveredSessions = new Set<WebSocketSessionLike>();
    const pendingSessions = new Set<Promise<WebSocketSessionLike>>();
    let wsHandlerInvoked = false;
    let chainSettled = false;
    const wsHandler = (req: HttpRequest): Promise<WebSocketSessionLike> => {
      if (chainSettled || wsHandlerInvoked) {
        const rejection = Promise.reject(
          new Error(
            chainSettled
              ? "WebSocket interceptor next() may not be called after the chain settles"
              : "WebSocket interceptor next() may only be called once",
          ),
        );
        void rejection.catch(() => undefined);
        return rejection;
      }
      wsHandlerInvoked = true;
      handedToHandler = true;
      let attributable = req.baseEndpoint === initialPick.endpoint;
      let attemptReported = false;
      let attemptEndpoint: ResolvedEndpoint = initialPick;
      if (!attributable) {
        initialPick.done({ attempted: false });
      }
      // Captured before the executor shadows `signal`. Both the caller and an interceptor replacement stay live.
      const executionSignal = signal;
      const pendingSession = new Promise<WebSocketSessionLike>(
        (resolveSession, rejectSession) => {
          let signal: AbortSignal;
          try {
            signal = mergeAbortSignals(executionSignal, [req.signal]);
          } catch (error) {
            initialPick.done({ attempted: false });
            throw error;
          }
          const incomingQueue = new AsyncQueue<
            WebSocketIncomingData<TIncoming>
          >();
          const closedDeferred = Promise.withResolvers<WebSocketCloseInfo>();
          const sessionController: HeartbeatSession<
            WebSocketIncomingData<TIncoming>
          > = {
            currentSocket: undefined,
            heartbeat: undefined,
          };
          const sendQueue: string[] = [];
          let startupSettled = false;
          let finished = false;
          let latestConnection: WebSocketConnectionInfo | undefined;
          let attempt = 0;
          let generation = 0;
          let activeAttempt: ActiveSocketAttempt | undefined;
          let manualClose: ManualSocketCloseReason | undefined;
          const messagePumpTasks = new Set<Promise<void>>();
          let disposeTask: Promise<void> | undefined;
          let disposeTimer: ReturnType<typeof setTimeout> | undefined;
          let disposeTimeout: DOMException | undefined;
          let hasCloseError = false;
          let closeError: unknown;
          let physicalCleanupDetach: (() => void) | undefined;

          const hasReconnectPredicate = reconnect?.hasShouldReconnect ?? false;
          const beforeConnect =
            beforeConnectOption ?? clientConfig.webSocket.beforeConnect;
          const baseProtocols = [
            ...(protocolsOption ??
              clientConfig.webSocket.protocols ??
              endpoint.protocols ??
              []),
          ];
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
          );

          function report(info: DoneInfo): void {
            if (!attributable || attemptReported) {
              return;
            }
            attemptReported = true;
            attemptEndpoint.end(info);
            attemptEndpoint.done(info);
          }

          function classifyAttempt(
            opened: boolean,
            cause: unknown,
            connectTimedOut: boolean,
            closeInfo: WebSocketCloseSnapshot,
          ): DoneInfo {
            if (manualClose) {
              return { attempted: false };
            }
            const aborted = resolveAbortFault(signal);
            if (aborted?.code === "NET_TIMEOUT") {
              return { attempted: true, code: "NET_TIMEOUT" };
            }
            if (aborted) {
              return { attempted: false };
            }
            if (connectTimedOut) {
              return { attempted: true, code: "NET_UNREACHABLE" };
            }
            // 1006 and 1015 mean no close frame arrived. Any other code came in the peer's close frame,
            // so the handshake completed even without an open event: Firefox can skip `open` when the
            // server closes right after accepting.
            const closeFrame =
              closeInfo.code !== undefined &&
              closeInfo.code !== 1006 &&
              closeInfo.code !== 1015;
            if (cause === undefined && (opened || closeFrame)) {
              // The close code describes the peer. `wasClean` also reflects TCP teardown, which engines
              // report differently: Firefox reports false for a server-initiated close frame.
              if (closeInfo.code === 1006 || closeInfo.code === 1015) {
                return { attempted: true, code: "NET_UNREACHABLE" };
              }
              // 1012 Service Restart and 1013 Try Again Later are the WebSocket form of HTTP 503.
              return closeInfo.code === 1012 || closeInfo.code === 1013
                ? { attempted: true, code: "NET_UNAVAILABLE" }
                : { attempted: true };
            }
            return doneInfoForNetworkCause(
              cause ?? new Error("WebSocket closed before open"),
            );
          }

          /* istanbul ignore next -- @preserve defensive: run() settles every attempt, hook and delay inside its own failure boundaries */
          const lifecycleTask = run().catch((cause) => {
            finish({ cause, kind: "error" });
          });

          async function run(): Promise<void> {
            while (!finished) {
              if (signal.aborted) {
                finishFromSignal();
                return;
              }

              const nextState = attempt === 0 ? "connecting" : "reconnecting";
              setSocketState(state, nextState);

              const prepared = await prepareAttempt();
              if (finished) {
                return;
              }
              if (!prepared.ok) {
                if (prepared.aborted) {
                  finishFromSignal();
                } else {
                  finish(
                    { cause: prepared.error, kind: "error" },
                    { startupError: prepared.error },
                  );
                }
                return;
              }
              if (signal.aborted) {
                finishFromSignal();
                return;
              }

              const outcome = await connectOnce(
                prepared.url,
                prepared.protocols,
              );
              // connectFailure returns before settleAttempt: the constructor threw, or binaryType did.
              if (outcome.connection === undefined) {
                report(doneInfoForNetworkCause(outcome.cause));
              }
              if (finished) {
                return;
              }

              if (!startupSettled && outcome.connection) {
                latestConnection = outcome.connection;
                state.connection = latestConnection;
              }

              if (signal.aborted) {
                finishFromSignal(outcome.closeInfo);
                return;
              }

              if (manualClose) {
                finish(toClosedInfo(outcome.closeInfo, manualClose));
                return;
              }

              const nextAttempt = attempt + 1;
              let reconnectRequested = false;
              let reconnectPredicateDeclined = false;
              if (reconnect && nextAttempt <= reconnect.attempts) {
                try {
                  reconnectRequested = shouldReconnect(
                    reconnect,
                    outcome,
                    nextAttempt,
                  );
                  reconnectPredicateDeclined =
                    hasReconnectPredicate && !reconnectRequested;
                } catch (cause) {
                  if (finished) {
                    return;
                  }
                  if (signal.aborted) {
                    finishFromSignal(outcome.closeInfo);
                  } else {
                    finish(toErrorInfo(outcome.closeInfo, cause));
                  }
                  return;
                }
              }
              if (finished) {
                return;
              }
              if (signal.aborted) {
                finishFromSignal(outcome.closeInfo);
                return;
              }

              if (reconnectRequested && reconnect) {
                attempt = nextAttempt;
                setSocketState(state, "reconnecting");
                if (finished) {
                  return;
                }
                if (signal.aborted) {
                  finishFromSignal(outcome.closeInfo);
                  return;
                }
                const delayMs = computeReconnectDelay(reconnect, nextAttempt);
                if (delayMs > 0) {
                  try {
                    await wait(delayMs, signal);
                  } catch {
                    if (!finished) {
                      finishFromSignal(outcome.closeInfo);
                    }
                    return;
                  }
                }
                continue;
              }

              if (!startupSettled) {
                const cause =
                  outcome.cause ?? new Error("WebSocket closed before open");
                const startupError = createNetworkFault(cause);
                finish(toErrorInfo(outcome.closeInfo, cause), { startupError });
                return;
              }

              if (reconnectPredicateDeclined) {
                finish(toClosedInfo(outcome.closeInfo));
                return;
              }

              if (typeof outcome.cause === "undefined") {
                finish(toClosedInfo(outcome.closeInfo));
              } else {
                finish(toErrorInfo(outcome.closeInfo, outcome.cause));
              }
              return;
            }
          }

          async function prepareAttempt(): Promise<
            | { aborted: false; error: AnyFault; ok: false }
            | { aborted: true; ok: false }
            | { ok: true; protocols: readonly string[]; url: string }
          > {
            let urlRequest = req;
            if (attributable && attempt > 0) {
              const [fault, picked] = pickEndpoint(clientConfig.balancer, {
                endpoints: clientConfig.endpoints,

                operation: endpoint.operation,
              });
              if (fault) {
                attributable = false;
                return { aborted: false, error: fault, ok: false };
              }
              attemptEndpoint = picked;
              attemptReported = false;
              urlRequest = { ...req, baseEndpoint: picked.endpoint };
            }

            let url: string;
            try {
              url = createWebSocketUrlFromRequest(urlRequest);
            } catch (error) {
              return {
                aborted: false,
                error: createPreflightFault("REQ_BUILD_FAILED", error),
                ok: false,
              };
            }

            if (beforeConnect) {
              try {
                await awaitWithSignal(
                  () => beforeConnect({ attempt, signal }),
                  signal,
                );
                signal.throwIfAborted();
              } catch (error) {
                if (signal.aborted) {
                  return { aborted: true, ok: false };
                }
                return {
                  aborted: false,
                  error: createPreflightFault("EXT_HOOK_FAILED", error),
                  ok: false,
                };
              }
            }

            return {
              ok: true,
              protocols: baseProtocols,
              url,
            };
          }

          async function connectOnce(
            url: string,
            protocols: readonly string[],
          ): Promise<SocketLifecycleOutcome> {
            let socket: WebSocketHandle;
            try {
              if (attributable) attemptEndpoint.start();
              socket =
                protocols.length > 0
                  ? new WebSocketImpl(url, [...protocols])
                  : new WebSocketImpl(url);
            } catch (error) {
              return connectFailure(error);
            }

            try {
              /* istanbul ignore else -- @preserve defensive: binaryType may not exist on injected nonstandard WebSocket handles */
              if ("binaryType" in socket) {
                socket.binaryType = "arraybuffer";
              }
            } catch (error) {
              // A missing property is only an ArrayBuffer hint. A setter that throws has already
              // constructed a socket no later cleanup can see, so close it before reporting the failure.
              // Closing a CONNECTING socket still emits a late `error`: keep a listener for it.
              socket.addEventListener("error", ignoreSocketError);
              requestNativeCloseBestEffort(socket);
              return connectFailure(error);
            }

            sessionController.currentSocket = socket;
            let opened = false;
            let runtimeCause: unknown;

            return await new Promise<SocketLifecycleOutcome>(
              (resolveAttempt) => {
                let connectTimer: ReturnType<typeof setTimeout> | undefined;
                let connectTimedOut = false;
                let closeOutcome: SocketLifecycleOutcome | undefined;
                let closeObserved = false;
                let errorCloseTimer: ReturnType<typeof setTimeout> | undefined;
                let messagePumpRunning = false;
                let backlogTimer: ReturnType<typeof setTimeout> | undefined;
                const messageController = new AbortController();
                const messageSignal = mergeAbortSignals(signal, [
                  messageController.signal,
                ]);
                const rawMessages: MessageEvent[] = [];
                let settled = false;
                let cleanedUp = false;

                const clearErrorCloseTimer = () => {
                  if (typeof errorCloseTimer === "undefined") {
                    return;
                  }
                  clearTimeout(errorCloseTimer);
                  errorCloseTimer = undefined;
                };

                // Closing a CONNECTING socket still emits a late `error`. An EventEmitter-based handle such
                // as `ws` throws it when nothing listens, so a no-op listener replaces `handleError` and is
                // never removed. Adding the same listener again is a no-op for an EventTarget.
                const detachErrorListener = () => {
                  socket.addEventListener("error", ignoreSocketError);
                  socket.removeEventListener("error", handleError);
                };

                const cleanup = (keepCurrentSocket: boolean) => {
                  clearErrorCloseTimer();
                  clearTimeout(backlogTimer);
                  backlogTimer = undefined;
                  clearTimeout(connectTimer);
                  socket.removeEventListener("open", handleOpen);
                  socket.removeEventListener("message", onMessage);
                  socket.removeEventListener("close", handleClose);
                  detachErrorListener();
                  signal.removeEventListener("abort", handleAbort);
                  // Registration may synchronously settle this attempt and then attach more listeners.
                  // Re-detach those listeners without touching a replacement runtime's owned state.
                  if (cleanedUp) return;
                  cleanedUp = true;
                  stopHeartbeat(sessionController);
                  messageController.abort();
                  releaseAbortSignal(messageSignal);
                  rawMessages.length = 0;
                  if (
                    !keepCurrentSocket &&
                    sessionController.currentSocket === socket
                  ) {
                    sessionController.currentSocket = undefined;
                  }
                };

                const connectionInfo = (): WebSocketConnectionInfo => ({
                  extensions: socket.extensions || undefined,
                  generation,
                  protocol: socket.protocol || undefined,
                  url: socket.url,
                });

                const settleAttempt = (
                  outcome: SocketLifecycleOutcome,
                  keepCurrentSocket = false,
                ) => {
                  /* istanbul ignore if -- @preserve defensive: every physical attempt is settled through this once-only gate */
                  if (settled) {
                    return;
                  }
                  settled = true;
                  report(
                    classifyAttempt(
                      outcome.opened,
                      outcome.cause,
                      connectTimedOut,
                      outcome.closeInfo,
                    ),
                  );
                  cleanup(keepCurrentSocket);
                  /* istanbul ignore else -- @preserve invariant: activeAttempt refers to the sole physical socket until settlement */
                  if (activeAttempt?.socket === socket) {
                    activeAttempt = undefined;
                  }
                  resolveAttempt(outcome);
                };

                const handleAbort = () => {
                  if (finished) {
                    return;
                  }
                  if (!startupSettled) {
                    latestConnection = connectionInfo();
                    state.connection = latestConnection;
                  }
                  finishFromSignal(extractCloseInfo(undefined, signal.reason));
                };

                const handleOpen = () => {
                  if (finished || opened) {
                    return;
                  }
                  clearTimeout(connectTimer);
                  opened = true;
                  if (attributable) attemptEndpoint.end({ attempted: true });
                  // Per outage: the next close starts again at attempt 1 and the base delay.
                  attempt = 0;
                  generation += 1;
                  latestConnection = connectionInfo();
                  state.connection = latestConnection;
                  try {
                    flushSendQueue(socket, sendQueue, WebSocketCtor.OPEN);
                  } catch (cause) {
                    finish({ cause, kind: "error" });
                    return;
                  }
                  if (finished || manualClose) {
                    return;
                  }
                  setSocketState(state, "open");
                  if (finished) {
                    return;
                  }
                  if (!startupSettled) {
                    startupConnection = latestConnection;
                    startupSettled = true;
                    resolveSession(session);
                  }
                  if (state.status === "open") {
                    startHeartbeat(
                      socket,
                      sessionController,
                      heartbeatConfig,
                      endpoint.outgoing,
                      (cause, timedOut) => {
                        // An unanswered ping is a connection failure, as in gRPC keepalive; a failing
                        // local heartbeat callback or serializer is not the endpoint's fault.
                        if (timedOut) runtimeCause = cause;
                        finish({ cause, kind: "error" });
                      },
                      WebSocketCtor.OPEN,
                    );
                  }
                };

                // A native handle may deliver a whole read in one task, which leaves the pump no chance to run
                // between messages. Only a backlog that survives the current task counts as overflow.
                const armBacklogCheck = () => {
                  backlogTimer ??= setTimeout(() => {
                    backlogTimer = undefined;
                    const rawOverflow =
                      rawMessages.length > endpoint.maxIncomingQueueSize;
                    if (
                      !rawOverflow &&
                      incomingQueue.size <= endpoint.maxIncomingQueueSize
                    ) {
                      return;
                    }
                    finish({
                      cause: createPreflightFault(
                        "CAP_QUEUE_OVERFLOW",
                        new Error(
                          rawOverflow
                            ? "WebSocket raw message queue overflow"
                            : "AsyncQueue overflow",
                        ),
                      ),
                      kind: "error",
                    });
                  }, 0);
                };

                const handleMessage = async (event: MessageEvent) => {
                  /* istanbul ignore if -- @preserve defensive: stale physical listeners are removed before logical settlement */
                  if (finished || sessionController.currentSocket !== socket) {
                    return;
                  }
                  let transformed: WebSocketIncomingData<TIncoming> | undefined;
                  try {
                    messageSignal.throwIfAborted();
                    // Text and byte frames decode synchronously. Only a Blob read waits, so only it races the signal.
                    const decoded = decodeWebSocketMessage(
                      endpoint.incoming,
                      event.data,
                    );
                    transformed = isPromise(decoded)
                      ? await awaitWithSignal(() => decoded, messageSignal)
                      : decoded;
                  } catch (error) {
                    if (finished || messageController.signal.aborted) {
                      return;
                    }
                    emitRuntimeError(state, error);
                    return;
                  }
                  if (
                    finished ||
                    sessionController.currentSocket !== socket ||
                    typeof transformed === "undefined"
                  ) {
                    return;
                  }

                  try {
                    const heartbeat = sessionController.heartbeat;
                    const isAck = heartbeat?.isAck?.(transformed) ?? false;
                    if (
                      finished ||
                      sessionController.currentSocket !== socket ||
                      sessionController.heartbeat !== heartbeat
                    ) {
                      return;
                    }
                    if (isAck && heartbeat) {
                      heartbeat.markAck();
                      return;
                    }
                    incomingQueue.push(transformed);
                    if (incomingQueue.size > endpoint.maxIncomingQueueSize) {
                      armBacklogCheck();
                    }
                  } catch (cause) {
                    if (!finished) {
                      finish({ cause, kind: "error" });
                    }
                  }
                };

                const pumpMessages = async () => {
                  if (messagePumpRunning) {
                    return;
                  }
                  messagePumpRunning = true;
                  try {
                    // The length guard stays first: shifting an empty queue measured twice as slow.
                    let event: MessageEvent | undefined;
                    while (
                      !finished &&
                      rawMessages.length > 0 &&
                      (event = rawMessages.shift()) !== undefined
                    ) {
                      await handleMessage(event);
                    }
                    if (!finished && closeOutcome && rawMessages.length === 0) {
                      settleAttempt(closeOutcome);
                    }
                  } catch (cause) {
                    /* istanbul ignore next -- @preserve defensive: handleMessage and settleAttempt contain their own failure boundaries */
                    finish({ cause, kind: "error" });
                  } finally {
                    messagePumpRunning = false;
                    if (finished) {
                      rawMessages.length = 0;
                    }
                  }
                };

                const onMessage = (event: MessageEvent) => {
                  /* istanbul ignore if -- @preserve defensive: physical message listeners are removed as soon as close is observed */
                  if (
                    finished ||
                    closeObserved ||
                    sessionController.currentSocket !== socket
                  ) {
                    return;
                  }
                  rawMessages.push(event);
                  if (rawMessages.length > endpoint.maxIncomingQueueSize) {
                    armBacklogCheck();
                  }
                  const messagePumpTask = pumpMessages();
                  messagePumpTasks.add(messagePumpTask);
                  void messagePumpTask.finally(() => {
                    messagePumpTasks.delete(messagePumpTask);
                  });
                };

                const handleError = () => {
                  runtimeCause =
                    runtimeCause ?? new Error("WebSocket connection error");
                  stopHeartbeat(sessionController);
                  detachErrorListener();
                  errorCloseTimer = setTimeout(() => {
                    errorCloseTimer = undefined;
                    finish(
                      { cause: runtimeCause, kind: "error" },
                      { skipNativeClose: true },
                    );
                  }, SOCKET_CLOSE_GRACE_MS);
                  try {
                    socket.close();
                  } catch {
                    clearErrorCloseTimer();
                    finish(
                      { cause: runtimeCause, kind: "error" },
                      { skipNativeClose: true },
                    );
                  }
                };

                const handleClose = (event: CloseEvent) => {
                  if (closeObserved) {
                    return;
                  }
                  closeObserved = true;
                  clearErrorCloseTimer();
                  sessionController.heartbeat?.stop();
                  socket.removeEventListener("open", handleOpen);
                  socket.removeEventListener("message", onMessage);
                  detachErrorListener();
                  closeOutcome = {
                    closeInfo: extractCloseInfo(event, runtimeCause),
                    connection: connectionInfo(),
                    cause: runtimeCause,
                    opened,
                  };
                  if (disposeTask) {
                    activeAttempt?.abortMessagePumpForDisposal();
                  }
                  if (typeof runtimeCause !== "undefined") {
                    rawMessages.length = 0;
                    settleAttempt(closeOutcome);
                    return;
                  }
                  if (!messagePumpRunning && rawMessages.length === 0) {
                    settleAttempt(closeOutcome);
                  }
                };

                activeAttempt = {
                  abortMessagePumpForDisposal() {
                    if (closeObserved) {
                      messageController.abort();
                    }
                  },
                  cancel(keepCurrentSocket = false) {
                    // A locally failed message pump must not discard an already observed close.
                    settleAttempt(
                      closeOutcome ?? {
                        closeInfo: extractCloseInfo(undefined, runtimeCause),
                        connection: connectionInfo(),
                        cause: runtimeCause,
                        opened,
                      },
                      keepCurrentSocket,
                    );
                  },
                  socket,
                };

                if (reconnect?.connectTimeoutMs !== undefined)
                  connectTimer = setTimeout(() => {
                    connectTimedOut = true;
                    runtimeCause = ERR_TIMEOUT;
                    requestNativeCloseBestEffort(socket);
                    settleAttempt({
                      cause: ERR_TIMEOUT,
                      closeInfo: extractCloseInfo(undefined, ERR_TIMEOUT),
                      connection: connectionInfo(),
                      opened: false,
                    });
                  }, reconnect.connectTimeoutMs);
                signal.addEventListener("abort", handleAbort, { once: true });
                socket.addEventListener("open", handleOpen);
                socket.addEventListener("message", onMessage);
                socket.addEventListener("close", handleClose);
                socket.addEventListener("error", handleError);
                if (signal.aborted) {
                  handleAbort();
                }
                if (settled) {
                  cleanup(false);
                }
              },
            );
          }

          function finish(
            final: WebSocketCloseInfo,
            options: FinishOptions = {},
          ): void {
            /* istanbul ignore if -- @preserve defensive once-only gate: terminal callers and reentrant state transitions check finished before invoking finish */
            if (finished) {
              return;
            }

            finished = true;
            stopHeartbeat(sessionController);

            const activeSocket = sessionController.currentSocket;
            if (
              final.kind !== "closed" &&
              activeSocket &&
              !options.skipNativeClose
            ) {
              requestNativeCloseBestEffort(activeSocket);
            }
            if (activeSocket && options.keepPhysicalCleanup) {
              physicalCleanupDetach = installPhysicalCleanup(
                activeSocket,
                sessionController,
              );
            }
            const socketAttempt = activeAttempt;
            activeAttempt?.cancel(options.keepPhysicalCleanup);
            if (socketAttempt === undefined) {
              report({ attempted: false });
            }

            sendQueue.length = 0;
            if (final.kind === "closed") {
              incomingQueue.close();
              state.error = undefined;
            } else {
              const terminalCause =
                final.cause ?? new DOMException("Aborted", "AbortError");
              incomingQueue.fail(terminalCause);
              state.error = options.startupError ?? faultFromCloseInfo(final);
              if (final.kind === "error") {
                emitRuntimeError(state, final.cause);
              }
            }

            state.connection = latestConnection;
            setSocketState(
              state,
              final.kind === "closed" ? "closed" : final.kind,
            );
            state.listeners.runtimeError.clear();
            state.listeners.stateChange.clear();

            if (!controller.signal.aborted) {
              controller.abort(final);
            }

            closedDeferred.resolve(final);
            releaseAbortSignal(signal);
            if (!startupSettled) {
              const startupError =
                options.startupError ?? faultFromCloseInfo(final);
              state.error = startupError;
              rejectSession(startupError);
            }
          }

          function finishFromSignal(
            snapshot: WebSocketCloseSnapshot = {},
          ): void {
            /* istanbul ignore next -- @preserve invariant: finishFromSignal is called only after the merged signal aborts */
            const transportError =
              resolveAbortFault(signal) ?? createNetworkFault(ERR_ABORTED);
            if (transportError.code === "NET_TIMEOUT") {
              finish(toErrorInfo(snapshot, signal.reason), {
                startupError: transportError,
              });
              return;
            }
            finish(toAbortedInfo(snapshot, signal.reason), {
              startupError: transportError,
            });
          }

          function requestClose(code?: number, reason?: string): void {
            validateWebSocketClose(code, reason);
            if (finished || manualClose) {
              return;
            }

            manualClose = { code, kind: "manual-web-socket-close", reason };
            sessionController.heartbeat?.stop();
            setSocketState(state, "closing");
            if (finished) {
              return;
            }
            const socket = sessionController.currentSocket;
            if (!socket) {
              finish(toClosedInfo({}, manualClose));
              return;
            }

            try {
              socket.close(code, reason);
            } catch (cause) {
              try {
                socket.close();
              } catch {
                finish(
                  { cause, kind: "error" },
                  { keepPhysicalCleanup: true, skipNativeClose: true },
                );
              }
              throw cause;
            }
          }

          function disposeSession(): Promise<void> {
            return (disposeTask ??= Promise.resolve().then(disposeOnce));
          }

          async function disposeOnce(): Promise<void> {
            try {
              try {
                session.close();
              } catch (cause) {
                hasCloseError = true;
                closeError = cause;
              }
              activeAttempt?.abortMessagePumpForDisposal();

              if (!finished) {
                disposeTimer = setTimeout(() => {
                  /* istanbul ignore if -- @preserve defensive: lifecycle completion clears this timer before a later timer task can run */
                  if (finished) {
                    return;
                  }
                  disposeTimeout = new DOMException(
                    "WebSocket close event was not observed before teardown timeout",
                    "TimeoutError",
                  );
                  finish(toClosedInfo({}, manualClose), {
                    skipNativeClose: true,
                  });
                }, SOCKET_CLOSE_GRACE_MS);
              }

              await lifecycleTask;
              await Promise.allSettled([...messagePumpTasks]);
            } finally {
              clearTimeout(disposeTimer);
              disposeTimer = undefined;
              physicalCleanupDetach?.();
            }

            if (hasCloseError) {
              throw closeError;
            }
            if (disposeTimeout) {
              throw disposeTimeout;
            }
          }
        },
      );
      pendingSessions.add(pendingSession);
      void pendingSession.then(
        (createdSession) => {
          pendingSessions.delete(pendingSession);
          undeliveredSessions.add(createdSession);
        },
        () => {
          pendingSessions.delete(pendingSession);
        },
      );
      return pendingSession;
    };

    const wsInterceptors = resolveWebSocketInterceptors(
      clientConfig.interceptors,
    );
    const wsChain = makeChain(wsInterceptors);

    try {
      const session = await awaitWithSignal(
        () => wsChain(wsRequest, wsHandler),
        chainSignal,
      );
      // Interceptors may return wrappers or synthetic sessions, but callers still need the complete session surface.
      const publicConnection = session?.connection;
      if (
        typeof session?.closed?.then !== "function" ||
        typeof session.close !== "function" ||
        typeof session.send !== "function" ||
        typeof session.receive?.[Symbol.asyncIterator] !== "function" ||
        typeof session[Symbol.asyncDispose] !== "function" ||
        typeof session.onRuntimeError !== "function" ||
        typeof session.onStateChange !== "function" ||
        typeof publicConnection?.generation !== "number" ||
        typeof session.bufferedAmount !== "number" ||
        typeof session.state !== "string"
      ) {
        throw new TypeError(
          "WebSocket interceptor must resolve a WebSocket session",
        );
      }
      chainSettled = true;
      releaseAbortSignal(chainSignal);
      let deliveredSession = [...undeliveredSessions].some(
        (createdSession) =>
          createdSession === session ||
          createdSession.closed === session.closed,
      );
      const pendingSessionSnapshot = [...pendingSessions];
      if (
        !deliveredSession &&
        (undeliveredSessions.size > 0 || pendingSessionSnapshot.length > 0) &&
        !controller.signal.aborted
      ) {
        controller.abort(
          new Error("WebSocket session was replaced by interceptor"),
        );
      }
      await Promise.allSettled(pendingSessionSnapshot);
      const deliveredOwnedSession = [...undeliveredSessions].find(
        (createdSession) =>
          createdSession === session ||
          createdSession.closed === session.closed,
      );
      deliveredSession = deliveredOwnedSession !== undefined;
      const discardedSessions = [...undeliveredSessions].filter(
        (createdSession) =>
          createdSession !== session &&
          createdSession.closed !== session.closed,
      );
      await Promise.allSettled(
        discardedSessions.map((discardedSession) => discardedSession.closed),
      );
      pendingSessions.clear();
      undeliveredSessions.clear();
      if (!deliveredSession) {
        startupConnection = undefined;
        releaseAbortSignal(signal);
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the published WebSocketInterceptor/WebSocketHandler types carry WebSocketSessionLike, and an interceptor may return its own session, which is delivered by identity, while the published SocketAwaitResult needs the endpoint's WebSocketSession types. Unasserted: TS2322, `WebSocketSessionLike` is not assignable to `WebSocketSession<StructOutput<TIncoming>, WebSocketOutgoingData<TOutgoing>>`. A validating adapter would replace the delivered session
      const typedSession = session as WebSocketSession<
        WebSocketIncomingData<TIncoming>,
        WebSocketOutgoingData<TOutgoing>
      >;
      let connection = publicConnection;
      if (
        startupConnection &&
        deliveredOwnedSession &&
        (deliveredOwnedSession === session ||
          publicConnection === deliveredOwnedSession.connection)
      ) {
        connection = startupConnection;
      }
      return [null, typedSession, connection];
    } catch (error) {
      chainSettled = true;
      releaseAbortSignal(chainSignal);
      const signalError = resolveAbortFault(chainSignal);
      // The startup catch funnels every failure: a value that is already a fault (a refused
      // connection, a bad URL, a rejected hook) crosses unchanged, and only an unclassified throw
      // is attributed to the extension that produced it.
      const requestError = signalError ?? caughtRequestFault(error);
      if (signalError) {
        state.error = signalError;
        setSocketState(
          state,
          signalError.code === "NET_ABORTED" ? "aborted" : "error",
        );
      }
      const pendingSessionSnapshot = [...pendingSessions];
      if (undeliveredSessions.size > 0 || pendingSessionSnapshot.length > 0) {
        if (!controller.signal.aborted) {
          controller.abort(error);
        }
        await Promise.allSettled(pendingSessionSnapshot);
        await Promise.allSettled(
          [...undeliveredSessions].map((session) => session.closed),
        );
        pendingSessions.clear();
        undeliveredSessions.clear();
      }
      releaseAbortSignal(signal);
      return [requestError, undefined, state.connection];
    }
  } finally {
    if (!handedToHandler) {
      initialPick.done({ attempted: false });
    }
  }
}

/**
 * The outcome of a **single connect attempt**, not the final result of the session.
 *
 * The reconnect logic uses it to decide whether to try again.
 *
 * - `closeInfo` holds the close details of that attempt: `{ cause?, code?, reason?, wasClean? }`.
 *
 * - `connection` is the connection snapshot, when the attempt got one.
 *
 * - `cause` is the error that ended the attempt, if any.
 *
 * - `opened` tells whether the socket reached `open` before it ended.
 *
 * The `shouldReconnect` option does not receive this object. It gets `attempt`, `cause`, `code`, `reason`, and `wasClean`, taken from it. The final result of the session is {@link WebSocketCloseInfo}.
 *
 * @group web-socket
 */
export type SocketLifecycleOutcome = {
  closeInfo: WebSocketCloseSnapshot;
  connection?: WebSocketConnectionInfo;
  cause?: unknown;
  opened: boolean;
};

type ActiveSocketAttempt = {
  abortMessagePumpForDisposal(): void;
  cancel(keepCurrentSocket?: boolean): void;
  socket: WebSocketHandle;
};

type FinishOptions = {
  keepPhysicalCleanup?: boolean;
  skipNativeClose?: boolean;
  startupError?: AnyFault;
};

const SOCKET_CLOSE_GRACE_MS = 1_000;
const noop = () => undefined;

function createWebSocketSession<
  TIncoming,
  TOutgoing extends AnyStruct | undefined,
>(
  outgoing: TOutgoing,
  queue: AsyncQueue<TIncoming>,
  closed: Promise<WebSocketCloseInfo>,
  state: SocketRefState,
  sessionController: {
    currentSocket: WebSocketHandle | undefined;
    heartbeat: HeartbeatRuntime<TIncoming> | undefined;
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
      return sessionController.currentSocket?.bufferedAmount ?? 0;
    },
    get connection() {
      return (
        state.connection ??
          /* istanbul ignore next -- @preserve invariant: concrete sessions are delivered only after their first open snapshot */
          { generation: 0 }
      );
    },
    closed,
    close(code?: number, reason?: string) {
      requestClose(code, reason);
    },
    [Symbol.asyncDispose]() {
      return disposeSession();
    },
    get state() {
      return state.status;
    },
    onRuntimeError(listener) {
      if (isUnavailable()) {
        return noop;
      }
      // Type boundary: listener is typed as (error: unknown) => void at the call site; the set stores the same runtime value.
      state.listeners.runtimeError.add(listener);
      return () => {
        state.listeners.runtimeError.delete(listener);
      };
    },
    onStateChange(listener) {
      if (isUnavailable()) {
        return noop;
      }
      state.listeners.stateChange.add(listener);
      return () => {
        state.listeners.stateChange.delete(listener);
      };
    },
    receive: queue,
    send(message: WebSocketOutgoingData<TOutgoing>) {
      if (isUnavailable()) {
        throw new DOMException(
          "WebSocket session is closed",
          "InvalidStateError",
        );
      }
      const socket = sessionController.currentSocket;
      const initialState = state.status;
      const initialReadyState = socket?.readyState;
      const destination =
        initialState === "open" && initialReadyState === openState
          ? "socket"
          : initialState === "reconnecting"
            ? "queue"
            : undefined;
      if (!destination) {
        throw new DOMException(
          "WebSocket session is not writable",
          "InvalidStateError",
        );
      }

      const serialized = serializeOutgoingWebSocketMessage(outgoing, message);
      if (
        isUnavailable() ||
        state.status !== initialState ||
        sessionController.currentSocket !== socket ||
        socket?.readyState !== initialReadyState
      ) {
        throw new DOMException(
          "WebSocket session is not writable",
          "InvalidStateError",
        );
      }

      // "socket" was chosen from the captured readyState, so this narrows without reading it again.
      if (destination === "socket" && socket !== undefined) {
        socket.send(serialized);
        return;
      }
      if (maxOutgoingQueueSize === 0) {
        throw new Error("WebSocket outgoing queue is disabled");
      }
      if (sendQueue.length >= maxOutgoingQueueSize) {
        throw new Error("WebSocket send queue overflow");
      }
      sendQueue.push(serialized);
    },
  };
}

function flushSendQueue(
  socket: WebSocketHandle,
  queue: string[],
  openState: number,
): void {
  while (socket.readyState === openState) {
    const next = queue.shift();
    if (typeof next === "undefined") {
      return;
    }

    socket.send(next);
  }
}

function setSocketState(state: SocketRefState, next: WebSocketState): void {
  if (state.status === next) {
    return;
  }

  state.status = next;
  state.transition += 1;
  const transition = state.transition;
  for (const listener of [...state.listeners.stateChange]) {
    if (state.transition !== transition) {
      break;
    }
    try {
      const result = listener(next);
      const runtimeErrorListeners = [...state.listeners.runtimeError];
      consumeObserverResult(result, (error) =>
        emitRuntimeErrorToListeners(runtimeErrorListeners, error),
      );
    } catch (error) {
      emitRuntimeError(state, error);
    }
  }
}

function emitRuntimeError(state: SocketRefState, error: unknown): void {
  emitRuntimeErrorToListeners([...state.listeners.runtimeError], error);
}

function emitRuntimeErrorToListeners(
  listeners: readonly ((error: unknown) => void)[],
  error: unknown,
): void {
  for (const listener of listeners) {
    try {
      const result = listener(error);
      consumeObserverResult(result, reportObserverError);
    } catch (observerError) {
      reportObserverError(observerError);
    }
  }
}

function reportObserverError(error: unknown): void {
  const reportError = globalThis.reportError;
  if (typeof reportError !== "function") {
    return;
  }
  try {
    const result = reportError(error);
    consumeObserverResult(result, () => undefined);
  } catch {
    // Reporting observer failures must never re-enter the session lifecycle.
  }
}

function consumeObserverResult(
  result: unknown,
  onRejected: (error: unknown) => void,
): void {
  if (
    (typeof result !== "object" || result === null) &&
    typeof result !== "function"
  ) {
    return;
  }
  void Promise.resolve(result).catch(onRejected);
}

function validateWebSocketQueueLimits(
  maxIncomingQueueSize: number,
  maxOutgoingQueueSize: number | undefined,
): void {
  if (!Number.isSafeInteger(maxIncomingQueueSize) || maxIncomingQueueSize < 1) {
    throw new TypeError("maxIncomingQueueSize must be a positive safe integer");
  }

  const outgoingSize = maxOutgoingQueueSize ?? 0;
  if (!Number.isSafeInteger(outgoingSize) || outgoingSize < 0) {
    throw new TypeError(
      "maxOutgoingQueueSize must be a non-negative safe integer",
    );
  }
}

function validateWebSocketClose(
  code: number | undefined,
  reason: string | undefined,
): void {
  if (
    typeof code !== "undefined" &&
    (!Number.isInteger(code) || (code !== 1000 && (code < 3000 || code > 4999)))
  ) {
    throw new DOMException(
      "The close code must be 1000 or between 3000 and 4999",
      "InvalidAccessError",
    );
  }
  if (
    typeof reason !== "undefined" &&
    new TextEncoder().encode(reason).byteLength > 123
  ) {
    throw new DOMException(
      "The close reason must not exceed 123 UTF-8 bytes",
      "SyntaxError",
    );
  }
}

function connectFailure(error: unknown): SocketLifecycleOutcome {
  return {
    closeInfo: {
      cause: error,
      reason:
        error instanceof Error ? error.message : "WebSocket connection error",
    },
    connection: undefined,
    cause: error,
    opened: false,
  };
}

function ignoreSocketError(): void {}

function requestNativeCloseBestEffort(socket: WebSocketHandle): void {
  try {
    socket.close();
  } catch {
    // Logical settlement must not depend on a conforming native close implementation.
  }
}

function installPhysicalCleanup(
  socket: WebSocketHandle,
  sessionController: { currentSocket: WebSocketHandle | undefined },
): () => void {
  let detached = false;
  const cleanup = () => {
    if (detached) {
      return;
    }
    detached = true;
    socket.removeEventListener("close", cleanup);
    /* istanbul ignore else -- @preserve invariant: no replacement socket is created while physical cleanup is pending */
    if (sessionController.currentSocket === socket) {
      sessionController.currentSocket = undefined;
    }
  };
  socket.addEventListener("close", cleanup, { once: true });
  return cleanup;
}

function toClosedInfo(
  snapshot: WebSocketCloseSnapshot,
  fallback?: ManualSocketCloseReason,
): WebSocketCloseInfo {
  return {
    code: snapshot.code ?? fallback?.code,
    kind: "closed",
    reason: snapshot.reason ?? fallback?.reason,
    wasClean: snapshot.wasClean,
  };
}

function toAbortedInfo(
  snapshot: WebSocketCloseSnapshot,
  cause: unknown,
): WebSocketCloseInfo {
  return {
    cause,
    code: snapshot.code,
    kind: "aborted",
    reason: snapshot.reason,
    wasClean: snapshot.wasClean,
  };
}

function toErrorInfo(
  snapshot: WebSocketCloseSnapshot,
  cause: unknown,
): WebSocketCloseInfo {
  return {
    cause,
    code: snapshot.code,
    kind: "error",
    reason: snapshot.reason,
    wasClean: snapshot.wasClean,
  };
}

function doneInfoForNetworkCause(cause: unknown): DoneInfo {
  const code = createNetworkFault(cause).code;
  if (code === "NET_TIMEOUT") {
    return { attempted: true, code: "NET_TIMEOUT" };
  }
  if (code === "NET_ABORTED") {
    return { attempted: false };
  }
  return { attempted: true, code: "NET_UNREACHABLE" };
}

function faultFromCloseInfo(closeInfo: WebSocketCloseInfo): AnyFault {
  if (closeInfo.kind !== "closed" && isFault(closeInfo.cause)) {
    return closeInfo.cause;
  }
  /* istanbul ignore if -- @preserve invariant: internal abort terminal paths always supply startupError directly */
  if (closeInfo.kind === "aborted") {
    return createNetworkFault(ERR_ABORTED);
  }
  /* istanbul ignore else -- @preserve invariant: pre-open closed paths supply startupError before this helper is reached */
  if (closeInfo.kind === "error") {
    return createNetworkFault(closeInfo.cause);
  }
  /* istanbul ignore next -- @preserve invariant: pre-open closed paths supply startupError before this helper is reached */
  return createNetworkFault(new Error("WebSocket closed before open"));
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise;
}

function caughtRequestFault(error: unknown): Fault<undefined> {
  if (!isFault(error)) {
    return createPreflightFault("EXT_INTERCEPTOR_FAILED", error);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: an interceptor may throw any Defjs fault, which is returned unchanged, but the published SocketAwaitResult error slot is `Fault<undefined>`. Unasserted: TS2322, `AnyFault` is not assignable to `Fault<undefined>`; narrowing would rewrap a thrown HTTP_STATUS fault whose data is not undefined, and widening the slot changes that published declaration
  return error as Fault<undefined>;
}

function isFault(value: unknown): value is AnyFault {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    value instanceof Error
  );
}
