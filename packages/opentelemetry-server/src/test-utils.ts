import type {
  EventStreamCloseInfo,
  EventStreamFaultCode,
  EventStreamHandle,
  HttpRequest,
  HttpResponse,
  WebSocketCloseInfo,
  WebSocketSessionLike,
} from '@defjs/core'
import { makeResponse } from '@defjs/core'
import type {
  Context,
  Exception,
  Link,
  Span,
  SpanAttributes,
  SpanAttributeValue,
  SpanOptions,
  SpanStatus,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
  TimeInput,
  Tracer,
} from '@opentelemetry/api'
import { vi } from 'vitest'

type MockFn = ReturnType<typeof vi.fn>
type SSECloseCode = 'eof' | 'error' | 'aborted'
function noop(): void {
  return undefined
}

function emptyAsyncIterable(): AsyncIterable<unknown> {
  const iterator: AsyncIterator<unknown> = {
    async next() {
      return { done: true, value: undefined }
    },
  }

  return {
    [Symbol.asyncIterator]() {
      return iterator
    },
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
}

export type MockSpan = Omit<
  Span,
  | 'setAttribute'
  | 'setAttributes'
  | 'addEvent'
  | 'addLink'
  | 'addLinks'
  | 'setStatus'
  | 'updateName'
  | 'end'
  | 'isRecording'
  | 'recordException'
> & {
  setAttribute: ((key: string, value: SpanAttributeValue) => MockSpan) & MockFn
  setAttributes: ((attributes: SpanAttributes) => MockSpan) & MockFn
  addEvent: ((name: string, attributesOrStartTime?: SpanAttributes | TimeInput, startTime?: TimeInput) => MockSpan) & MockFn
  addLink: ((link: Link) => MockSpan) & MockFn
  addLinks: ((links: Link[]) => MockSpan) & MockFn
  setStatus: ((status: SpanStatus) => MockSpan) & MockFn
  updateName: ((name: string) => MockSpan) & MockFn
  end: ((endTime?: TimeInput) => void) & MockFn
  isRecording: (() => boolean) & MockFn
  recordException: ((exception: Exception, time?: TimeInput) => void) & MockFn

  name: string
  kind: number
  attributes: { [key: string]: unknown }
  status?: { code: number }
  ended: boolean
}

export let activeSpans: MockSpan[]

export interface MockTracer extends Tracer {
  startSpan(name: string, options?: SpanOptions, context?: Context): MockSpan
}

export function createMockPropagator(): TextMapPropagator<Headers> {
  return {
    inject: vi.fn((_ctx: Context, carrier: Headers, _setter?: TextMapSetter<Headers>) => {
      carrier.set('traceparent', 'mock-trace-id')
    }),
    extract: vi.fn((ctx: Context, _carrier?: Headers, _getter?: TextMapGetter<Headers>) => ctx),
    fields: vi.fn(() => ['traceparent', 'tracestate']),
  }
}

export function createMockTracer() {
  activeSpans = []

  const startSpan = vi.fn(
    (_name: string, options?: { kind?: number; attributes?: { [key: string]: unknown } }, _ctx?: Context): MockSpan => {
      const span: MockSpan = {
        name: _name,
        kind: options?.kind ?? 0,
        attributes: { ...(options?.attributes ?? {}) },
        status: undefined,
        ended: false,
        spanContext: () => ({
          traceId: 'aabbccddeeff00112233445566778899',
          spanId: 'aabbccddeeff0011',
          traceFlags: 1,
          isRemote: false,
        }),
        setAttribute: vi.fn((key: string, value: SpanAttributeValue) => {
          span.attributes[key] = value
          return span
        }),
        setAttributes: vi.fn((attributes: SpanAttributes) => {
          for (const [key, value] of Object.entries(attributes)) {
            if (value !== undefined) {
              span.attributes[key] = value
            }
          }
          return span
        }),
        addEvent: vi.fn((_eventName: string, _attributesOrStartTime?: SpanAttributes | TimeInput, _startTime?: TimeInput) => span),
        addLink: vi.fn((_link: Link) => span),
        addLinks: vi.fn((_links: Link[]) => span),
        setStatus: vi.fn((status: SpanStatus) => {
          span.status = status
          return span
        }),
        updateName: vi.fn((_newName: string) => span),
        end: vi.fn((_endTime?: TimeInput) => {
          span.ended = true
        }),
        isRecording: vi.fn(() => !span.ended),
        recordException: vi.fn((_exception: Exception, _time?: TimeInput) => noop()),
      }
      activeSpans.push(span)
      return span
    },
  )

  const tracer: MockTracer = {
    startSpan,
    startActiveSpan: vi.fn(),
  }

  return { tracer, spans: activeSpans }
}

export function createMockMetrics() {
  return {
    requestDuration: { record: vi.fn() },
    connectDuration: { record: vi.fn() },
    connectionDuration: { record: vi.fn() },
    activeStreams: { add: vi.fn() },
    activeConnections: { add: vi.fn() },
  }
}

export function makeHttpRequest(headers?: Headers): HttpRequest {
  return {
    method: 'GET',
    endpoint: '/test',
    baseEndpoint: 'https://api.example.com',
    headers: headers ?? new Headers(),
  }
}

export function makeHttpResponse<R = unknown>(body?: R | null): HttpResponse<R> {
  return makeResponse({
    body,
    headers: new Headers(),
    status: 200,
    statusText: 'OK',
    url: 'https://api.example.com/test',
  })
}

export function makeSSERequest(headers?: Headers): HttpRequest {
  return {
    method: 'GET',
    endpoint: '/events',
    baseEndpoint: 'https://api.example.com',
    headers: headers ?? new Headers(),
  }
}

function makeSSEHandleBase(closed: Promise<EventStreamCloseInfo>, close: (reason?: unknown) => void = noop): EventStreamHandle<unknown> {
  let disposeTask: Promise<void> | undefined
  const handle: EventStreamHandle<unknown> = {
    open: {
      response: makeHttpResponse(null),
      url: 'https://api.example.com/events',
    },
    closed,
    close,
    [Symbol.asyncDispose]() {
      return (disposeTask ??= Promise.resolve()
        .then(() => {
          handle.close()
          return handle.closed
        })
        .then(noop))
    },
    async *[Symbol.asyncIterator]() {
      // no events
    },
  }
  return handle
}

export function makeSSEStream(closeCode: SSECloseCode = 'eof', closeCause?: unknown): EventStreamHandle<unknown> {
  const closed = Promise.resolve(makeSSECloseInfo(closeCode, closeCause))
  return makeSSEHandleBase(closed)
}

export function makeDeferredSSEStream() {
  const closed = createDeferred<EventStreamCloseInfo>()
  const stream = makeSSEHandleBase(closed.promise, (reason) => {
    closed.resolve(makeSSECloseInfo('aborted', reason))
  })

  return {
    stream,
    close(kind: SSECloseCode = 'eof', cause?: unknown, code?: EventStreamFaultCode) {
      closed.resolve(makeSSECloseInfo(kind, cause, code))
    },
    reject(error: unknown) {
      closed.reject(error)
    },
  }
}

function makeSSECloseInfo(kind: SSECloseCode, cause?: unknown, code: EventStreamFaultCode = 'NET_UNREACHABLE'): EventStreamCloseInfo {
  return kind === 'error' ? { cause, code, kind, reason: '' } : { cause, kind, reason: '' }
}

export function makeSSEStreamError(error: unknown): EventStreamHandle<unknown> {
  const closed = Promise.reject<EventStreamCloseInfo>(error)
  return makeSSEHandleBase(closed)
}

export function makeWsRequest(queryParams?: URLSearchParams, headers?: Headers): HttpRequest {
  return {
    method: 'GET',
    endpoint: '/ws',
    baseEndpoint: 'wss://api.example.com',
    queryParams: queryParams ?? new URLSearchParams(),
    queryString: queryParams?.toString() ?? '',
    headers: headers ?? new Headers(),
  }
}

export function makeWsSession(): WebSocketSessionLike {
  return createWsSession(Promise.resolve({ kind: 'closed' }))
}

export function makeDeferredWsSession() {
  const closed = createDeferred<WebSocketCloseInfo>()
  return {
    session: createWsSession(closed.promise),
    close(info: WebSocketCloseInfo = { kind: 'closed' }) {
      closed.resolve(info)
    },
    reject(error: unknown) {
      closed.reject(error)
    },
  }
}

export function makeWsSessionError(error: unknown): WebSocketSessionLike {
  return createWsSession(Promise.reject(error))
}

export function waitForSettledPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: (value: T) => void = noop
  let rejectValue: (reason?: unknown) => void = noop

  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve
    rejectValue = reject
  })

  return {
    promise,
    resolve: resolveValue,
    reject: rejectValue,
  }
}

function createWsSession(closed: Promise<WebSocketCloseInfo>): WebSocketSessionLike {
  let disposeTask: Promise<void> | undefined
  const session: WebSocketSessionLike = {
    bufferedAmount: 0,
    connection: { generation: 1 },
    closed,
    receive: emptyAsyncIterable(),
    state: 'open',
    close: noop,
    onRuntimeError: () => noop,
    onStateChange: () => noop,
    send: noop,
    [Symbol.asyncDispose]() {
      return (disposeTask ??= Promise.resolve()
        .then(() => {
          session.close()
          return session.closed
        })
        .then(noop))
    },
  }
  return session
}
