import type { Client, RequestOptions } from "../client/client";
import { CLIENT } from "../client/client";
import { snapshotHeartbeat, snapshotProtocols } from "../client/capture";
import type {
  ClientConfig,
  ClientWebSocketOptions,
  RetryOptions,
} from "../client/config";

import type { ResolvedEndpoint } from "../balancer/runtime";
import { pickEndpoint } from "../balancer/runtime";
import type { Fault, PreflightFault } from "../error";
import { createPreflightFault } from "../error";
import { isDefjsFault } from "../error/factory";
import type { WebSocketSessionLike } from "../interceptor/interceptor";
import {
  makeChain,
  resolveWebSocketInterceptors,
} from "../interceptor/interceptor";
import {
  awaitWithSignal,
  mergeAbortSignals,
  resolveAbortFault,
} from "../internal/abort";
import { rejected } from "../internal/chain_faults";
import type { EndpointArgs, EndpointInput } from "../internal/endpoint_input";
import type { HttpRequest } from "../http/http_request";
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
import type { CallScope } from "../internal/preflight";
import { preflight } from "../internal/preflight";
import { createWebSocketRequest } from "./build";
import type { WebSocketCloseSnapshot } from "./codec";
import { startSession } from "./lifecycle";
import type { Session, SocketConstructor } from "./session";
import type { RetryPolicy } from "../internal/retry";
import { resolveRetryPolicy } from "../internal/retry";

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
 * - `maxOutgoingQueueSize` is how many messages are kept while the session is `reconnecting`; it defaults to `0`, which disables queueing of messages sent in that state. Incoming messages are not bounded by a count: the library queues every message the platform delivers until `receive` reads it.
 *
 * - `protocols` is the static default subprotocol list. `RequestOptions.protocols` and {@link withWebSocketProtocols} override it.
 *
 * - `operation` is a static, low-cardinality name for telemetry.
 *
 * - `input` is the struct for the operation input. A declared `input` always requires an explicit `builder`. `input` only defines the parameters; the builder alone decides where each value goes. Only definitions without `input` may omit `builder`. The builder may return `path` and `query` only; see {@link WebSocketRequestShape}.
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
 * - `closed`: the session ended normally. When the peer or the server closed it, the messages already queued are still delivered through `receive` before it ends, unless the caller stops the session first. A manual `session.close()` or disposal is a stop by the caller: the messages nobody has read yet are discarded and `receive` ends at once.
 *
 * - `aborted`: the session was cancelled; `cause` is the abort reason. Messages nobody has read yet are discarded.
 *
 * - `error`: the session failed; `cause` is required. The error is passed to `onRuntimeError`. Runtime causes need not carry a Defjs fault code; heartbeat timeout and exhausted reconnects can retain plain errors. A connection that was open and then dropped without a close frame (`code` 1006) is an `error` on every runtime, with `cause` `Error("WebSocket connection error")`; the runtime need not fire a native `error` event for it. Messages already queued are still delivered through `receive`, unless the caller stops the session first; it rejects with `cause` after the last one.
 *
 * - `code`, `reason`, and `wasClean` come from the native close event when one was observed. A manual `session.close(code, reason)` fills `code` and `reason` when the close event does not.
 *
 * A stop by the caller (`session.close()`, disposal, or an abort of the caller's `signal`) discards the messages nobody has read yet, whether or not the session had already ended (the peer closed it, or it failed). A stop after the session ended discards the unread messages and changes nothing else: `closed` keeps its value, and `receive` still rejects with the `cause` of an `error` end once no unread message is left. A `signal` that expires with a `TimeoutError` while the session is still running is a timeout, not a stop: the session ends as an `error` and delivers the queued messages first. A deadline that expires after the session has ended is a stop.
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
 * - `receive` yields incoming messages already parsed with the `incoming` struct. It is one-consumer: asking for a second iterator throws a `TypeError`. A frame that cannot be parsed is reported to `onRuntimeError` listeners and skipped. When the transport fails (for example a drop without a close frame), messages already received are delivered first, then `receive` rejects with `closed.cause`. Cancellation by the caller (`signal` abort), `close()` and disposal discard the messages nobody has read yet, whether or not the session had already ended; a heartbeat timeout or a transport failure ends with an error after the queued messages are delivered, and a stop after that error discards the unread messages while `receive` still rejects with `closed.cause`. A `signal` that expires with a timeout while the session is open is not a stop, but one that expires after the session ended is.
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
  retry?: Omit<RetryOptions, "budget">;
}

