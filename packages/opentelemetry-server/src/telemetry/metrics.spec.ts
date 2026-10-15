import { describe, expect, test, vi } from 'vitest'
import { makeHttpRequest, makeHttpResponse } from '../test-utils'
import {
  createConnectionMetricAttributes,
  createErrorMetricAttributes,
  createHttpClientMetrics,
  createHttpMetricAttributes,
  createServerMetricAttributes,
  createSSEClientMetrics,
  createWebSocketClientMetrics,
  durationSeconds,
} from './metrics'

describe('metrics helpers', () => {
  test('createHttpClientMetrics creates stable HTTP duration metric', () => {
    const meter = makeMeter()

    const metrics = createHttpClientMetrics(meter)

    expect(meter.createHistogram).toHaveBeenCalledWith(
      'http.client.request.duration',
      expect.objectContaining({
        unit: 's',
        advice: expect.objectContaining({ explicitBucketBoundaries: expect.any(Array) }),
      }),
    )
    expect(metrics.requestDuration).toBe(histogram)
  })

  test('createSSEClientMetrics creates SSE custom metrics', () => {
    const meter = makeMeter()

    const metrics = createSSEClientMetrics(meter)

    expect(meter.createHistogram).toHaveBeenCalledWith('defjs.client.sse.connect.duration', expect.objectContaining({ unit: 's' }))
    expect(meter.createHistogram).toHaveBeenCalledWith('defjs.client.sse.connection.duration', expect.objectContaining({ unit: 's' }))
    expect(meter.createUpDownCounter).toHaveBeenCalledWith('defjs.client.sse.active_streams', expect.objectContaining({ unit: '{stream}' }))
    expect(metrics.connectDuration).toBe(histogram)
    expect(metrics.connectionDuration).toBe(histogram)
    expect(metrics.activeStreams).toBe(upDownCounter)
  })

  test('createWebSocketClientMetrics creates WebSocket custom metrics', () => {
    const meter = makeMeter()

    const metrics = createWebSocketClientMetrics(meter)

    expect(meter.createHistogram).toHaveBeenCalledWith('defjs.client.websocket.connect.duration', expect.objectContaining({ unit: 's' }))
    expect(meter.createHistogram).toHaveBeenCalledWith('defjs.client.websocket.connection.duration', expect.objectContaining({ unit: 's' }))
    expect(meter.createUpDownCounter).toHaveBeenCalledWith(
      'defjs.client.websocket.active_connections',
      expect.objectContaining({ unit: '{connection}' }),
    )
    expect(metrics.connectDuration).toBe(histogram)
    expect(metrics.connectionDuration).toBe(histogram)
    expect(metrics.activeConnections).toBe(upDownCounter)
  })

  test('durationSeconds uses explicit end time', () => {
    expect(durationSeconds(100, 250)).toBe(0.15)
  })

  test('durationSeconds defaults to performance.now', () => {
    vi.spyOn(performance, 'now').mockReturnValue(350)

    expect(durationSeconds(50)).toBe(0.3)
  })

  test('createHttpMetricAttributes includes status when response is present', () => {
    expect(createHttpMetricAttributes(makeHttpRequest(), makeHttpResponse())).toEqual({
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'server.address': 'api.example.com',
    })
  })

  test.each([404, 503])('createHttpMetricAttributes classifies client error status %i', (status) => {
    expect(createHttpMetricAttributes(makeHttpRequest(), { ...makeHttpResponse(), status })).toEqual({
      'error.type': String(status),
      'http.request.method': 'GET',
      'http.response.status_code': status,
      'server.address': 'api.example.com',
    })
  })

  test('createHttpMetricAttributes omits both status and error type for a status-0 response', () => {
    // Transport failures are faults now, so status 0 carries no failure to report.
    expect(createHttpMetricAttributes(makeHttpRequest(), { ...makeHttpResponse(), status: 0 })).toEqual({
      'http.request.method': 'GET',
      'server.address': 'api.example.com',
    })
  })

  test('createHttpMetricAttributes includes error when request throws', () => {
    expect(createHttpMetricAttributes(makeHttpRequest(), undefined, new TypeError('boom'))).toEqual({
      'error.type': 'TypeError',
      'http.request.method': 'GET',
      'server.address': 'api.example.com',
    })
  })

  test('createConnectionMetricAttributes merges custom extras', () => {
    expect(createConnectionMetricAttributes(makeHttpRequest(), 'error', { 'error.type': 'string' })).toEqual({
      'defjs.result': 'error',
      'error.type': 'string',
      'server.address': 'api.example.com',
    })
  })

  test('createServerMetricAttributes includes explicit server port', () => {
    expect(createServerMetricAttributes({ ...makeHttpRequest(), baseEndpoint: 'https://api.example.com:8443' })).toEqual({
      'server.address': 'api.example.com',
      'server.port': 8443,
    })
  })

  test('uses only the explicit operation as the metric identity', () => {
    expect(createServerMetricAttributes({ ...makeHttpRequest(), endpoint: '/users/42', operation: 'users.read' })).toEqual({
      'defjs.operation': 'users.read',
      'server.address': 'api.example.com',
    })
  })

  test('createServerMetricAttributes returns empty object for relative URL without base', () => {
    expect(createServerMetricAttributes({ ...makeHttpRequest(), baseEndpoint: undefined })).toEqual({})
  })

  test('createErrorMetricAttributes returns empty object for nullish errors', () => {
    expect(createErrorMetricAttributes(undefined)).toEqual({})
    expect(createErrorMetricAttributes(null)).toEqual({})
  })

  test('createErrorMetricAttributes falls back to Error when name is empty', () => {
    const error = new Error('boom')
    error.name = ''

    expect(createErrorMetricAttributes(error)).toEqual({ 'error.type': 'Error' })
  })

  test('createErrorMetricAttributes uses typeof for non-Error values', () => {
    expect(createErrorMetricAttributes('user 123 failed')).toEqual({ 'error.type': 'string' })
    expect(createErrorMetricAttributes(123)).toEqual({ 'error.type': 'number' })
    expect(createErrorMetricAttributes({ message: 'boom' })).toEqual({ 'error.type': 'object' })
  })
})

const histogram = { record: vi.fn() }
const upDownCounter = { add: vi.fn() }

function makeMeter() {
  return {
    createCounter: vi.fn(),
    createHistogram: vi.fn(() => histogram),
    createGauge: vi.fn(),
    createUpDownCounter: vi.fn(() => upDownCounter),
    createObservableCounter: vi.fn(),
    createObservableGauge: vi.fn(),
    createObservableUpDownCounter: vi.fn(),
    addBatchObservableCallback: vi.fn(),
    removeBatchObservableCallback: vi.fn(),
  }
}
