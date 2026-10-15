import { describe, expect, test, vi } from 'vitest'
import { BodyFailure, isBodyFailure } from './body_failure'
import { fetchHandler } from './fetch'

const META = {
  headers: new Headers(),
  ok: true,
  status: 200,
  statusText: 'OK',
  url: 'https://example.com/x',
}

describe('BodyFailure', () => {
  test('should carry the failing step, the cause, and the response metadata', () => {
    const cause = new Error('boom')
    const failure = new BodyFailure('NET_BODY_INCOMPLETE', cause, META)

    expect(failure).toBeInstanceOf(Error)
    expect(failure.name).toBe('BodyFailure')
    expect(failure.code).toBe('NET_BODY_INCOMPLETE')
    expect(failure.cause).toBe(cause)
    expect(failure.meta).toBe(META)
    expect(failure.message).toBe('boom')
  })

  test('should stringify a non-error cause', () => {
    expect(new BodyFailure('RES_DECODE_FAILED', 'not json', META).message).toBe('not json')
  })

  test('should recognize only its own instances', () => {
    expect(isBodyFailure(new BodyFailure('RES_DECODE_FAILED', new Error('x'), META))).toBe(true)
    expect(isBodyFailure(new Error('x'))).toBe(false)
    expect(isBodyFailure(undefined)).toBe(false)
  })
})

describe('body failure classification in the fetch transport', () => {
  function streamThatErrors(cause: unknown): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(cause)
      },
    })
  }

  test('should report a download observer that throws as EXT_OBSERVER_FAILED', async () => {
    const observerError = new Error('observer exploded')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'))
        controller.close()
      },
    })

    const pending = fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        downloadProgress: vi.fn(() => {
          throw observerError
        }),
        endpoint: '/observer',
        method: 'GET',
        responseType: 'text',
      },
      async () => new Response(body, { status: 200, statusText: 'OK' }),
    )

    await expect(pending).rejects.toSatisfy(
      (failure: unknown) => isBodyFailure(failure) && failure.code === 'EXT_OBSERVER_FAILED' && failure.cause === observerError,
    )
  })

  test('should report a reader that fails mid-download as NET_BODY_INCOMPLETE', async () => {
    const readError = new Error('read failed')

    const pending = fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        endpoint: '/read-error',
        method: 'GET',
        responseType: 'text',
      },
      async () => new Response(streamThatErrors(readError), { status: 200, statusText: 'OK' }),
    )

    const failure = await pending.catch((cause: unknown) => cause)
    expect(isBodyFailure(failure)).toBe(true)
    expect((failure as BodyFailure).code).toBe('NET_BODY_INCOMPLETE')
    expect((failure as BodyFailure).cause).toBe(readError)
    expect((failure as BodyFailure).meta).toMatchObject({ ok: true, status: 200, statusText: 'OK' })
  })

  test('should report a reader that fails while an observer is attached as NET_BODY_INCOMPLETE', async () => {
    const readError = new Error('read failed with progress')

    const pending = fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        downloadProgress: vi.fn(),
        endpoint: '/read-error-progress',
        method: 'GET',
        responseType: 'text',
      },
      async () => new Response(streamThatErrors(readError), { status: 200, statusText: 'OK' }),
    )

    await expect(pending).rejects.toSatisfy(
      (failure: unknown) => isBodyFailure(failure) && failure.code === 'NET_BODY_INCOMPLETE' && failure.cause === readError,
    )
  })

  test('should report an unreadable representation as RES_DECODE_FAILED', async () => {
    const pending = fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        endpoint: '/bad-json',
        method: 'GET',
        responseType: 'json',
      },
      async () => new Response('{ not json', { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } }),
    )

    const failure = await pending.catch((cause: unknown) => cause)
    expect(isBodyFailure(failure)).toBe(true)
    expect((failure as BodyFailure).code).toBe('RES_DECODE_FAILED')
    expect((failure as BodyFailure).meta).toMatchObject({ status: 200 })
  })
})
