import { afterEach, describe, expect, test, vi } from 'vitest'
import { createClient, withEndpoint, withHTTPHandle, withInterceptors } from '../../client'
import { ERR_ABORTED } from '../../error'
import type { HttpRequest } from '../../http'
import { createHttpInterceptor } from '../../interceptor'
import { defineRequest } from '../index'
import { isBodyFailure } from './body_failure'
import { createNotesForm, notesFormBody } from '../../../test/multipart-fixture'
import { installProbeRequest, simulateUnsupportedStreaming } from '../../../test/streaming-support'
import {
  __resetStreamingRequestBodySupportForTests,
  createFetchRequest,
  createFetchRequestInit,
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  fetchHandler,
  supportsStreamingRequestBody,
} from './fetch'

afterEach(() => {
  vi.unstubAllGlobals()
  __resetStreamingRequestBodySupportForTests()
})

describe('Fetch handler streaming', () => {
  test('should throw when runtime does not support streaming request bodies', () => {
    class FakeRequest {
      body = null

      constructor(_input: URL | string, init?: RequestInit & { duplex?: 'half' }) {
        if (init?.body instanceof ReadableStream) {
          throw new TypeError('ReadableStream request bodies are not supported')
        }
      }
    }

    vi.stubGlobal('Request', FakeRequest)

    expect(supportsStreamingRequestBody()).toBe(false)

    const requestConfig: HttpRequest = {
      baseEndpoint: 'https://example.com',
      endpoint: '/stream',
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      }),
    }

    expect(() => createFetchRequest(requestConfig)).toThrow(ERR_STREAMING_REQUEST_UNSUPPORTED)
  })

  test('should call uploadProgress for ReadableStream body', async () => {
    const controller = new AbortController()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4, 5]))
        controller.close()
      },
    })

    if (!supportsStreamingRequestBody()) {
      await expect(
        fetchHandler({
          body: stream,
          endpoint: '/upload',
          baseEndpoint: 'https://example.com',
          method: 'POST',
          responseType: 'text',
        }),
      ).rejects.toBe(ERR_STREAMING_REQUEST_UNSUPPORTED)
      return
    }

    const progressEvents: Array<{ lengthComputable: boolean; loaded: number; total: number }> = []
    const fetchMock = vi.fn(async (request: Request) => {
      const reader = request.body?.getReader()

      if (reader) {
        while (true) {
          const { done } = await reader.read()
          if (done) {
            break
          }
        }
      }

      return new Response('ok', {
        headers: {
          'content-type': 'text/plain',
        },
        status: 200,
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    try {
      const response = await fetchHandler({
        abort: controller.signal,
        body: stream,
        endpoint: '/upload',
        baseEndpoint: 'https://example.com',
        method: 'POST',
        responseType: 'text',
        uploadProgress(event) {
          progressEvents.push({
            lengthComputable: event.lengthComputable,
            loaded: event.loaded,
            total: event.total,
          })
        },
      })

      expect(response.body).toBe('ok')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(progressEvents.length).toBeGreaterThan(0)
      expect(progressEvents.at(-1)?.loaded).toBeGreaterThan(0)
      expect(progressEvents.every((event) => event.lengthComputable === false && event.total === 0)).toBe(true)
      expect(progressEvents.map((event) => event.loaded)).toEqual([2, 5])
      expect(progressEvents.at(-1)?.total).toBe(0)
      expect(stream.locked).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('should preserve an async upload observer error and unlock without waiting for cancellation', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const observerError = new Error('observer failed')
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
    })
    const init = createFetchRequestInit({
      baseEndpoint: 'https://example.com',
      body: stream,
      endpoint: '/upload',
      method: 'POST',
      async uploadProgress() {
        await Promise.resolve()
        throw observerError
      },
    })
    const reader = (init.body as ReadableStream<Uint8Array>).getReader()

    await expect(settleWithin(reader.read())).rejects.toBe(observerError)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(observerError)
    expect(stream.locked).toBe(false)
  })

  test('should unlock an upload body without waiting for consumer cancellation', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const init = createFetchRequestInit({
      baseEndpoint: 'https://example.com',
      body: stream,
      endpoint: '/upload',
      method: 'POST',
      uploadProgress: vi.fn(),
    })
    const reader = (init.body as ReadableStream<Uint8Array>).getReader()

    await expect(settleWithin(reader.cancel('consumer canceled'))).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledExactlyOnceWith('consumer canceled')
    expect(stream.locked).toBe(false)
  })

  test('should clean up a wrapped upload body when Request construction fails', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    class FailingRequest {
      constructor() {
        throw new TypeError('Request construction failed')
      }
    }

    vi.stubGlobal('Request', FailingRequest)
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn<typeof fetch>()
    const failure = await settleWithin(
      fetchHandler(
        {
          baseEndpoint: 'https://example.com',
          body: stream,
          endpoint: '/upload',
          method: 'POST',
          uploadProgress: vi.fn(),
        },
        fetchMock,
      ).catch((cause: unknown) => cause),
    )

    expect(failure).toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(failure)
    expect(stream.locked).toBe(false)
  })

  test('should clean up a wrapped upload body when fetch rejects', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const networkError = new Error('network failed')
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn(async () => {
      throw networkError
    })
    const failure = await settleWithin(
      fetchHandler(
        {
          baseEndpoint: 'https://example.com',
          body: stream,
          endpoint: '/upload',
          method: 'POST',
          uploadProgress: vi.fn(),
        },
        fetchMock,
      ).catch((cause: unknown) => cause),
    )

    expect(failure).toBe(networkError)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(networkError)
    expect(stream.locked).toBe(false)
  })

  test('should clean up an upload body for a pre-aborted signal', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const controller = new AbortController()
    controller.abort()
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn<typeof fetch>()
    const failure = await settleWithin(
      fetchHandler(
        {
          abort: controller.signal,
          baseEndpoint: 'https://example.com',
          body: stream,
          endpoint: '/upload',
          method: 'POST',
          uploadProgress: vi.fn(),
        },
        fetchMock,
      ).catch((cause: unknown) => cause),
    )

    expect(failure).toBe(ERR_ABORTED)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(controller.signal.reason)
    expect(stream.locked).toBe(false)
  })

  test('should unlock an upload body when a custom fetch ignores abort', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const controller = new AbortController()
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined))
    const pending = fetchHandler(
      {
        abort: controller.signal,
        baseEndpoint: 'https://example.com',
        body: stream,
        endpoint: '/upload',
        method: 'POST',
        uploadProgress: vi.fn(),
      },
      fetchMock as unknown as typeof fetch,
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(controller.signal.reason)
    expect(stream.locked).toBe(false)
  })

  test('should unlock an upload body when a custom fetch consumes it and ignores abort', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const controller = new AbortController()
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    let startPull!: () => void
    const pullStarted = new Promise<void>((resolve) => {
      startPull = resolve
    })
    const stream = new ReadableStream<Uint8Array>(
      {
        cancel,
        pull() {
          startPull()
          return new Promise<void>(() => undefined)
        },
      },
      { highWaterMark: 0 },
    )
    let startConsuming!: () => void
    const consumingStarted = new Promise<void>((resolve) => {
      startConsuming = resolve
    })
    const fetchMock = vi.fn(async (request: Request) => {
      const consuming = request.arrayBuffer()
      startConsuming()
      await consuming
      return new Response()
    })
    const pending = fetchHandler(
      {
        abort: controller.signal,
        baseEndpoint: 'https://example.com',
        body: stream,
        endpoint: '/upload',
        method: 'POST',
        uploadProgress: vi.fn(),
      },
      fetchMock as unknown as typeof fetch,
    )

    await consumingStarted
    await pullStarted
    controller.abort()

    await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(controller.signal.reason)
    expect(stream.locked).toBe(false)
  })

  test.each([false, true])('should clean up once when upload progress cancels its consumer (throw: %s)', async (throwAfterCancel) => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
    })
    const observerError = new Error('observer failed after cancel')
    let reader: ReadableStreamDefaultReader<Uint8Array>
    const init = createFetchRequestInit({
      baseEndpoint: 'https://example.com',
      body: stream,
      endpoint: '/upload',
      method: 'POST',
      uploadProgress() {
        void reader.cancel('observer canceled')
        if (throwAfterCancel) {
          throw observerError
        }
      },
    })
    reader = (init.body as ReadableStream<Uint8Array>).getReader()

    await expect(settleWithin(reader.read())).resolves.toEqual({ done: true, value: undefined })
    expect(cancel).toHaveBeenCalledExactlyOnceWith('observer canceled')
    expect(stream.locked).toBe(false)
  })

  test('should preserve a fetch error when its request body is already locked', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const networkError = new Error('network failed')
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel })
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const fetchMock = vi.fn(async (request: Request) => {
      reader = request.body?.getReader()
      throw networkError
    })
    const failure = await fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        body: stream,
        endpoint: '/upload',
        method: 'POST',
        uploadProgress: vi.fn(),
      },
      fetchMock as unknown as typeof fetch,
    ).catch((cause: unknown) => cause)

    expect(failure).toBe(networkError)
    expect(cancel).not.toHaveBeenCalled()
    await expect(reader?.cancel(networkError)).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(networkError)
    expect(stream.locked).toBe(false)
  })

  test.each([
    {
      body: () => {
        const formData = new FormData()
        formData.append('name', 'miao')
        return formData
      },
      name: 'FormData',
    },
    {
      body: () => new Blob(['hello-upload'], { type: 'text/plain' }),
      name: 'Blob',
    },
    {
      body: () => new TextEncoder().encode('bytes-upload').buffer,
      name: 'ArrayBuffer',
    },
  ])('should call uploadProgress for a $name body', async ({ body, name }) => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const progressEvents: Array<{ lengthComputable: boolean; loaded: number; total: number }> = []
    const fetchMock = vi.fn(async (request: Request) => {
      const reader = request.body?.getReader()
      if (reader) {
        while (true) {
          const { done } = await reader.read()
          if (done) {
            break
          }
        }
      }
      return new Response('ok', {
        headers: { 'content-type': 'text/plain' },
        status: 200,
      })
    })

    const response = await fetchHandler(
      {
        abort: new AbortController().signal,
        baseEndpoint: 'https://example.com',
        body: body(),
        endpoint: '/upload',
        method: 'POST',
        responseType: 'text',
        uploadProgress(event) {
          progressEvents.push({
            lengthComputable: event.lengthComputable,
            loaded: event.loaded,
            total: event.total,
          })
        },
      },
      fetchMock as unknown as typeof fetch,
    )

    expect(response.body).toBe('ok')
    expect(progressEvents.length).toBeGreaterThanOrEqual(2)
    expect(progressEvents[0]).toMatchObject({ lengthComputable: name !== 'FormData', loaded: 0 })
    const complete = progressEvents.at(-1)
    expect(complete?.lengthComputable).toBe(name !== 'FormData')
    expect(complete?.loaded).toBeGreaterThan(0)
    if (name === 'FormData') {
      expect(progressEvents.every((event) => event.total === 0)).toBe(true)
    } else {
      expect(complete?.loaded).toBe(complete?.total)
      expect(complete?.total).toBeGreaterThan(0)
    }
  })

  test('should skip upload wrapping for non-streamable bodies without a counted type', async () => {
    const uploadProgress = vi.fn()
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }))

    const response = await fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        body: 'plain-text-body',
        endpoint: '/upload',
        method: 'POST',
        responseType: 'text',
        uploadProgress,
      },
      fetchMock as unknown as typeof fetch,
    )

    expect(response.body).toBe('ok')
    expect(uploadProgress).not.toHaveBeenCalled()
  })

  test('should report upload progress for an empty Blob without a content type', async () => {
    if (!supportsStreamingRequestBody()) {
      return
    }

    const progressEvents: Array<{ lengthComputable: boolean; loaded: number; total: number }> = []
    const fetchMock = vi.fn(async (request: Request) => {
      const reader = request.body?.getReader()
      if (reader) {
        while (true) {
          const { done } = await reader.read()
          if (done) {
            break
          }
        }
      }
      return new Response('ok', { headers: { 'content-type': 'text/plain' }, status: 200 })
    })

    const response = await fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        body: new Blob([]),
        bodyContentType: 'application/octet-stream',
        endpoint: '/upload',
        method: 'POST',
        responseType: 'text',
        uploadProgress(event) {
          progressEvents.push({
            lengthComputable: event.lengthComputable,
            loaded: event.loaded,
            total: event.total,
          })
        },
      },
      fetchMock as unknown as typeof fetch,
    )

    expect(response.body).toBe('ok')
    expect(progressEvents[0]).toEqual({ lengthComputable: false, loaded: 0, total: 0 })
  })

  test('should cancel a converted upload stream when the start observer throws', async (context) => {
    if (!supportsStreamingRequestBody()) {
      context.skip()
    }

    const observerError = new Error('start failed')
    const blob = new Blob(['hello'])
    const converted = blob.stream()
    const cancel = vi.spyOn(converted, 'cancel')
    const streamSpy = vi.spyOn(blob, 'stream').mockReturnValue(converted)

    try {
      const failure = await settleWithin(
        fetchHandler(
          {
            baseEndpoint: 'https://example.com',
            body: blob,
            endpoint: '/upload',
            method: 'POST',
            responseType: 'text',
            async uploadProgress() {
              throw observerError
            },
          },
          vi.fn(async () => new Response('ok')) as unknown as typeof fetch,
        ),
      ).catch((cause: unknown) => cause)

      expect(cancel).toHaveBeenCalledExactlyOnceWith(observerError)
      expectUploadObserverFailure(failure, observerError)
    } finally {
      streamSpy.mockRestore()
    }
  })

  test('should reject a later upload chunk observer failure as EXT_OBSERVER_FAILED', async (context) => {
    if (!supportsStreamingRequestBody()) {
      context.skip()
    }

    const observerError = new Error('chunk failed')
    let seen = 0
    const pending = fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        body: twoChunkUpload(),
        endpoint: '/upload',
        method: 'POST',
        responseType: 'text',
        uploadProgress() {
          seen += 1
          if (seen >= 2) {
            throw observerError
          }
        },
      },
      async (input) => {
        await readRequestBody(input)
        return new Response('ok', { headers: { 'content-type': 'text/plain' }, status: 200 })
      },
    )

    const failure = await settleWithin(pending).catch((cause: unknown) => cause)

    expect(seen).toBeGreaterThanOrEqual(2)
    expectUploadObserverFailure(failure, observerError)
  })

  test('should reject with the abort cause when an upload observer aborts the request and then throws', async (context) => {
    if (!supportsStreamingRequestBody()) {
      context.skip()
    }

    const controller = new AbortController()
    const observerError = new Error('observer failed after abort')
    const pending = fetchHandler(
      {
        abort: controller.signal,
        baseEndpoint: 'https://example.com',
        body: new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(new Uint8Array([1, 2, 3]))
            streamController.close()
          },
        }),
        endpoint: '/upload',
        method: 'POST',
        responseType: 'text',
        uploadProgress() {
          controller.abort()
          throw observerError
        },
      },
      async (input) => {
        await readRequestBody(input)
        return new Response('ok', { headers: { 'content-type': 'text/plain' }, status: 200 })
      },
    )

    const failure = await settleWithin(pending).catch((cause: unknown) => cause)

    expect(isBodyFailure(failure)).toBe(false)
    expect(failure).toBe(ERR_ABORTED)
  })

  test('should reject with EXT_OBSERVER_FAILED when a custom fetch swallows the upload body error', async (context) => {
    if (!supportsStreamingRequestBody()) {
      context.skip()
    }

    const observerError = new Error('observer failed')
    const cancel = vi.fn(() => Promise.resolve())
    let read = false
    const responseBody = new ReadableStream<Uint8Array>(
      {
        cancel,
        pull(controller) {
          read = true
          controller.enqueue(new TextEncoder().encode('late'))
          controller.close()
        },
      },
      { highWaterMark: 0 },
    )
    let seen = 0
    const pending = fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        body: twoChunkUpload(),
        endpoint: '/upload',
        method: 'POST',
        responseType: 'text',
        uploadProgress() {
          seen += 1
          if (seen >= 2) {
            throw observerError
          }
        },
      },
      async (input) => {
        try {
          await readRequestBody(input)
        } catch {
          // The handle keeps going after the request body fails.
        }
        return new Response(responseBody, { headers: { 'content-type': 'text/plain' }, status: 200 })
      },
    )

    const failure = await settleWithin(pending).catch((cause: unknown) => cause)

    expect(seen).toBeGreaterThanOrEqual(2)
    expectUploadObserverFailure(failure, observerError)
    expect(read).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
  })
})

const uploadBytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x41])

const browserMarkers = [{ marker: 'document' }, { marker: 'importScripts' }] as const

const browserUploadCases = browserMarkers.flatMap(({ marker }) => [
  {
    contentType: 'application/x-defjs-upload',
    createBody: () => new Blob([uploadBytes], { type: 'application/x-defjs-upload' }),
    kind: 'Blob' as const,
    marker,
  },
  {
    contentType: 'application/octet-stream',
    createBody: () => uploadBytes.slice().buffer,
    kind: 'ArrayBuffer' as const,
    marker,
  },
  {
    createBody: () => createNotesForm(),
    kind: 'FormData' as const,
    marker,
  },
])

describe('streaming request body capability', () => {
  test('should treat a non-null stream body with an implicit Content-Type as unsupported', () => {
    installProbeRequest('text/plain;charset=UTF-8')

    expect(supportsStreamingRequestBody()).toBe(false)
  })

  test('should refuse a ReadableStream body when the runtime adds an implicit Content-Type', () => {
    installProbeRequest('text/plain;charset=UTF-8')

    expect(() =>
      createFetchRequest({
        baseEndpoint: 'https://example.com',
        body: closedUploadStream(),
        endpoint: '/upload',
        method: 'POST',
      }),
    ).toThrow(ERR_STREAMING_REQUEST_UNSUPPORTED)
  })

  test('should treat a non-null stream body without a Content-Type as supported', () => {
    installProbeRequest()

    expect(supportsStreamingRequestBody()).toBe(true)
  })

  test('should support streaming request bodies in this runtime', () => {
    expect(supportsStreamingRequestBody()).toBe(true)
  })

  test('should probe streaming support once until the test reset', () => {
    let constructions = 0
    installProbeRequest(undefined, () => {
      constructions += 1
    })

    expect(supportsStreamingRequestBody()).toBe(true)
    expect(supportsStreamingRequestBody()).toBe(true)
    expect(constructions).toBe(1)

    __resetStreamingRequestBodySupportForTests()

    expect(supportsStreamingRequestBody()).toBe(true)
    expect(constructions).toBe(2)
  })

  test.each(browserUploadCases)(
    'should send the original $kind body and skip upload progress when global $marker exists',
    async (upload) => {
      stubBrowserMarker(upload.marker)
      const uploadProgress = vi.fn()
      let type: string | null = null
      let bytes = new Uint8Array()
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (!(input instanceof Request)) {
          throw new TypeError('expected Request')
        }
        type = input.headers.get('content-type')
        bytes = new Uint8Array(await input.arrayBuffer())
        return new Response('ok', { headers: { 'content-type': 'text/plain' }, status: 200 })
      })

      const response = await fetchHandler(
        {
          baseEndpoint: 'https://example.com',
          body: upload.createBody(),
          endpoint: '/upload',
          method: 'POST',
          responseType: 'text',
          uploadProgress,
        },
        fetchMock as unknown as typeof fetch,
      )

      expect(response.body).toBe('ok')
      if (upload.kind === 'FormData') {
        if (typeof type !== 'string') {
          throw new Error('expected a content type')
        }
        expect(new TextDecoder().decode(bytes)).toBe(notesFormBody(type))
      } else {
        expect(type).toBe(upload.contentType)
        expect(Array.from(bytes)).toEqual(Array.from(uploadBytes))
      }
      expect(uploadProgress).toHaveBeenCalledTimes(0)
    },
  )

  test.each(browserMarkers)('should report caller ReadableStream upload chunks when global $marker exists', async ({ marker }) => {
    stubBrowserMarker(marker)
    const loaded: number[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!(input instanceof Request)) {
        throw new TypeError('expected Request')
      }
      await readRequestBody(input)
      return new Response('ok', { headers: { 'content-type': 'text/plain' }, status: 200 })
    })

    const response = await fetchHandler(
      {
        baseEndpoint: 'https://example.com',
        body: twoChunkUpload(),
        endpoint: '/upload',
        method: 'POST',
        responseType: 'text',
        uploadProgress(event) {
          loaded.push(event.loaded)
        },
      },
      fetchMock as unknown as typeof fetch,
    )

    expect(response.body).toBe('ok')
    expect(loaded).toEqual([2, 5])
  })
})