/**
 * WebSocket fields of {@link RequestOptions}, plus `signal`.
 *
 * `beforeConnect`, `heartbeat`, `protocols`, and `retry` override the client-level options for one call. `signal` covers the whole session, including after it opens. For a deadline on connecting alone, pass `retry: { maxRetries: 0, attemptTimeoutMs }`. There is no `abort` field.
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
 * Heartbeat settings for a live WebSocket session: what to send, how often, and how to recognize the answer.
 *
 * Defjs defines no heartbeat format. `message` and `isAck` are yours.
 *
 * - `intervalMs` is the delay between heartbeat messages.
 *
 * - `message()` builds the payload. It is sent through the `outgoing` struct as JSON text, so the endpoint needs an `outgoing` struct. Nothing is sent when it returns `undefined`.
 *
 * - After struct encoding, non-JSON values fail with `TypeError` through the same serializer as `session.send`; that heartbeat failure ends the session without a retry.
 *
 * - `isAck(message)` receives each decoded incoming message. When it returns `true`, the message is the acknowledgement and is not delivered to `receive`. A frame that fails the `incoming` struct never reaches it.
 *
 * - `timeoutMs` is how long to wait for an acknowledgement after a heartbeat, and it needs `isAck`: the type allows `timeoutMs` only together with `isAck`. A missing acknowledgement counts as a connection failure, reported to the balancer as `NET_UNREACHABLE`. The socket is closed and the attempt enters the retry flow of `withRetry`; without a retry policy the session ends with an `error`. A throwing `message()` or a serialization failure also ends the session, but is not attributed to the endpoint and is not retried.
 *
 * Set it with {@link withWebSocketHeartbeat} or the `heartbeat` request option.
 *
 * @group web-socket
 */
export type WebSocketHeartbeatConfig<TIncoming = unknown, TOutgoing = unknown> =
  | {
      intervalMs: number;
      isAck?: (message: TIncoming) => boolean;
      message: () => TOutgoing;
      timeoutMs?: undefined;
    }
  | {
      intervalMs: number;
      isAck: (message: TIncoming) => boolean;
      message: () => TOutgoing;
      timeoutMs: number;
    };

/**
 * Declare a typed WebSocket endpoint.
 *
 * Pass path and incoming (and optional outgoing) message structs.
 * Call the returned operation with a client and, when declared, the input.
 *
 * - **definition** — `path`, one `incoming` struct, and optional `outgoing` and `input` structs, static `protocols`, `maxOutgoingQueueSize`, and `operation`. A declared `input` always requires an explicit `builder`. `input` only defines the parameters; the builder alone decides where each value goes. Only definitions without `input` may omit `builder`.
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
  const maxOutgoingQueueSize = definition.maxOutgoingQueueSize;
  const operation = definition.operation;
  const outgoing = definition.outgoing;
  const path = definition.path;
  const protocols = snapshotProtocols(definition.protocols);
  const endpoint = {
    builder,
    incoming,
    input,
    maxOutgoingQueueSize,
    operation,
    outgoing,
    path,
    protocols,
  };

  return (client: Client, input?: EndpointInput<TInput>) =>
    runWebSocketCommand(
      client[CLIENT].config,
      endpoint,
      input,
      client[CLIENT].options,
    );
}

type ResolvedCallOptions = {
  beforeConnect: ClientWebSocketOptions["beforeConnect"];
  heartbeat: ClientWebSocketOptions["heartbeat"];
  protocols: readonly string[] | undefined;
  retry: RetryPolicy | undefined;
};

function readCallOptions(
  config: RequestOptions | undefined,
  clientConfig: ClientConfig,
): ResolvedCallOptions {
  const configuredProtocols = config?.protocols;
  return {
    beforeConnect: config?.beforeConnect,
    heartbeat: snapshotHeartbeat(
      config?.heartbeat ?? clientConfig.webSocket.heartbeat,
    ),
    protocols: configuredProtocols ? [...configuredProtocols] : undefined,
    retry: resolveRetryPolicy(config?.retry ?? clientConfig.retry),
  };
}

/** The request the interceptors start from, or the fault that ends the call: a builder or URL failure, or a cancellation. */
function buildSocketRequest(
  scope: CallScope,
  endpoint: WebSocketDefinition<
    AnyStruct | undefined,
    AnyStruct,
    AnyStruct | undefined
  >,
  clientConfig: ClientConfig,
  baseEndpoint: string,
): HttpRequest | PreflightFault {
  const { signal } = scope;
  let built: MaterializedRequest;
  try {
    built = materializeOutboundRequest(
      runOutboundBuilder(scope.input, endpoint.builder),
      "web-socket",
      scope.guides,
    );
  } catch (error) {
    return (
      resolveAbortFault(signal) ??
      createPreflightFault("REQ_BUILD_FAILED", error)
    );
  }
  const cancelled = resolveAbortFault(signal);
  if (cancelled) {
    return cancelled;
  }
  try {
    return createWebSocketRequest({
      signal,
      baseEndpoint,
      operation: endpoint.operation,
      params: built.params,
      path: endpoint.path,
      query: built.query,
      querySerializer: clientConfig.querySerializer,
      withCredentials: clientConfig.withCredentials,
    });
  } catch (error) {
    return (
      resolveAbortFault(signal) ??
      createPreflightFault("REQ_BUILD_FAILED", error)
    );
  }
}

