/**
 * 操作客户端设计的声明原型，仅用于类型审查与编译验收。
 * 不提供运行时实现，也不从任何生产包导出。
 */
import type {
  AnyStruct,
  BuilderInput,
  ClientConfig,
  ClientOption,
  DecodedResponse,
  EventStreamHandle,
  EventStreamOpenInfo,
  FaultOf,
  HttpMeta,
  Infer,
  RequestErrorData,
  RequestSuccessData,
  EventStreamData,
  EventStreamRequestShape,
  EventStructs,
  HttpExecuteOptions,
  HttpRequestShape,
  SocketAwaitResult,
  StructInput,
  WebSocketExecuteOptions,
  WebSocketIncomingData,
  WebSocketOutgoingData,
  WebSocketRequestShape,
} from "@defjs/core";

declare const CLIENT: unique symbol;

/**
 * 单次请求配置，扁平：每个字段只被认识它的协议读取，其余协议忽略。
 * 字段全部来自当前 `execute` 的单次选项，删除了 `timeout` 与 `signal`。
 */
export type RequestOptions = Pick<
  HttpExecuteOptions,
  "onUploadProgress" | "onDownloadProgress"
> &
  Pick<
    WebSocketExecuteOptions,
    "beforeConnect" | "protocols" | "heartbeat" | "reconnect"
  > & { abort?: AbortSignal };

export interface ClientState {
  /** 基础配置：createClient 产生，之后不变。 */
  readonly config: ClientConfig;
  /** 请求配置：每次调用 client(options) 叠加，后来者覆盖前者。 */
  readonly options: RequestOptions;
}

export interface Client {
  (options?: RequestOptions): Client;
  readonly [CLIENT]: ClientState;
}

export declare function createClient(...options: ClientOption[]): Client;

export type EndpointArgs<S extends AnyStruct | undefined> = [S] extends [
  undefined,
]
  ? []
  : undefined extends StructInput<S>
    ? [input?: StructInput<S>]
    : [input: StructInput<S>];

export type RequestEndpoint<
  Args extends unknown[],
  Data,
  ErrorData,
  Response extends HttpMeta,
> = (
  client: Client,
  ...args: Args
) => Promise<
  | [error: null, result: Data, response: Response]
  | [error: FaultOf<ErrorData>, result: undefined, response: undefined]
>;

export type EventStreamEndpoint<
  Args extends unknown[],
  Event,
  ErrorData = undefined,
> = (
  client: Client,
  ...args: Args
) => Promise<
  | [error: null, stream: EventStreamHandle<Event>, open: EventStreamOpenInfo]
  | [
      error: FaultOf<ErrorData>,
      stream: undefined,
      open: EventStreamOpenInfo | undefined,
    ]
>;

export type WebSocketEndpoint<
  Args extends unknown[],
  Incoming,
  Outgoing = never,
> = (
  client: Client,
  ...args: Args
) => Promise<SocketAwaitResult<Incoming, Outgoing>>;

type BuilderField<I, Shape> = [I] extends [undefined]
  ? { builder?: () => Shape }
  : { builder: (input: BuilderInput<I>) => Shape };
type OutputField<O> = [O] extends [undefined]
  ? { output?: never }
  : { output: O };
type ErrorField<E> = [E] extends [undefined] ? { error?: never } : { error: E };
export declare function defineRequest<
  const M extends string,
  const P extends string,
  I extends AnyStruct | undefined = undefined,
  O extends AnyStruct | undefined = undefined,
  E extends AnyStruct | undefined = undefined,
>(
  definition: {
    method: M;
    path: P;
    input?: I;
    operation?: string;
  } & OutputField<O> &
    ErrorField<E> &
    BuilderField<NoInfer<I>, HttpRequestShape<NoInfer<P>, NoInfer<M>>>,
): RequestEndpoint<
  EndpointArgs<I>,
  RequestSuccessData<O>,
  RequestErrorData<E>,
  [O] extends [undefined] ? HttpMeta : DecodedResponse<Infer<O>>
>;
export declare function defineEventStream<
  const P extends string,
  const M extends string = "GET",
  I extends AnyStruct | undefined = undefined,
  Events extends EventStructs = EventStructs,
  E extends AnyStruct | undefined = undefined,
>(
  definition: {
    path: P;
    method?: M;
    input?: I;
    operation?: string;
    events: Events;
    maxBufferSize: number;
    maxQueueSize: number;
  } & ErrorField<E> &
    BuilderField<NoInfer<I>, EventStreamRequestShape<NoInfer<P>, NoInfer<M>>>,
): EventStreamEndpoint<
  EndpointArgs<I>,
  EventStreamData<Events>,
  RequestErrorData<E>
>;
export declare function defineWebSocket<
  const P extends string,
  I extends AnyStruct | undefined = undefined,
  Incoming extends AnyStruct = AnyStruct,
  Outgoing extends AnyStruct | undefined = undefined,
>(
  definition: {
    path: P;
    input?: I;
    operation?: string;
    incoming: Incoming;
    outgoing?: Outgoing;
    protocols?: readonly string[];
    maxIncomingQueueSize: number;
    maxOutgoingQueueSize?: number;
  } & BuilderField<NoInfer<I>, WebSocketRequestShape<NoInfer<P>>>,
): WebSocketEndpoint<
  EndpointArgs<I>,
  WebSocketIncomingData<Incoming>,
  WebSocketOutgoingData<Outgoing>
>;