describe('unsupported streaming request body', () => {
  test('should report ENV_UNSUPPORTED for a ReadableStream body before calling the handle', async () => {
    simulateUnsupportedStreaming()
    const stream = byteStream()
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const client = createClient(withEndpoint('https://example.com'), withHTTPHandle(handle))
    const upload = defineRequest({
      builder: () => ({ body: stream }),
      method: 'POST',
      path: '/upload',
    })

    const [error, result, response] = await client.execute(upload())

    expect(error?.code).toBe('ENV_UNSUPPORTED')
    expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED)
    expect(error?.cause instanceof Error ? error.cause.message : '').toBe('ERR_STREAMING_REQUEST_UNSUPPORTED')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(handle).toHaveBeenCalledTimes(0)
    expect(stream.locked).toBe(false)
  })

  test('should report ENV_UNSUPPORTED for a ReadableStream body when onUploadProgress is set', async () => {
    simulateUnsupportedStreaming()
    const stream = byteStream()
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const onUploadProgress = vi.fn()
    const client = createClient(withEndpoint('https://example.com'), withHTTPHandle(handle))
    const upload = defineRequest({
      builder: () => ({ body: stream }),
      method: 'POST',
      path: '/upload',
    })

    const [error, result, response] = await client.execute(upload(), { onUploadProgress })

    expect(error?.code).toBe('ENV_UNSUPPORTED')
    expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED)
    expect(error?.cause instanceof Error ? error.cause.message : '').toBe('ERR_STREAMING_REQUEST_UNSUPPORTED')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(handle).toHaveBeenCalledTimes(0)
    expect(onUploadProgress).toHaveBeenCalledTimes(0)
    expect(stream.locked).toBe(false)
  })

  test('should let an interceptor resend the unlocked stream as a Blob', async () => {
    simulateUnsupportedStreaming()
    const bytes = Uint8Array.from([1, 2, 3, 4])
    const stream = byteStream(bytes)
    let received = new Uint8Array()
    const handle = vi.fn(async (input: RequestInfo | URL) => {
      if (!(input instanceof Request)) {
        throw new TypeError('expected Request')
      }
      received = new Uint8Array(await input.arrayBuffer())
      return new Response('ok', { headers: { 'content-type': 'text/plain' }, status: 200 })
    })
    const client = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(handle),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          try {
            return await next(request)
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'ERR_STREAMING_REQUEST_UNSUPPORTED') {
              throw error
            }
            expect(stream.locked).toBe(false)
            const blob = await new Response(request.body as ReadableStream<Uint8Array>).blob()
            return await next({ ...request, body: blob })
          }
        }),
      ),
    )
    const upload = defineRequest({
      builder: () => ({ body: stream }),
      method: 'POST',
      path: '/upload',
    })

    const [error] = await client.execute(upload())

    expect(error).toBeNull()
    expect(handle).toHaveBeenCalledTimes(1)
    expect(Array.from(received)).toEqual(Array.from(bytes))
  })
})

function stubBrowserMarker(marker: (typeof browserMarkers)[number]['marker']): void {
  if (marker === 'document') {
    vi.stubGlobal('document', {})
    return
  }
  vi.stubGlobal('importScripts', () => undefined)
}

function byteStream(bytes: Uint8Array = Uint8Array.from([1, 2, 3, 4])): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function closedUploadStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

function twoChunkUpload(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]))
      controller.enqueue(new Uint8Array([3, 4, 5]))
      controller.close()
    },
  })
}

async function readRequestBody(input: RequestInfo | URL): Promise<ArrayBuffer> {
  if (!(input instanceof Request)) {
    throw new TypeError('expected Request')
  }
  return input.arrayBuffer()
}

function expectUploadObserverFailure(failure: unknown, cause: unknown): void {
  if (!isBodyFailure(failure)) {
    throw new Error('Expected a tagged body failure')
  }
  expect(failure.code).toBe('EXT_OBSERVER_FAILED')
  expect(failure.cause).toBe(cause)
  expect(failure.meta).toBeUndefined()
}

function settleWithin<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('operation did not settle')), 100)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