function resolveSocketConstructor(
  handle: ClientWebSocketOptions["handle"],
):
  | NonNullable<ClientWebSocketOptions["handle"] | typeof WebSocket>
  | PreflightFault {
  const candidate = handle ?? globalThis.WebSocket;
  if (typeof candidate !== "function") {
    return createPreflightFault(
      "ENV_UNSUPPORTED",
      new Error("WebSocket is not supported in current runtime"),
    );
  }
  return candidate;
}

/** What one call shares between its entry, the `next` it hands to interceptors, and the delivery of its result. */
interface Call {
  readonly clientConfig: ClientConfig;
  readonly endpoint: WebSocketDefinition<
    AnyStruct | undefined,
    AnyStruct,
    AnyStruct | undefined
  >;
  readonly options: ResolvedCallOptions;
  readonly callerSignal: AbortSignal | undefined;
  readonly scope: CallScope;
  readonly pick: ResolvedEndpoint;
  readonly Socket: SocketConstructor;
  readonly openState: number;
  /** The session this call built. It releases the scope and settles the pick when it ends. */
  owned: Session | undefined;
  chainSettled: boolean;
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
): Promise<
  SocketAwaitResult<
    WebSocketIncomingData<TIncoming>,
    WebSocketOutgoingData<TOutgoing>
  >
