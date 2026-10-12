import { describe, expect, inject, test } from 'vitest'
import type { FetchHandle } from '../client'
import { createClient, withEndpoint, withHTTPHandle, withInterceptors } from '../client'
import { createHttpInterceptor } from '../interceptor'
import { struct } from '../struct'
import { defineRequest } from './index'
import type { HttpExecuteOptions } from './http'
import { supportsStreamingRequestBody } from './transport/fetch'

const observerModes = ['sync', 'async', 'rejected-promise'] as const
const startBodyKinds = ['Blob', 'ArrayBuffer'] as const
const laterBodyKinds = ['ReadableStream', 'Blob'] as const

type ObserverMode = (typeof observerModes)[number]
type UploadBodyKind = 'ArrayBuffer' | 'Blob' | 'ReadableStream'
type UploadBody = ArrayBuffer | Blob | ReadableStream<Uint8Array>

const streaming = supportsStreamingRequestBody()

const startCases = startBodyKinds.flatMap((kind) => observerModes.map((mode) => ({ kind, mode })))
const laterChunkCases = laterBodyKinds.flatMap((kind) =>
  observerModes.flatMap((mode) => (['platform', 'custom'] as const).map((transport) => ({ kind, mode, transport }))),
)
const swallowCases = laterBodyKinds.flatMap((kind) => observerModes.map((mode) => ({ kind, mode })))
const abortErrorCases = [
  { kind: 'Blob', phase: 'start event', transport: 'platform', when: 'immediately' },
  { kind: 'ReadableStream', phase: 'later chunk', transport: 'platform', when: 'after-first' },
  { kind: 'ReadableStream', phase: 'later chunk read by a custom handle', transport: 'custom', when: 'after-first' },
] as const

describe('upload progress observer failures', () => {
  test.skipIf(!streaming).each(startCases)(
    'should report $mode failure of the $kind upload start observer as EXT_OBSERVER_FAILED',
    async ({ kind, mode }) => {
      const cause = new Error(`${kind} start ${mode}`)
      const [error, result, response] = await executeUpload(createUploadBody(kind), {
        onUploadProgress: observerThatFails(mode, cause, 'immediately'),
      })

      expectObserverFault(error, result, response, cause)
    },
  )

  test.skipIf(!streaming).each(laterChunkCases)(
    'should report $mode failure of a later $kind upload chunk via $transport fetch as EXT_OBSERVER_FAILED',
    async ({ kind, mode, transport }) => {
      const cause = new Error(`${kind} chunk ${mode} ${transport}`)
      const [error, result, response] = await executeUpload(
        createUploadBody(kind),
        { onUploadProgress: observerThatFails(mode, cause, 'after-first') },
        transport === 'custom' ? readingHandle(false) : undefined,
      )

      expectObserverFault(error, result, response, cause)
    },
  )

  test.skipIf(!streaming).each(abortErrorCases)(
    'should report an AbortError thrown on an upload $phase as EXT_OBSERVER_FAILED',
    async ({ kind, transport, when }) => {
      const cause = new DOMException('stop', 'AbortError')
      const [error, result, response] = await executeUpload(
        createUploadBody(kind),
        { onUploadProgress: observerThatFails('sync', cause, when) },
        transport === 'custom' ? readingHandle(false) : undefined,
      )

      expectObserverFault(error, result, response, cause)
    },
  )

  test.skipIf(!streaming)('should report NET_ABORTED when the caller aborts while the upload observer is pending', async () => {
    const controller = new AbortController()
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const pending = executeUpload(createUploadBody('Blob'), {
      abort: controller.signal,
      onUploadProgress() {
        markStarted()
        return new Promise<void>(() => undefined)
      },
    })

    await started
    controller.abort()
    const [error, result, response] = await pending

    expect(error?.code).toBe('NET_ABORTED')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
  })

  test.skipIf(!streaming)('should report NET_ABORTED when the upload observer aborts the caller signal and then throws', async () => {
    const controller = new AbortController()
    const cause = new Error('observer failed after abort')
    let seen = 0
    const [error, result, response] = await executeUpload(createUploadBody('ReadableStream'), {
      abort: controller.signal,
      onUploadProgress() {
        seen += 1
        if (seen < 2) {
          return
        }
        controller.abort()
        throw cause
      },
    })

    expect(seen).toBeGreaterThanOrEqual(2)
    expect(error?.code).toBe('NET_ABORTED')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
  })

  test.skipIf(!streaming)('should report NET_TIMEOUT when the upload observer never settles', async () => {
    const [error, result, response] = await executeUpload(createUploadBody('Blob'), {
      onUploadProgress: () => new Promise<void>(() => undefined),
      timeout: 50,
    })

    expect(error?.code).toBe('NET_TIMEOUT')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
  })

  test.skipIf(!streaming).each(swallowCases)(
    'should report $mode failure of a later $kind upload chunk when the handle swallows the body error',
    async ({ kind, mode }) => {
      const cause = new Error(`${kind} swallowed ${mode}`)
      const [error, result, response] = await executeUpload(
        createUploadBody(kind),
        { onUploadProgress: observerThatFails(mode, cause, 'after-first') },
        readingHandle(true),
      )

      expectObserverFault(error, result, response, cause)
    },
  )

  test.skipIf(!streaming)('should succeed on a second transport call when the upload observer no longer throws', async () => {
    let progressCalls = 0
    let nextCalls = 0
    const client = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(readingHandle(false)),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          try {
            nextCalls += 1
            return await next(request)
          } catch {
            nextCalls += 1
            return await next({
              ...request,
              body: new Blob(['second-upload']),
            })
          }
        }),
      ),
    )
    const endpoint = defineRequest({
      builder: () => ({ body: new Blob(['first-upload']) }),
      method: 'POST',
      output: struct.string(),
      path: '/',
    })

    const [error, result, response] = await client.execute(endpoint(), {
      onUploadProgress() {
        progressCalls += 1
        if (progressCalls === 2) {
          throw new Error('first chunk failed')
        }
      },
    })

    expect(error).toBeNull()
    expect(result).toBe('ok')
    expect(response?.status).toBe(200)
    expect(nextCalls).toBe(2)
    expect(progressCalls).toBeGreaterThanOrEqual(4)
  })
})

