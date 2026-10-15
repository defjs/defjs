import { describe, expect, test } from 'vitest'
import type { HttpRequest } from '../http'
import type { EventStreamHandle } from '../sse/transport/event_stream'
import type { SSEInterceptorFn } from './interceptor'
import { createSSEInterceptor, makeChain } from './interceptor'

describe('SSE interceptor chain', () => {
  test('should apply SSE interceptors and pass modified request to handler', async () => {
    const callOrder: string[] = []
    const baseRequest: HttpRequest = {
      endpoint: '/events',
      headers: new Headers(),
      method: 'GET',
    }

    const interceptors: SSEInterceptorFn[] = [
      async (request, next) => {
        callOrder.push('first')
        const headers = new Headers(request.headers)
        headers.set('x-first', '1')
        return next({ ...request, headers })
      },
      async (request, next) => {
        callOrder.push('second')
        const headers = new Headers(request.headers)
        headers.set('x-second', '2')
        return next({ ...request, headers })
      },
    ]

    let capturedRequest: HttpRequest | undefined
    const fakeSSEHandler = async (req: HttpRequest) => {
      capturedRequest = req
      return {} as EventStreamHandle<unknown>
    }

    const chain = makeChain(interceptors)
    await chain(baseRequest, fakeSSEHandler)

    expect(callOrder).toEqual(['first', 'second'])
    expect(capturedRequest?.headers?.get('x-first')).toBe('1')
    expect(capturedRequest?.headers?.get('x-second')).toBe('2')
  })

  test('SSE interceptor can wrap the returned stream', async () => {
    const fakeStream = {
      wrapped: false,
    } as unknown as EventStreamHandle<unknown>

    const interceptor: SSEInterceptorFn = async (req, next) => {
      const stream = await next(req)
      return { ...stream, wrapped: true } as unknown as EventStreamHandle<unknown>
    }

    const chain = makeChain([interceptor])
    const result = await chain({ endpoint: '/events', method: 'GET' }, async () => fakeStream)

    expect((result as unknown as { wrapped: boolean }).wrapped).toBe(true)
  })

  test('createSSEInterceptor should return kind sse', () => {
    const interceptor = createSSEInterceptor((req, next) => next(req))
    expect(interceptor.kind).toBe('sse')
    expect(typeof interceptor.fn).toBe('function')
  })
})