> {
  const scope = preflight(endpoint.input, input, config?.signal);
  if (scope instanceof Error) {
    return [scope, undefined, undefined];
  }
  const [pickFault, pick] = pickEndpoint(clientConfig.balancer, {
    endpoints: clientConfig.endpoints,
    operation: endpoint.operation,
  });
  if (pickFault) {
    scope.release();
    return [pickFault, undefined, undefined];
  }

  let call: Call | undefined;
  try {
    const request = buildSocketRequest(
      scope,
      endpoint,
      clientConfig,
      pick.endpoint,
    );
    if (request instanceof Error) {
      return [request, undefined, undefined];
    }
    const WebSocketCtor = resolveSocketConstructor(
      clientConfig.webSocket.handle,
    );
    if (WebSocketCtor instanceof Error) {
      return [WebSocketCtor, undefined, undefined];
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the published WebSocketHandleConstructor is `{ readonly OPEN: number } & (new (...args: never[]) => WebSocketHandle)`, so its construct parameters are erased and `new` cannot pass the URL unasserted (TS2345, `string` is not assignable to `never`); giving it real parameters changes that published declaration
    const Socket = WebSocketCtor as unknown as SocketConstructor;
    const current: Call = {
      clientConfig,
      endpoint,
      options: readCallOptions(config, clientConfig),
      callerSignal: config?.signal,
      scope,
      pick,
      Socket,
      openState: WebSocketCtor.OPEN,
      owned: undefined,
      chainSettled: false,
    };
    call = current;

    const chain = makeChain(
      resolveWebSocketInterceptors(clientConfig.interceptors),
    );
    // Only the caller's signal cuts the chain short. The session's own end does not.
    const chainSignal = config?.signal ?? new AbortController().signal;
    try {
      const session = await awaitWithSignal(
        () => chain(request, (req) => openSession(current, req)),
        chainSignal,
      );
      const connection = await deliveredConnection(current, session);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the published WebSocketInterceptor/WebSocketHandler types carry WebSocketSessionLike, and an interceptor may return its own session, which is delivered by identity, while the published SocketAwaitResult needs the endpoint's WebSocketSession types. Unasserted: TS2322, `WebSocketSessionLike` is not assignable to `WebSocketSession<StructOutput<TIncoming>, WebSocketOutgoingData<TOutgoing>>`. A validating adapter would replace the delivered session
      const typedSession = session as WebSocketSession<
        WebSocketIncomingData<TIncoming>,
        WebSocketOutgoingData<TOutgoing>
      >;
      return [null, typedSession, connection];
    } catch (error) {
      current.chainSettled = true;
      // The startup catch funnels every failure: a value that is already a fault (a refused
      // connection, a bad URL, a rejected hook) crosses unchanged, and only an unclassified throw
      // is attributed to the extension that produced it.
      const requestError =
        resolveAbortFault(chainSignal) ?? caughtRequestFault(error);
      if (current.owned !== undefined) {
        await discardOwned(current.owned, error);
      }
      return [requestError, undefined, current.owned?.connection];
    }
  } finally {
    if (call?.owned === undefined) {
      scope.release();
      pick.done({ attempted: false });
    }
  }
}

/** The `next` of the interceptor chain: builds the call's session, once, and starts it. */
function openSession(
  call: Call,
  req: HttpRequest,
): Promise<WebSocketSessionLike> {
  if (call.chainSettled || call.owned !== undefined) {
    return rejected(
      new Error(
        call.chainSettled
          ? "WebSocket interceptor next() may not be called after the chain settles"
          : "WebSocket interceptor next() may only be called once",
      ),
    );
  }
  // Both the caller and an interceptor replacement stay live.
  const signal = mergeAbortSignals(call.scope.signal, [req.signal]);
  const { clientConfig, endpoint, options, pick } = call;
  const attributable = req.baseEndpoint === pick.endpoint;
  if (!attributable) {
    pick.done({ attempted: false });
  }
  const started = startSession(
    {
      incoming: endpoint.incoming,
      outgoing: endpoint.outgoing,
      maxOutgoingQueueSize: endpoint.maxOutgoingQueueSize ?? 0,
      clientConfig,
      operation: endpoint.operation,
      Socket: call.Socket,
      openState: call.openState,
      retry: options.retry,
      heartbeat: options.heartbeat,
      beforeConnect:
        options.beforeConnect ?? clientConfig.webSocket.beforeConnect,
      protocols: [
        ...(options.protocols ??
          clientConfig.webSocket.protocols ??
          endpoint.protocols ??
          []),
      ],
      request: req,
      attributable,
      callerSignal: call.callerSignal,
      controller: call.scope.controller,
      release: call.scope.release,
      signal,
    },
    attributable ? pick : undefined,
  );
  call.owned = started.session;
  // An interceptor may drop the promise without handling it.
  void started.opened.catch(() => undefined);
  return started.opened;
}

/**
 * The connection the call reports once the chain returned `session`. A session the call built but did not hand
 * out is discarded.
 */
async function deliveredConnection(
  call: Call,
  session: WebSocketSessionLike,
): Promise<WebSocketConnectionInfo> {
  const publicConnection = session.connection;
  call.chainSettled = true;
  const { owned } = call;
  // The delivered session is the one this call built, or a wrapper that shares its `closed` promise.
  if (owned === undefined || !isDelivered(owned, session)) {
    if (owned !== undefined) {
      await discardOwned(
        owned,
        new Error("WebSocket session was replaced by interceptor"),
      );
    }
    return publicConnection;
  }
  // The call reports the first open, for a session that still shows its own live `connection`.
  const first = owned.first;
  const reportsFirst =
    first !== undefined &&
    (first.facade === session || publicConnection === first.facade.connection);
  return reportsFirst ? first.connection : publicConnection;
}

/** Whether `session`, the one the interceptors returned, is the session this call built or wraps it. */
function isDelivered(owned: Session, session: WebSocketSessionLike): boolean {
  return (
    owned.first !== undefined &&
    (owned.first.facade === session || owned.closed.promise === session.closed)
  );
}

/** Ends a session the call does not hand out, and waits until it has let go of its socket. */
async function discardOwned(owned: Session, reason: unknown): Promise<void> {
  owned.controller.abort(reason);
  await owned.closed.promise;
}

/**
 * The outcome of a **single connect attempt**, not the final result of the session.
 *
 * The retry logic uses it to decide whether to try again.
 *
 * - `closeInfo` holds the close details of that attempt: `{ code?, reason?, wasClean? }`.
 *
 * - `connection` is the connection snapshot, when the attempt got one.
 *
 * - `cause` is the error that ended the attempt, if any.
 *
 * - `opened` tells whether the socket reached `open` before it ended.
 *
 * `shouldRetry` does not receive this object. Its context carries `attempt`, `cause`, `code`, `reason`, and `wasClean`, taken from it. The final result of the session is {@link WebSocketCloseInfo}.
 *
 * @group web-socket
 */
export type SocketLifecycleOutcome = {
  closeInfo: WebSocketCloseSnapshot;
  connection?: WebSocketConnectionInfo;
  cause?: unknown;
  opened: boolean;
};

function caughtRequestFault(error: unknown): Fault<undefined> {
  if (!isDefjsFault(error)) {
    return createPreflightFault("EXT_INTERCEPTOR_FAILED", error);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: an interceptor may throw any Defjs fault, which is returned unchanged, but the published SocketAwaitResult error slot is `Fault<undefined>`. Unasserted: TS2322, `AnyFault` is not assignable to `Fault<undefined>`; narrowing would rewrap a thrown HTTP_STATUS fault whose data is not undefined, and widening the slot changes that published declaration
  return error as Fault<undefined>;
}
