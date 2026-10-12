import { createNetworkFault, createUndecodedHttpStatusFault, ERR_ABORTED, ERR_TIMEOUT } from '@defjs/core'
import { diag, ROOT_CONTEXT } from '@opentelemetry/api'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMockLogger, makeHttpRequest, makeHttpResponse } from '../test-utils'
import { emitClientException } from './logs'

describe('client exception logs', () => {
  afterEach(() => vi.restoreAllMocks())

  test.each([
    {
      transport: 'http',
      eventName: 'http.client.request.exception',
      body: 'HTTP client request failed',
      extras: { 'http.request.method': 'GET' },
    },
    {
      transport: 'sse',
      eventName: 'defjs.client.sse.exception',
      body: 'SSE client connection failed',
      extras: { 'defjs.sse.fault.code': 'NET_UNREACHABLE' },
    },
    {
      transport: 'websocket',
      eventName: 'defjs.client.websocket.exception',
      body: 'WebSocket client connection failed',
      extras: { 'websocket.close.code': 1006 },
    },
  ] as const)('emits a safe correlated WARN for $transport', ({ transport, eventName, body, extras }) => {
    const { logger, records } = createMockLogger()
    emitClientException(logger, {
      context: ROOT_CONTEXT,
      error: new TypeError('password=secret'),
      phase: 'connect',
      request: {
        ...makeHttpRequest(new Headers({ authorization: 'secret' })),
        baseEndpoint: 'https://user:secret@api.example.com:8443',
        endpoint: '/secret',
        body: 'secret',
        queryString: 'token=secret',
        operation: 'orders.create',
      },
      transport,
      closeInfo: { code: transport === 'sse' ? 'NET_UNREACHABLE' : 1006 },
    })
    expect(records).toEqual([
      {
        eventName,
        body,
        context: ROOT_CONTEXT,
        severityNumber: 13,
        severityText: 'WARN',
        attributes: {
          'defjs.operation': 'orders.create',
          'server.address': 'api.example.com',
          'server.port': 8443,
          'defjs.phase': 'connect',
          'exception.type': 'TypeError',
          ...extras,
        },
      },
    ])
    expect(JSON.stringify(records)).not.toContain('secret')
  })

  test.each([ERR_ABORTED, new DOMException('cancelled', 'AbortError'), createNetworkFault(ERR_ABORTED)])(
    'does not turn caller cancellation into a diagnostic: %s',
    (error) => {
      const { logger, records } = createMockLogger()
      emitClientException(logger, { context: ROOT_CONTEXT, error, phase: 'request', request: makeHttpRequest(), transport: 'http' })
      expect(records).toEqual([])
    },
  )

  test.each([
    [ERR_TIMEOUT, 'Error'],
    [new DOMException('timeout', 'TimeoutError'), 'TimeoutError'],
    [createNetworkFault(ERR_TIMEOUT), 'DefjsFault'],
    ['private-string', 'string'],
    [17, 'number'],
    [null, '_OTHER'],
    [undefined, '_OTHER'],
    [{ details: 'secret' }, 'object'],
  ])('retains non-cancellation diagnostics without serializing their cause: %s', (error, type) => {
    const { logger, records } = createMockLogger()
    emitClientException(logger, { context: ROOT_CONTEXT, error, phase: 'request', request: makeHttpRequest(), transport: 'http' })
    expect(records).toHaveLength(1)
    expect(records[0]?.attributes?.['exception.type']).toBe(type)
    expect(records[0]?.severityNumber).toBe(13)
    expect(JSON.stringify(records)).not.toContain('private-string')
    expect(JSON.stringify(records)).not.toContain('secret')
  })

  test('omits an artificial HTTP status exception but retains a failed SSE handshake', () => {
    const { logger, records } = createMockLogger()
    const error = createUndecodedHttpStatusFault({ ...makeHttpResponse(), status: 503 })
    emitClientException(logger, { context: ROOT_CONTEXT, error, phase: 'request', request: makeHttpRequest(), transport: 'http' })
    expect(records).toEqual([])
    emitClientException(logger, { context: ROOT_CONTEXT, error, phase: 'connect', request: makeHttpRequest(), transport: 'sse' })
    expect(records).toHaveLength(1)
    expect(records[0]?.attributes?.['exception.type']).toBe('DefjsFault')
  })

  test('omits unavailable close metadata', () => {
    const { logger, records } = createMockLogger()
    for (const transport of ['sse', 'websocket'] as const) {
      emitClientException(logger, {
        context: ROOT_CONTEXT,
        error: new Error('offline'),
        phase: 'connect',
        request: makeHttpRequest(),
        transport,
      })
    }
    expect(records).toHaveLength(2)
    for (const record of records) {
      expect(record.attributes).toEqual({ 'defjs.phase': 'connect', 'exception.type': 'Error', 'server.address': 'api.example.com' })
    }
  })

  test('does not read error attributes without a logger', () => {
    const readName = vi.fn(() => {
      throw new Error('must not read')
    })
    const error = Object.defineProperty(new Error('private'), 'name', { get: readName })
    expect(() =>
      emitClientException(undefined, { context: ROOT_CONTEXT, error, phase: 'request', request: makeHttpRequest(), transport: 'http' }),
    ).not.toThrow()
    expect(readName).not.toHaveBeenCalled()
  })

  test.each(['emit', 'name', 'code', 'close-code', 'diag'] as const)('isolates %s failures from callers', (failure) => {
    const { logger } = createMockLogger()
    const report = vi.spyOn(diag, 'error').mockImplementation(() => {
      if (failure === 'diag') throw new Error('diagnostics failed')
    })
    const error = new Error('original private failure')
    if (failure === 'name' || failure === 'code') {
      Object.defineProperty(error, failure, {
        get() {
          throw new Error('private getter failure')
        },
      })
    } else if (failure !== 'close-code') {
      logger.emit.mockImplementation(() => {
        throw new Error('private exporter failure')
      })
    }
    const closeInfo =
      failure === 'close-code'
        ? {
            get code(): number {
              throw new Error('private close detail')
            },
          }
        : undefined
    expect(() =>
      emitClientException(logger, {
        context: ROOT_CONTEXT,
        error,
        phase: 'connection',
        request: makeHttpRequest(),
        transport: 'websocket',
        closeInfo,
      }),
    ).not.toThrow()
    expect(report).toHaveBeenCalledExactlyOnceWith('@defjs/opentelemetry-server: failed to emit client diagnostic log')
  })
})
