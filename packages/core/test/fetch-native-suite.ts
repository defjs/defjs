import { afterEach, beforeAll, describe, expect, inject, test, vi } from 'vitest'
import type { FetchHandle } from '../src/client/config'
import type { HttpRequest, HttpResponse } from '../src/http'

const ORIGIN = 'https://example.com'
const JSON_HEADERS = { 'content-type': 'application/json' }
const encoder = new TextEncoder()

/** Delivers each chunk separately, then ends. */
function chunkedBody(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

/**
 * Never produces data and never reacts to a signal, like a peer that went silent. `reading` settles once a consumer asks for
 * data, whichever way it reads; `fail` errors the stream the way a platform does when it tears a response down.
 */
function stalledBody(onCancel?: (reason: unknown) => void) {
  let markReading: () => void = () => undefined
  let fail: (reason: unknown) => void = () => undefined
  const reading = new Promise<void>((resolve) => {
    markReading = resolve
  })
  const stream = new ReadableStream<Uint8Array>(
    {
      cancel(reason) {
        onCancel?.(reason)
        return new Promise<void>(() => undefined)
      },
      pull() {
        markReading()
        return new Promise<void>(() => undefined)
      },
      start(controller) {
        fail = (reason) => controller.error(reason)
      },
    },
    { highWaterMark: 0 },
  )
  return { fail: (reason: unknown) => fail(reason), reading, stream }
}

function settleWithin<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('operation did not settle')), ms)
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

type FetchCall = Parameters<FetchHandle>

const realFetch = globalThis.fetch
let current: { calls: FetchCall[]; origin: string; platform: FetchHandle } = { calls: [], origin: '', platform: realFetch }

/**
 * The platform fetch as the library sees it. The library default handle is a bound copy of whatever `fetch` is global when
 * the library loads, so this one function is installed before the first import and each test points it at its own platform
 * behavior. Traffic outside the test's origin (the test runner's own) goes to the real fetch untouched.
 */
const recorder: FetchHandle = (...args) => {
  const [input] = args
  const { calls, origin, platform } = current
  if (!(input instanceof Request ? input.url : String(input)).startsWith(origin)) {
    return realFetch(...args)
  }
  calls.push(args)
  // A plain call: browsers reject fetch invoked as a method of another object.
  return platform(...args)
}

async function importLibrary() {
  // Browsers run native modules that no registry reset can reach, but each spec file gets its own page, so the first
  // import here is the library's first load. Server workers may share a registry, hence the reset.
  vi.resetModules()
  const [transport, config, error, client, http] = await Promise.all([
    import('../src/http/transport/fetch'),
    import('../src/client/config'),
    import('../src/error'),
    import('../src/client'),
    import('../src/http'),
  ])
  return {
    client,
    createFetchRequest: transport.createFetchRequest,
    DEFAULT_FETCH: config.DEFAULT_FETCH,
    ERR_ABORTED: error.ERR_ABORTED,
    ERR_TIMEOUT: error.ERR_TIMEOUT,
    fetchHandler: transport.fetchHandler,
    http,
    supportsStreamingRequestBody: transport.supportsStreamingRequestBody,
  }
}

let library: ReturnType<typeof importLibrary> | undefined

function ensureLibrary() {
  vi.stubGlobal('fetch', recorder)
  library ??= importLibrary()
  return library
}

/**
 * Makes `platform` the platform fetch for this test and returns the library wired to it. Each call the default handle makes
 * lands in `calls` exactly as the platform fetch received it.
 */
async function loadTransport(origin: string, platform: FetchHandle = realFetch) {
  const calls: FetchCall[] = []
  current = { calls, origin, platform }
  return { ...(await ensureLibrary()), calls, realFetch }
}

/** An upload source that stays open and never finishes cancelling; `onCancel` sees only the reason. */
function openSource(onCancel: (reason: unknown) => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    cancel(reason) {
      onCancel(reason)
      return new Promise<void>(() => undefined)
    },
  })
}

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return { baseEndpoint: ORIGIN, endpoint: '/x', method: 'GET', ...overrides }
}

/** Reduces a settled call to comparable data, so two transports can be compared result by result. */
async function outcomeOf(run: () => Promise<HttpResponse<unknown>>): Promise<unknown> {
  try {
    const response = await run()
    const { body } = response
    return {
      body:
        body instanceof Blob
          ? { blob: await body.text(), type: body.type }
          : body instanceof ArrayBuffer
            ? { bytes: Array.from(new Uint8Array(body)) }
            : body,
      contentType: response.headers.get('content-type'),
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
    }
  } catch (error) {
    const { cause, code } = error as { cause?: { name?: string }; code?: string }
    // Platform errors word themselves after the API that threw ("fetch" vs "Request"), so only their class is comparable.
    return { cause: cause?.name, code: code ?? (error as Error).name }
  }
}