function executeUpload(body: UploadBody, options: HttpExecuteOptions, handle?: FetchHandle) {
  const client = handle
    ? createClient(withEndpoint('https://example.com'), withHTTPHandle(handle))
    : createClient(withEndpoint(inject('testServerHost')))
  const endpoint = defineRequest({
    builder: () => ({ body }),
    method: 'POST',
    // Platform uploads use a route that tolerates the client aborting the body mid-read.
    path: handle ? '/' : '/body/upload',
  })
  return client.execute(endpoint(), options)
}

function readingHandle(swallow: boolean): FetchHandle {
  return async (input) => {
    if (!(input instanceof Request)) {
      throw new TypeError('expected Request')
    }

    try {
      await input.arrayBuffer()
    } catch (error) {
      if (!swallow) {
        throw error
      }
    }

    return new Response('ok', {
      headers: { 'content-type': 'text/plain' },
      status: 200,
    })
  }
}

function createUploadBody(kind: UploadBodyKind): UploadBody {
  if (kind === 'ArrayBuffer') {
    return new TextEncoder().encode('hello-upload').buffer
  }
  if (kind === 'Blob') {
    return new Blob(['hello-upload'])
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]))
      controller.enqueue(new Uint8Array([3, 4, 5]))
      controller.close()
    },
  })
}

function observerThatFails(mode: ObserverMode, cause: Error, when: 'after-first' | 'immediately') {
  let seen = 0
  return () => {
    seen += 1
    if (when === 'after-first' && seen < 2) {
      return undefined
    }
    return failObserver(mode, cause)
  }
}

function failObserver(mode: ObserverMode, cause: Error): Promise<never> {
  if (mode === 'sync') {
    throw cause
  }
  if (mode === 'async') {
    return Promise.resolve().then(() => {
      throw cause
    })
  }
  return Promise.reject(cause)
}

type UploadAttempt = Awaited<ReturnType<typeof executeUpload>>

function expectObserverFault(error: UploadAttempt[0], result: UploadAttempt[1], response: UploadAttempt[2], cause: unknown): void {
  expect(error?.code).toBe('EXT_OBSERVER_FAILED')
  expect(error?.cause).toBe(cause)
  expect(error).not.toHaveProperty('response')
  expect(result).toBeUndefined()
  expect(response).toBeUndefined()
}
