import type { HttpRequest } from '../internal/http_request'
import type { HttpResponse } from '../internal/http_response'
import type { EventStreamHandle } from '../sse/transport/event_stream'
import type { WebSocketCloseInfo, WebSocketState } from '../web_socket/web_socket'
import type {
  HttpInterceptorNext,
  InterceptorFn,
  SSEHandler,
  SSEInterceptorFn,
  WebSocketHandler,
  WebSocketInterceptorFn,
  WebSocketSessionLike,
} from './interceptor'
import { createHttpInterceptor, type makeChain } from './interceptor'
import type { HttpInterceptor, SSEInterceptor } from './index'
import { basicAuthHttpInterceptor, basicAuthSSEInterceptor } from './index'

type IsAny<T> = 0 extends 1 & T ? true : false
type ParametersOf<T> = T extends (...args: infer P) => unknown ? P : never
type SecondParameter<T> = ParametersOf<T> extends [unknown, infer P, ...unknown[]] ? P : never
type ContainsAny<T> =
  IsAny<T> extends true
    ? true
    : [T] extends [never]
      ? false
      : T extends (...args: infer Args) => infer Result
        ? ContainsAny<Args> extends true
          ? true
          : ContainsAny<Result>
        : T extends Promise<infer Value>
          ? ContainsAny<Value>
          : T extends HttpResponse<infer Body>
            ? ContainsAny<Body>
            : T extends EventStreamHandle<infer Event>
              ? ContainsAny<Event>
              : T extends readonly unknown[]
                ? number extends T['length']
                  ? ContainsAny<T[number]>
                  : ContainsAnyTuple<T>
                : false
type ContainsAnyTuple<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Tail]
  ? ContainsAny<Head> extends true
    ? true
    : ContainsAnyTuple<Tail>
  : false
type StrictEqual<A, B> =
  ContainsAny<A> extends true ? false : ContainsAny<B> extends true ? false : [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T

const httpInterceptor = basicAuthHttpInterceptor(() => ({
  password: 'secret',
  username: 'miao',
}))

const sseInterceptor = basicAuthSSEInterceptor(() => ({
  password: 'secret',
  username: 'miao',
}))

type HttpInterceptorCase = Expect<StrictEqual<typeof httpInterceptor, HttpInterceptor>>
type SSEInterceptorCase = Expect<StrictEqual<typeof sseInterceptor, SSEInterceptor>>

type HttpChain = typeof makeChain<HttpRequest, Promise<HttpResponse<unknown>>>
type SSEChain = typeof makeChain<HttpRequest, Promise<EventStreamHandle<unknown>>>
type WebSocketChain = typeof makeChain<HttpRequest, Promise<WebSocketSessionLike>>

type MakeHttpChainCase = Expect<StrictEqual<ReturnType<HttpChain>, InterceptorFn>>
type MakeSSEChainCase = Expect<StrictEqual<ReturnType<SSEChain>, SSEInterceptorFn>>
type MakeWebSocketChainCase = Expect<StrictEqual<ReturnType<WebSocketChain>, WebSocketInterceptorFn>>

type HttpChainParametersCase = Expect<StrictEqual<ParametersOf<ReturnType<HttpChain>>, [HttpRequest, HttpInterceptorNext]>>
type SSEChainParametersCase = Expect<StrictEqual<ParametersOf<ReturnType<SSEChain>>, [HttpRequest, SSEHandler]>>
type WebSocketChainParametersCase = Expect<StrictEqual<ParametersOf<ReturnType<WebSocketChain>>, [HttpRequest, WebSocketHandler]>>

type HttpChainNextCase = Expect<StrictEqual<SecondParameter<ReturnType<HttpChain>>, HttpInterceptorNext>>
type SSEChainNextCase = Expect<StrictEqual<SecondParameter<ReturnType<SSEChain>>, SSEHandler>>
type WebSocketChainNextCase = Expect<StrictEqual<SecondParameter<ReturnType<WebSocketChain>>, WebSocketHandler>>

type HttpChainResultCase = Expect<StrictEqual<ReturnType<ReturnType<HttpChain>>, Promise<HttpResponse<unknown>>>>
type SSEChainResultCase = Expect<StrictEqual<ReturnType<ReturnType<SSEChain>>, Promise<EventStreamHandle<unknown>>>>
type WebSocketChainResultCase = Expect<StrictEqual<ReturnType<ReturnType<WebSocketChain>>, Promise<WebSocketSessionLike>>>
type WebSocketBufferedAmountCase = Expect<StrictEqual<WebSocketSessionLike['bufferedAmount'], number>>
type WebSocketConnectionCase = Expect<
  StrictEqual<WebSocketSessionLike['connection'], { extensions?: string; generation: number; protocol?: string; url?: string }>
>
type WebSocketClosedCase = Expect<StrictEqual<WebSocketSessionLike['closed'], Promise<WebSocketCloseInfo>>>
type WebSocketDisposableCase = Expect<WebSocketSessionLike extends AsyncDisposable ? true : false>
type WebSocketDisposeResultCase = Expect<StrictEqual<ReturnType<WebSocketSessionLike[typeof Symbol.asyncDispose]>, PromiseLike<void>>>
type WebSocketStateCase = Expect<StrictEqual<WebSocketSessionLike['state'], WebSocketState>>
type WebSocketStateListenerCase = Expect<StrictEqual<Parameters<WebSocketSessionLike['onStateChange']>[0], (state: WebSocketState) => void>>

basicAuthHttpInterceptor(
  () => ({
    password: 'secret',
    username: 'miao',
  }),
  {
    encode: (credential) => `${credential.username}:${credential.password}`,
  },
)

// @ts-expect-error password is required
basicAuthHttpInterceptor(() => ({
  username: 'miao',
}))

// @ts-expect-error encode must return a string
basicAuthHttpInterceptor(() => ({ password: 'secret', username: 'miao' }), { encode: () => 1 })

// @ts-expect-error HTTP interceptors must return internal HttpResponse values, not native Response.
createHttpInterceptor(async () => new Response('ok', { status: 200 }))

// @ts-expect-error password is required
basicAuthSSEInterceptor(() => ({
  username: 'miao',
}))

export type Cases =
  | HttpChainNextCase
  | HttpChainParametersCase
  | HttpChainResultCase
  | HttpInterceptorCase
  | MakeHttpChainCase
  | MakeSSEChainCase
  | MakeWebSocketChainCase
  | SSEChainNextCase
  | SSEChainParametersCase
  | SSEChainResultCase
  | SSEInterceptorCase
  | WebSocketChainNextCase
  | WebSocketChainParametersCase
  | WebSocketChainResultCase
  | WebSocketBufferedAmountCase
  | WebSocketClosedCase
  | WebSocketConnectionCase
  | WebSocketDisposableCase
  | WebSocketDisposeResultCase
  | WebSocketStateCase
  | WebSocketStateListenerCase
