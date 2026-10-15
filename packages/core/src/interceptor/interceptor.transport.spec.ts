import { describe, expect, test } from 'vitest'
import type { Interceptor } from './interceptor'
import {
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
  resolveHttpInterceptors,
  resolveSSEInterceptors,
  resolveWebSocketInterceptors,
} from './interceptor'

describe('interceptor transport resolution', () => {
  const httpInterceptor = createHttpInterceptor((req, next) => next(req))
  const sseInterceptor = createSSEInterceptor((req, next) => next(req))
  const wsInterceptor = createWebSocketInterceptor((req, next) => next(req))

  test('resolveHttpInterceptors should only extract http interceptors', () => {
    const interceptors: Interceptor[] = [httpInterceptor, sseInterceptor]
    const result = resolveHttpInterceptors(interceptors)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(httpInterceptor.fn)
  })

  test('resolveSSEInterceptors should only extract sse interceptors', () => {
    const interceptors: Interceptor[] = [httpInterceptor, sseInterceptor]
    const result = resolveSSEInterceptors(interceptors)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(sseInterceptor.fn)
  })

  test('resolveHttpInterceptors should return empty array when no http interceptors', () => {
    const interceptors: Interceptor[] = [sseInterceptor]
    const result = resolveHttpInterceptors(interceptors)
    expect(result).toHaveLength(0)
  })

  test('resolveSSEInterceptors should return empty array when no sse interceptors', () => {
    const interceptors: Interceptor[] = [httpInterceptor]
    const result = resolveSSEInterceptors(interceptors)
    expect(result).toHaveLength(0)
  })

  test('should preserve order of interceptors', () => {
    const http1 = createHttpInterceptor((req, next) => next(req))
    const http2 = createHttpInterceptor((req, next) => next(req))
    const sse1 = createSSEInterceptor((req, next) => next(req))

    const interceptors: Interceptor[] = [http1, sse1, http2]
    const httpFns = resolveHttpInterceptors(interceptors)

    expect(httpFns).toHaveLength(2)
    expect(httpFns[0]).toBe(http1.fn)
    expect(httpFns[1]).toBe(http2.fn)
  })

  test('should handle empty interceptor array', () => {
    expect(resolveHttpInterceptors([])).toHaveLength(0)
    expect(resolveSSEInterceptors([])).toHaveLength(0)
  })

  test('resolveWebSocketInterceptors should only extract web-socket interceptors', () => {
    const interceptors: Interceptor[] = [httpInterceptor, sseInterceptor, wsInterceptor]
    const result = resolveWebSocketInterceptors(interceptors)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(wsInterceptor.fn)
  })

  test('resolveWebSocketInterceptors should return empty array when no ws interceptors', () => {
    const interceptors: Interceptor[] = [httpInterceptor, sseInterceptor]
    const result = resolveWebSocketInterceptors(interceptors)
    expect(result).toHaveLength(0)
  })

  test('should preserve order of all interceptor types', () => {
    const ws1 = createWebSocketInterceptor((req, next) => next(req))
    const ws2 = createWebSocketInterceptor((req, next) => next(req))

    const interceptors: Interceptor[] = [ws1, httpInterceptor, ws2]
    const wsFns = resolveWebSocketInterceptors(interceptors)

    expect(wsFns).toHaveLength(2)
    expect(wsFns[0]).toBe(ws1.fn)
    expect(wsFns[1]).toBe(ws2.fn)
  })

  test('createWebSocketInterceptor should return kind web-socket', () => {
    const interceptor = createWebSocketInterceptor((req, next) => next(req))
    expect(interceptor.kind).toBe('web-socket')
    expect(typeof interceptor.fn).toBe('function')
  })
})