async function stallState(fetchImpl: FetchHandle, host: string, key: string): Promise<unknown> {
  const response = await fetchImpl(`${host}/body/stall-state?key=${key}`)
  return response.json()
}

/** Registers the platform fast-path cases; shared by the server (Bun) and browser (Chromium, Firefox) projects. */
export function defineNativeFetchSuite(): void {
  // Loading and instrumenting the library can outlast a single test's budget, so it is not charged to the first test.
  beforeAll(async () => {
    await ensureLibrary()
  }, 60_000)

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('default handle', () => {
    test('calls the platform fetch with (url, init) and never builds a Request', async () => {
      const { calls, DEFAULT_FETCH, fetchHandler } = await loadTransport(
        ORIGIN,
        async () => new Response('{"id":1}', { headers: JSON_HEADERS }),
      )

      const response = await fetchHandler(
        request({ endpoint: '/users/1', queryParams: new URLSearchParams({ a: '1' }), responseType: 'json' }),
        DEFAULT_FETCH,
      )

      expect(response.body).toEqual({ id: 1 })
      expect(calls).toHaveLength(1)
      const [input, init] = calls[0] ?? []
      expect(calls[0]).toHaveLength(2)
      expect(input).toBeInstanceOf(URL)
      expect(String(input)).toBe('https://example.com/users/1?a=1')
      expect(init?.method).toBe('GET')
      expect(new Headers(init?.headers).get('accept')).toBe('application/json, text/plain, */*')
    })

    test('is what the implicit default resolves to while the global fetch is untouched', async () => {
      const { calls, fetchHandler } = await loadTransport(ORIGIN, async () => new Response(null))

      await fetchHandler(request())

      expect(calls).toHaveLength(1)
      expect(calls[0]).toHaveLength(2)
    })

    test('is what a client without withHTTPHandle uses', async () => {
      const { calls, client, http } = await loadTransport(ORIGIN, async () => new Response(null, { status: 204 }))
      const api = client.createClient(client.withEndpoint(ORIGIN))
      const ping = http.defineRequest({ method: 'GET', path: '/ping' })

      const [failure] = await api.execute(ping())

      expect(failure).toBeNull()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toHaveLength(2)
      expect(calls[0]?.[0]).toBeInstanceOf(URL)
    })

    test('keeps the fallback response url identical to the url a Request reports', async () => {
      const { createFetchRequest, DEFAULT_FETCH, fetchHandler } = await loadTransport(
        ORIGIN,
        async () => new Response('{}', { headers: JSON_HEADERS }),
      )

      const queries = { queryParams: new URLSearchParams({ q: 'a b', r: 'ü&=' }) }
      for (const overrides of [
        { endpoint: '/plain' },
        { endpoint: '/a b/ü' },
        { endpoint: 'relative' },
        { endpoint: '/deep//up/../path' },
        { endpoint: '/encoded/%E2%9C%93' },
        { endpoint: '/with-query', ...queries },
        { endpoint: '/with-query-string', queryString: 'a=1&b=%20' },
      ]) {
        const input = request({ ...overrides, responseType: 'json' })
        const response = await fetchHandler(input, DEFAULT_FETCH)
        expect(response.url).toBe(createFetchRequest(input).url)
      }
    })

    test('passes a streaming upload body wrapped for progress, with duplex half', async () => {
      const { calls, DEFAULT_FETCH, fetchHandler, supportsStreamingRequestBody } = await loadTransport(
        ORIGIN,
        async () => new Response('ok'),
      )
      if (!supportsStreamingRequestBody()) {
        return
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      })

      await fetchHandler(request({ body: stream, method: 'POST', uploadProgress: vi.fn() }), DEFAULT_FETCH)

      const init = calls[0]?.[1] as (RequestInit & { duplex?: string }) | undefined
      expect(init?.duplex).toBe('half')
      expect(init?.body).toBeInstanceOf(ReadableStream)
      expect(init?.body).not.toBe(stream)
    })

    test('cancels the wrapped upload body with the failure when the platform fetch rejects', async () => {
      const networkError = new Error('network failed')
      const { DEFAULT_FETCH, fetchHandler, supportsStreamingRequestBody } = await loadTransport(ORIGIN, async () => {
        throw networkError
      })
      if (!supportsStreamingRequestBody()) {
        return
      }
      const onCancel = vi.fn()
      const stream = openSource(onCancel)

      const failure = await settleWithin(
        fetchHandler(request({ body: stream, method: 'POST', uploadProgress: vi.fn() }), DEFAULT_FETCH).catch((cause: unknown) => cause),
      )

      expect(failure).toBe(networkError)
      expect(onCancel).toHaveBeenCalledExactlyOnceWith(networkError)
      expect(stream.locked).toBe(false)
    })

    test('surfaces the platform rejection of a request it cannot send and releases the upload body', async () => {
      const host = inject('testServerHost')
      const { DEFAULT_FETCH, fetchHandler, supportsStreamingRequestBody } = await loadTransport(host)
      if (!supportsStreamingRequestBody()) {
        return
      }
      const onCancel = vi.fn()
      const stream = openSource(onCancel)

      const failure = await settleWithin(
        fetchHandler(
          request({ baseEndpoint: host, body: stream, endpoint: '/json', method: 'GET', uploadProgress: vi.fn() }),
          DEFAULT_FETCH,
        ).catch((cause: unknown) => cause),
      )

      expect(failure).toBeInstanceOf(TypeError)
      expect(onCancel).toHaveBeenCalledExactlyOnceWith(failure)
      expect(stream.locked).toBe(false)
    })

    test('does not start the platform fetch for an already aborted signal', async () => {
      const { calls, DEFAULT_FETCH, ERR_ABORTED, fetchHandler } = await loadTransport(ORIGIN, async () => new Response('ok'))

      await expect(fetchHandler(request({ abort: AbortSignal.abort() }), DEFAULT_FETCH)).rejects.toBe(ERR_ABORTED)

      expect(calls).toHaveLength(0)
    })

    test('reads the body in one piece when nothing observes progress', async () => {
      const response = new Response('{"id":1}', { headers: JSON_HEADERS })
      const arrayBuffer = vi.spyOn(response, 'arrayBuffer')
      const { DEFAULT_FETCH, fetchHandler } = await loadTransport(ORIGIN, async () => response)

      const result = await fetchHandler(request({ responseType: 'json' }), DEFAULT_FETCH)

      expect(result.body).toEqual({ id: 1 })
      expect(arrayBuffer).toHaveBeenCalledOnce()
    })

    test('reads in chunks and reports the same progress as a custom handle when download progress is observed', async () => {
      const chunked = () => new Response(chunkedBody('ab', 'c'), { headers: { 'content-type': 'text/plain' } })
      const response = chunked()
      const arrayBuffer = vi.spyOn(response, 'arrayBuffer')
      const { DEFAULT_FETCH, fetchHandler } = await loadTransport(ORIGIN, async () => response)
      const viaDefault = vi.fn()
      const viaCustom = vi.fn()

      const first = await fetchHandler(request({ downloadProgress: viaDefault, responseType: 'text' }), DEFAULT_FETCH)
      const second = await fetchHandler(request({ downloadProgress: viaCustom, responseType: 'text' }), async () => chunked())

      expect(arrayBuffer).not.toHaveBeenCalled()
      expect(first.body).toBe('abc')
      expect(second.body).toBe('abc')
      expect(viaDefault.mock.calls).toEqual([
        [{ lengthComputable: false, loaded: 2, total: 0 }],
        [{ lengthComputable: false, loaded: 3, total: 0 }],
      ])
      expect(viaDefault.mock.calls).toEqual(viaCustom.mock.calls)
    })

    test('fills a missing response url from the resolved request url', async () => {
      const { DEFAULT_FETCH, fetchHandler } = await loadTransport(ORIGIN, async () => new Response('{}', { headers: JSON_HEADERS }))

      const response = await fetchHandler(
        request({ endpoint: '/filled', queryParams: new URLSearchParams({ q: 'a b' }), responseType: 'json' }),
        DEFAULT_FETCH,
      )

      expect(response.url).toBe('https://example.com/filled?q=a+b')
    })

    test('keeps an absent body absent and an empty present body distinct from JSON null', async () => {
      let next = new Response(null)
      const { DEFAULT_FETCH, fetchHandler } = await loadTransport(ORIGIN, async () => next)
      const read = (responseType: 'arraybuffer' | 'json' | 'text') => fetchHandler(request({ responseType }), DEFAULT_FETCH)

      expect((await read('json')).body).toBeUndefined()

      next = new Response('', { headers: JSON_HEADERS })
      expect((await read('text')).body).toBe('')
      next = new Response('', { headers: JSON_HEADERS })
      expect(((await read('arraybuffer')).body as ArrayBuffer).byteLength).toBe(0)
      next = new Response('', { headers: JSON_HEADERS })
      await expect(read('json')).rejects.toMatchObject({ code: 'RES_DECODE_FAILED' })

      next = new Response('null', { headers: JSON_HEADERS })
      expect((await read('json')).body).toBeNull()
    })

    test('rejects a media type mismatch before reading and discards the body', async () => {
      let canceled = false
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true
        },
        start(controller) {
          controller.enqueue(encoder.encode('<html>'))
        },
      })
      const response = new Response(body, { headers: { 'content-type': 'text/html' } })
      const arrayBuffer = vi.spyOn(response, 'arrayBuffer')
      const { DEFAULT_FETCH, fetchHandler } = await loadTransport(ORIGIN, async () => response)

      await expect(fetchHandler(request({ responseType: 'json' }), DEFAULT_FETCH)).rejects.toMatchObject({ code: 'RES_MEDIA_TYPE_INVALID' })

      expect(arrayBuffer).not.toHaveBeenCalled()
      expect(canceled).toBe(true)
    })

    test('classifies a failed read as NET_BODY_INCOMPLETE', async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('read failed'))
        },
      })
      const { DEFAULT_FETCH, fetchHandler } = await loadTransport(ORIGIN, async () => new Response(body, { headers: JSON_HEADERS }))

      const failure = await fetchHandler(request({ responseType: 'json' }), DEFAULT_FETCH).catch((cause: unknown) => cause)

      // Whether the platform hands back the stream's own error or its own network error is its choice; either is the cause.
      expect(failure).toMatchObject({ cause: expect.any(Error), code: 'NET_BODY_INCOMPLETE' })
    })

    test('classifies an undecodable body as RES_DECODE_FAILED', async () => {
      const { DEFAULT_FETCH, fetchHandler } = await loadTransport(ORIGIN, async () => new Response('{bad', { headers: JSON_HEADERS }))

      await expect(fetchHandler(request({ responseType: 'json' }), DEFAULT_FETCH)).rejects.toMatchObject({ code: 'RES_DECODE_FAILED' })
    })

    test('lets an abort outrank the read failure it causes', async () => {
      const controller = new AbortController()
      const body = stalledBody()
      controller.signal.addEventListener('abort', () => body.fail(controller.signal.reason))
      const { DEFAULT_FETCH, ERR_ABORTED, fetchHandler } = await loadTransport(
        ORIGIN,
        async () => new Response(body.stream, { headers: JSON_HEADERS }),
      )

      const pending = fetchHandler(request({ abort: controller.signal, responseType: 'json' }), DEFAULT_FETCH)
      await body.reading
      controller.abort()

      await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED)
    })

    test('settles an abort mid-body promptly even if the source ignores the signal', async () => {
      const controller = new AbortController()
      const body = stalledBody()
      const { DEFAULT_FETCH, ERR_ABORTED, fetchHandler } = await loadTransport(
        ORIGIN,
        async () => new Response(body.stream, { headers: JSON_HEADERS }),
      )

      const pending = fetchHandler(request({ abort: controller.signal, responseType: 'json' }), DEFAULT_FETCH)
      await body.reading
      controller.abort()

      await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED)
    })

    test('settles a timeout mid-body promptly even if the source ignores the signal', async () => {
      const body = stalledBody()
      const { DEFAULT_FETCH, ERR_TIMEOUT, fetchHandler } = await loadTransport(
        ORIGIN,
        async () => new Response(body.stream, { headers: JSON_HEADERS }),
      )

      const pending = fetchHandler(request({ abort: AbortSignal.timeout(250), responseType: 'json' }), DEFAULT_FETCH)
      await body.reading

      await expect(settleWithin(pending)).rejects.toBe(ERR_TIMEOUT)
    })
  })

  describe('custom handle', () => {
    test('receives a single Request and reads the body in chunks', async () => {
      const response = new Response('{"id":1}', { headers: JSON_HEADERS })
      const arrayBuffer = vi.spyOn(response, 'arrayBuffer')
      const { calls, fetchHandler } = await loadTransport(ORIGIN, async () => new Response(null))
      const handle = vi.fn<FetchHandle>(async () => response)

      const result = await fetchHandler(
        request({ endpoint: '/custom', queryParams: new URLSearchParams({ a: '1' }), responseType: 'json' }),
        handle,
      )

      expect(result.body).toEqual({ id: 1 })
      expect(handle).toHaveBeenCalledOnce()
      expect(handle.mock.calls[0]).toHaveLength(1)
      const [input] = handle.mock.calls[0] ?? []
      expect(input).toBeInstanceOf(Request)
      expect((input as Request).url).toBe('https://example.com/custom?a=1')
      expect(arrayBuffer).not.toHaveBeenCalled()
      expect(calls).toHaveLength(0)
    })

    test('a global fetch replaced after load is a custom handle as well', async () => {
      const { calls, fetchHandler } = await loadTransport(ORIGIN, async () => new Response(null))
      const replacement = vi.fn<FetchHandle>(async () => new Response('ok'))
      vi.stubGlobal('fetch', replacement)

      await fetchHandler(request({ responseType: 'text' }))

      expect(calls).toHaveLength(0)
      expect(replacement.mock.calls[0]).toHaveLength(1)
      expect(replacement.mock.calls[0]?.[0]).toBeInstanceOf(Request)
    })

    test('the platform fetch passed explicitly is not the library default', async () => {
      const { calls, client, http } = await loadTransport(ORIGIN, async () => new Response(null, { status: 204 }))
      const api = client.createClient(client.withEndpoint(ORIGIN), client.withHTTPHandle(globalThis.fetch))
      const ping = http.defineRequest({ method: 'GET', path: '/ping' })

      await api.execute(ping())

      expect(calls).toHaveLength(1)
      expect(calls[0]).toHaveLength(1)
      expect(calls[0]?.[0]).toBeInstanceOf(Request)
    })

    test('cancels a stalled body with the abort reason and releases the lock without waiting for cancellation', async () => {
      const controller = new AbortController()
      const onCancel = vi.fn()
      const body = stalledBody(onCancel)
      const response = new Response(body.stream, { headers: JSON_HEADERS })
      const { ERR_ABORTED, fetchHandler } = await loadTransport(ORIGIN)

      const pending = fetchHandler(request({ abort: controller.signal, responseType: 'json' }), async () => response)
      await body.reading
      controller.abort()

      await expect(settleWithin(pending)).rejects.toBe(ERR_ABORTED)
      expect(onCancel).toHaveBeenCalledExactlyOnceWith(controller.signal.reason)
      expect(response.body?.locked).toBe(false)
    })
  })

  describe('real server', () => {
    const host = inject('testServerHost')
    const stalled = (key: string, overrides: Partial<HttpRequest>) =>
      request({
        baseEndpoint: host,
        endpoint: '/body/stall',
        queryParams: new URLSearchParams({ key }),
        responseType: 'json',
        ...overrides,
      })
    // The server notices a disconnect a moment after the client causes it; allow for a busy host before calling that a leak.
    const serverSees = (fetchImpl: FetchHandle, key: string, expected: object) =>
      vi.waitFor(async () => expect(await stallState(fetchImpl, host, key)).toMatchObject(expected), { timeout: 3000 })
    const scenarios: { expected: object; name: string; overrides: Partial<HttpRequest> }[] = [
      { expected: { body: { id: 1 }, status: 200 }, name: 'json', overrides: { endpoint: '/json', responseType: 'json' } },
      { expected: { body: '{"id":1}', status: 200 }, name: 'text', overrides: { endpoint: '/json', responseType: 'text' } },
      {
        expected: { body: { bytes: Array.from(encoder.encode('{"id":1}')) } },
        name: 'arraybuffer',
        overrides: { endpoint: '/json', responseType: 'arraybuffer' },
      },
      { expected: { body: { blob: '{"id":1}' } }, name: 'blob', overrides: { endpoint: '/json', responseType: 'blob' } },
      { expected: { status: 200 }, name: 'large json', overrides: { endpoint: '/body/large', responseType: 'json' } },
      { expected: { body: undefined, status: 200 }, name: 'discarded body', overrides: { endpoint: '/json' } },
      { expected: { body: undefined, status: 204 }, name: 'no content, undeclared', overrides: { endpoint: '/body/no-content' } },
      // Whether a 204 or a HEAD response has a body stream is the platform's call (browsers give one, Bun and Node do not);
      // the two handles only have to agree.
      { expected: {}, name: 'no content, declared', overrides: { endpoint: '/body/no-content', responseType: 'json' } },
      { expected: {}, name: 'head, declared', overrides: { endpoint: '/json', method: 'HEAD', responseType: 'json' } },
      {
        expected: {},
        name: 'url with credentials',
        overrides: { baseEndpoint: host.replace('://', '://user:pass@'), endpoint: '/json', responseType: 'json' },
      },
      { expected: {}, name: 'invalid method', overrides: { endpoint: '/json', method: 'BAD METHOD', responseType: 'json' } },
      { expected: { body: '', status: 200 }, name: 'empty text', overrides: { endpoint: '/body/empty', responseType: 'text' } },
      { expected: { body: { bytes: [] } }, name: 'empty arraybuffer', overrides: { endpoint: '/body/empty', responseType: 'arraybuffer' } },
      { expected: { code: 'RES_DECODE_FAILED' }, name: 'empty json', overrides: { endpoint: '/body/empty', responseType: 'json' } },
      { expected: { code: 'RES_MEDIA_TYPE_INVALID' }, name: 'media type mismatch', overrides: { endpoint: '/text', responseType: 'json' } },
      {
        expected: { body: { code: 'ACCOUNT_NOT_FOUND' }, status: 404 },
        name: 'declared error body',
        overrides: { endpoint: '/account/not-found', errorResponseType: 'json' },
      },
      {
        expected: { code: 'NET_BODY_INCOMPLETE' },
        name: 'truncated body',
        overrides: { endpoint: '/body/truncated', responseType: 'json' },
      },
    ]

    test.each(scenarios)('default and custom handles agree: $name', async ({ expected, overrides }) => {
      const { DEFAULT_FETCH, fetchHandler, realFetch } = await loadTransport(host)
      const custom: FetchHandle = (input, init) => realFetch(input, init)
      const input = request({ baseEndpoint: host, ...overrides })

      const viaDefault = await outcomeOf(() => fetchHandler(input, DEFAULT_FETCH))
      const viaCustom = await outcomeOf(() => fetchHandler(input, custom))

      expect(viaDefault).toMatchObject(expected)
      expect(viaDefault).toEqual(viaCustom)
    })

    test('reads a large body whole over the default handle', async () => {
      const { DEFAULT_FETCH, fetchHandler } = await loadTransport(host)

      const response = await fetchHandler(request({ baseEndpoint: host, endpoint: '/body/large', responseType: 'json' }), DEFAULT_FETCH)

      const items = response.body as { id: number; name: string }[]
      expect(items).toHaveLength(6000)
      expect(items.at(-1)).toEqual({ id: 5999, name: 'item-5999' })
    })

    test.each(['default', 'custom'] as const)(
      '%s handle: abort mid-body settles with ERR_ABORTED and frees the connection',
      async (kind) => {
        const { DEFAULT_FETCH, ERR_ABORTED, fetchHandler, realFetch } = await loadTransport(host)
        const key = `abort-${kind}`
        const controller = new AbortController()
        const handle: FetchHandle = kind === 'default' ? DEFAULT_FETCH : (input, init) => realFetch(input, init)

        const pending = fetchHandler(stalled(key, { abort: controller.signal }), handle)
        await serverSees(realFetch, key, { opened: 1 })
        controller.abort()

        await expect(settleWithin(pending, 3000)).rejects.toBe(ERR_ABORTED)
        await serverSees(realFetch, key, { closed: 1 })
      },
    )

    test.each(['default', 'custom'] as const)(
      '%s handle: timeout mid-body settles with ERR_TIMEOUT and frees the connection',
      async (kind) => {
        const { DEFAULT_FETCH, ERR_TIMEOUT, fetchHandler, realFetch } = await loadTransport(host)
        const key = `timeout-${kind}`
        const controller = new AbortController()
        const handle: FetchHandle = kind === 'default' ? DEFAULT_FETCH : (input, init) => realFetch(input, init)

        const pending = fetchHandler(stalled(key, { abort: controller.signal }), handle)
        await serverSees(realFetch, key, { opened: 1 })
        // A platform timeout, armed once the body is in flight, so a slow host cannot fire it during the request phase.
        const deadline = AbortSignal.timeout(100)
        deadline.addEventListener('abort', () => controller.abort(deadline.reason), { once: true })

        await expect(settleWithin(pending, 3000)).rejects.toBe(ERR_TIMEOUT)
        await serverSees(realFetch, key, { closed: 1, opened: 1 })
      },
    )
  })
}
