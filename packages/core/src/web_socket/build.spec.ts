import { describe, expect, test } from 'vitest'
import type { QuerySerializer } from '../client/config'
import type { RequestBuildValue } from '../internal/request_values'
import { createWebSocketRequest, createWebSocketUrlFromRequest } from './build'

function createWebSocketUrl(
  baseEndpoint: string,
  path: string,
  params: { [key: string]: string } | undefined,
  query: { [key: string]: RequestBuildValue } | undefined,
  querySerializer?: QuerySerializer,
): string {
  const request = createWebSocketRequest({
    abort: new AbortController().signal,
    baseEndpoint,
    params,
    path,
    query,
    querySerializer,
  })

  return createWebSocketUrlFromRequest(request)
}

describe('web socket build helpers', () => {
  test('should create websocket urls and convert http protocols', () => {
    expect(
      createWebSocketUrl(
        'https://api.example.com/v1',
        '/chat/:roomId',
        {
          roomId: '9',
        },
        {
          token: 'abc',
        },
      ),
    ).toBe('wss://api.example.com/v1/chat/9?token=abc')

    expect(createWebSocketUrl('http://api.example.com/v1', '/chat', undefined, undefined)).toBe('ws://api.example.com/v1/chat')
  })

  test('should encode each raw path value exactly once in the final WebSocket URL', () => {
    expect(createWebSocketUrl('https://api.example.com/v1', '/rooms/:roomId', { roomId: 'a/b ?#%猫' }, undefined)).toBe(
      'wss://api.example.com/v1/rooms/a%2Fb%20%3F%23%25%E7%8C%AB',
    )
  })

  test('should convert http to ws and https to wss', () => {
    expect(createWebSocketUrl('http://localhost', '/ws', undefined, undefined)).toBe('ws://localhost/ws')
    expect(createWebSocketUrl('https://localhost', '/ws', undefined, undefined)).toBe('wss://localhost/ws')
    expect(createWebSocketUrl('wss://localhost', '/ws', undefined, undefined)).toBe('wss://localhost/ws')
  })

  test('should reject missing url params', () => {
    expect(() => createWebSocketUrl('http://localhost', '/ws/:id', {}, undefined)).toThrow('Missing path param: id')
    expect(() => createWebSocketUrl('http://localhost', '/ws/:id', undefined, undefined)).toThrow('Missing path param: id')
  })

  test('should serialize query params with undefined value', () => {
    expect(createWebSocketUrl('http://localhost', '/ws', undefined, { a: undefined })).toBe('ws://localhost/ws')
  })

  test('should serialize query params with undefined array item', () => {
    expect(createWebSocketUrl('http://localhost', '/ws', undefined, { tags: ['a', undefined] })).toBe('ws://localhost/ws?tags=a')
  })

  test('should serialize query params with array values', () => {
    expect(createWebSocketUrl('http://localhost', '/ws', undefined, { tags: ['a', 'b'] })).toBe('ws://localhost/ws?tags=a&tags=b')
  })

  test('should reject nested query objects without a serializer', () => {
    expect(() => createWebSocketUrl('http://localhost', '/ws', undefined, { data: { key: 'val' } })).toThrow(
      'a query serializer is required for nested query value "data"',
    )
  })

  test('should reject null query values', () => {
    expect(() => createWebSocketUrl('http://localhost', '/ws', undefined, { data: null })).toThrow(
      'query value for "data" must not be null',
    )
  })

  test('createWebSocketUrl serializes bigint query param', () => {
    expect(createWebSocketUrl('http://localhost', '/ws', undefined, { id: 1n as never })).toBe('ws://localhost/ws?id=1')
  })

  test('createWebSocketUrl serializes number and boolean query params', () => {
    expect(createWebSocketUrl('http://localhost', '/ws', undefined, { active: true, port: 42 })).toBe(
      'ws://localhost/ws?active=true&port=42',
    )
  })

  test('createWebSocketUrlFromRequest converts https to wss', () => {
    const request = createWebSocketRequest({
      abort: new AbortController().signal,
      baseEndpoint: 'https://api.example.com/v1',
      params: { roomId: '9' },
      query: { token: 'abc' },
      operation: 'chat.connect',
      path: '/chat/:roomId',
      withCredentials: false,
    })
    expect(createWebSocketUrlFromRequest(request)).toBe('wss://api.example.com/v1/chat/9?token=abc')
    expect(request.operation).toBe('chat.connect')
  })

  test('createWebSocketUrlFromRequest converts http to ws', () => {
    const request = createWebSocketRequest({
      abort: new AbortController().signal,
      baseEndpoint: 'http://api.example.com/v1',
      params: {},
      query: {},
      path: '/chat',
      withCredentials: false,
    })
    expect(createWebSocketUrlFromRequest(request)).toBe('ws://api.example.com/v1/chat')
  })

  test('createWebSocketUrlFromRequest keeps non-http protocols unchanged', () => {
    const request = createWebSocketRequest({
      abort: new AbortController().signal,
      baseEndpoint: 'wss://api.example.com/v1',
      params: {},
      query: {},
      path: '/chat',
      withCredentials: false,
    })
    expect(createWebSocketUrlFromRequest(request)).toBe('wss://api.example.com/v1/chat')
  })
})
