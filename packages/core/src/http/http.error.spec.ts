import { beforeEach, describe, expect, inject, test, vi } from 'vitest'
import { createClient, withEndpoint, withHTTPHandle, withInterceptors } from '../client'
import type { Client } from '../client'
import { ERR_ABORTED } from '../error'
import { createHttpInterceptor } from '../interceptor'
import type { HttpResponse } from '../internal/http_response'
import { makeResponse } from '../internal/http_response'
import { StructError, struct } from '../struct'
import { defineRequest } from './index'
import type { HttpExecuteOptions } from './http'

describe('request http runtime errors', () => {
  let client: Client

  beforeEach(() => {
    client = createClient(withEndpoint(inject('testServerHost')))
  })

  test('should resolve non-2xx responses as http errors with typed data', async () => {
    const useMissingAccount = defineRequest({
      method: 'GET',
      error: struct.object({
        code: struct.string(),
        message: struct.string(),
      }),
      path: '/account/not-found',
    })

    const [error, result, response] = await client.execute(useMissingAccount())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')

    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an http status fault')
    }

    expect(error.status).toBe(404)
    expect(error.response.ok).toBe(false)
    expect(error.response.status).toBe(404)
    expect(error.data).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Account not found',
    })
  })

  test('should return request validation failures as definition errors', async () => {
    const useValidatedRequest = defineRequest({
      builder: () => ({}),
      input: struct.object({
        id: struct.number(),
      }),
      method: 'GET',
      output: struct.null(),
      path: '/null',
    })

    const [error, result, response] = await client.execute(useValidatedRequest({ id: 'oops' } as never))

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('REQ_INPUT_INVALID')

    if (error?.code !== 'REQ_INPUT_INVALID') {
      throw new Error('Expected an input fault')
    }

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('DefjsFault')
    expect(error.cause).toBeInstanceOf(StructError)
    if (!(error.cause instanceof StructError)) {
      throw new Error('Expected the original StructError cause')
    }
    expect(error.cause.format()._errors).toEqual([])
    expect(error.cause.flatten().fieldErrors['id']).toEqual(['Expected number at id, received "oops"'])
    expect(error.cause.prettify()).toBe('× id: Expected number at id, received "oops"')
  })

  test('should stop before build and transport when a required request section is missing', async () => {
    let buildCalls = 0
    let transportCalls = 0
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () => {
          transportCalls += 1
          return makeResponse({ status: 200 })
        }),
      ),
    )
    const useRequest = defineRequest({
      builder(input) {
        buildCalls += 1
        return input
      },
      input: struct.object({
        query: struct.object({ page: struct.number() }),
      }),
      method: 'GET',
      path: '/search',
    })

    const [error, result, response] = await guardedClient.execute(useRequest({} as never))

    expect(error?.code).toBe('REQ_INPUT_INVALID')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(buildCalls).toBe(0)
    expect(transportCalls).toBe(0)
  })

  test('should return response validation failures as definition errors', async () => {
    const useBadResponse = defineRequest({
      method: 'GET',
      output: struct.object({
        id: struct.string(),
      }),
      path: '/json',
    })

    const [error, result, response] = await client.execute(useBadResponse())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('RES_STRUCT_MISMATCH')

    if (error?.code !== 'RES_STRUCT_MISMATCH') {
      throw new Error('Expected a struct mismatch fault')
    }

    expect(error.response.status).toBe(200)
  })

  test.each([
    { cause: TypeError, code: 'RES_MEDIA_TYPE_INVALID', path: '/text', status: 200 },
    { cause: SyntaxError, code: 'RES_DECODE_FAILED', path: '/json/malformed-error', status: 500 },
  ] as const)('should stop on a declared response representation error with $code', async ({ cause, code, path, status }) => {
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.object({ id: struct.number() }),
      error: struct.object({ code: struct.string() }),
      path,
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe(code)
    if (error?.code !== code) {
      throw new Error(`Expected a ${code} fault`)
    }
    expect(error.response.status).toBe(status)
    expect(error.cause).toBeInstanceOf(cause)
    // Philosophy 4: an unreadable body leaves no body and no decoded value.
    expect(error.response).not.toHaveProperty('body')
    expect(error).not.toHaveProperty('data')
  })

  test('should ignore an unreadable body on the side that declared nothing', async () => {
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.null(),
      path: '/json/malformed-error',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    // Philosophy 5: no `error` struct was declared, so the 500's malformed body is none of our
    // business — not even the fact that it could not be read.
    expect(error?.code).toBe('HTTP_STATUS')
    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an http status fault')
    }
    expect(error.status).toBe(500)
    expect(error.data).toBeUndefined()
    expect(error.response).not.toHaveProperty('body')
  })

  test('should report a non-2xx status without a declared error struct as an undecoded fault', async () => {
    const useUndecodedError = defineRequest({
      method: 'GET',
      output: struct.null(),
      path: '/500',
    })

    const [error, result, response] = await client.execute(useUndecodedError())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')

    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an http status fault')
    }

    expect(error.status).toBe(500)
    expect(error.response.status).toBe(500)
    expect(error.data).toBeUndefined()
  })

  test('should return definition error when build throws', async () => {
    const useBadBuild = defineRequest({
      builder: () => {
        throw new Error('build failed')
      },
      input: struct.object({}),
      method: 'GET',
      path: '/test',
    })

    const [error, result, response] = await client.execute(useBadBuild({}))

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('REQ_BUILD_FAILED')

    if (error?.code !== 'REQ_BUILD_FAILED') {
      throw new Error('Expected a build fault')
    }
  })

  test('should return REQ_BUILD_FAILED when the JSON body is a Map', async () => {
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const guardedClient = createClient(withEndpoint('https://example.com'), withHTTPHandle(handle))
    const useRequest = defineRequest({
      builder: () => ({ body: new Map() as never }),
      method: 'POST',
      path: '/users',
    })

    const [fault, result, response] = await guardedClient.execute(useRequest())

    expect(fault?.code).toBe('REQ_BUILD_FAILED')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(fault?.cause).toBeInstanceOf(TypeError)
    expect(fault?.cause instanceof TypeError ? fault.cause.message : '').toMatch(/Map/)
    expect(handle).toHaveBeenCalledTimes(0)
  })

  test('should return REQ_BUILD_FAILED when the JSON body is an async iterable object', async () => {
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const guardedClient = createClient(withEndpoint('https://example.com'), withHTTPHandle(handle))
    const useRequest = defineRequest({
      builder: () => ({
        body: {
          async *[Symbol.asyncIterator]() {
            yield new TextEncoder().encode('chunk')
          },
        },
      }),
      method: 'POST',
      path: '/users',
    })

    const [fault, result, response] = await guardedClient.execute(useRequest())

    expect(fault?.code).toBe('REQ_BUILD_FAILED')
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(fault?.cause).toBeInstanceOf(TypeError)
    expect(fault?.cause instanceof TypeError ? fault.cause.message : '').toMatch(/iterable object/)
    expect(handle).toHaveBeenCalledTimes(0)
  })

  test('should return a definition error when interceptor chain throws', async () => {
    const throwingInterceptor = createHttpInterceptor(async () => {
      throw new Error('interceptor boom')
    })

    const client = createClient(withEndpoint('https://example.com'), withInterceptors(throwingInterceptor))

    const useIntercepted = defineRequest({
      method: 'GET',
      output: struct.null(),
      path: '/intercepted',
    })

    const [error, result, response] = await client.execute(useIntercepted())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('EXT_INTERCEPTOR_FAILED')

    if (error?.code !== 'EXT_INTERCEPTOR_FAILED') {
      throw new Error('Expected an interceptor fault')
    }
    expect(error).toBeInstanceOf(Error)
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).message).toBe('interceptor boom')
  })

  test.each([
    ['abort', 'NET_ABORTED'],
    ['timeout', 'NET_TIMEOUT'],
  ] as const)('should cancel a hanging interceptor on %s', async (mode, expectedCode) => {
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () => {
          markStarted()
          return await new Promise(() => undefined)
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/hanging-interceptor' })
    const pending = guardedClient.execute(useRequest(), mode === 'abort' ? { signal: controller.signal } : { timeout: 1 })

    // A 1ms deadline can fire before the interceptor runs. Waiting on `started` then hangs the test.
    if (mode === 'abort') {
      await started
      controller.abort('caller stopped')
    }
    const result = await Promise.race([pending, new Promise<false>((resolve) => setTimeout(() => resolve(false), 1000))])

    expect(result).not.toBe(false)
    if (result === false) {
      throw new Error('Expected interceptor cancellation to settle')
    }
    expect(result[0]).toMatchObject({ code: expectedCode })
  })

  test('should prefer cancellation when an interceptor aborts and returns a response', async () => {
    const controller = new AbortController()
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () => {
          controller.abort('caller stopped')
          return makeResponse({ status: 200 })
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/cached' })

    const [error, result, response] = await guardedClient.execute(useRequest(), { signal: controller.signal })

    expect(error).toMatchObject({ code: 'NET_ABORTED' })
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
  })

  test.each(['return', 'throw'] as const)('should abort a hidden transport when an interceptor chain settles by %s', async (mode) => {
    const interceptorError = new Error('interceptor failed')
    let hiddenResponse: Promise<HttpResponse<unknown>> | undefined
    let transportSignal: AbortSignal | undefined
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const fetchMock = vi.fn(async (request: Request) => {
      transportSignal = request.signal
      markStarted()
      return await new Promise<Response>(() => undefined)
    }) as unknown as typeof fetch
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(fetchMock),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          hiddenResponse = next(request)
          await started
          if (mode === 'throw') {
            throw interceptorError
          }
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/hidden' })

    const [error, result, response] = await guardedClient.execute(useRequest())

    expect(transportSignal?.aborted).toBe(true)
    await expect(hiddenResponse).rejects.toBe(ERR_ABORTED)
    if (mode === 'throw') {
      expect(error).toMatchObject({ cause: interceptorError, code: 'EXT_INTERCEPTOR_FAILED' })
      expect(error).toBeInstanceOf(Error)
      expect(response).toBeUndefined()
    } else {
      expect(error).toBeNull()
      expect(response?.status).toBe(204)
    }
    expect(result).toBeUndefined()
  })

  test('should reject interceptor next calls after the HTTP chain settles', async () => {
    let lateResponse: Promise<HttpResponse<unknown>> | undefined
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(fetchMock as unknown as typeof fetch),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          setTimeout(() => {
            lateResponse = next(request)
            void lateResponse.catch(() => undefined)
          }, 0)
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/cached' })

    const [error] = await guardedClient.execute(useRequest())
    await vi.waitFor(() => expect(lateResponse).toBeDefined())

    expect(error).toBeNull()
    await expect(lateResponse).rejects.toThrow('HTTP interceptor next() cannot be called after the chain has settled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test.each([ERR_ABORTED, 'caller stopped', new Error('Request timed out')])(
    'should return aborted error when signal is already aborted with %s',
    async (reason) => {
      const controller = new AbortController()
      controller.abort(reason)
      const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
      const guardedClient = createClient(withEndpoint('https://example.com'), withHTTPHandle(fetchMock as unknown as typeof fetch))

      const useRequest = defineRequest({
        method: 'GET',
        output: struct.null(),
        path: '/null',
      })

      const [error, result, response] = await guardedClient.execute(useRequest(), { signal: controller.signal })

      expect(result).toBeUndefined()
      expect(response).toBeUndefined()
      expect(error?.code).toBe('NET_ABORTED')
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  test('should reject with.abort and with.timeout before parsing HTTP input', async () => {
    const controller = new AbortController()
    const useRequest = defineRequest({
      builder: () => ({}),
      input: struct.object({
        id: struct.string(),
      }),
      method: 'GET',
      output: struct.null(),
      path: '/null',
    })

    const [error, result, response] = await client.execute(useRequest({ id: 1 } as never), {
      abort: controller.signal,
      timeout: 1,
    } as never)

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('REQ_OPTIONS_INVALID')
    expect(error?.message).toBe('abort and timeout cannot be used together')
  })

  test('should prefer HTTP cancellation config conflict over an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort(ERR_ABORTED)
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.null(),
      path: '/null',
    })

    const [error, result, response] = await client.execute(useRequest(), { abort: controller.signal, timeout: 1 } as never)

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('REQ_OPTIONS_INVALID')
    expect(error?.message).toBe('abort and timeout cannot be used together')
  })

  test.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'should reject invalid timeout %s before HTTP transport',
    async (timeout) => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
      const guardedClient = createClient(withEndpoint('https://example.com'), withHTTPHandle(fetchMock as unknown as typeof fetch))
      const useRequest = defineRequest({ method: 'GET', path: '/timeout' })

      const [error, result, response] = await guardedClient.execute(useRequest(), { timeout })

      expect(error).toMatchObject({ code: 'REQ_OPTIONS_INVALID' })
      expect(result).toBeUndefined()
      expect(response).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  test('should prefer invalid timeout over an already aborted HTTP signal alias', async () => {
    const controller = new AbortController()
    controller.abort('caller stopped')
    const useRequest = defineRequest({ method: 'GET', path: '/timeout' })

    const [error] = await client.execute(useRequest(), { signal: controller.signal, timeout: 0 })

    expect(error).toMatchObject({ code: 'REQ_OPTIONS_INVALID' })
  })

  test('should snapshot HTTP cancellation options before asynchronous work', async () => {
    let timeoutReads = 0
    const options = {
      get timeout() {
        timeoutReads += 1
        return timeoutReads === 1 ? undefined : Number.POSITIVE_INFINITY
      },
    }
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    const guardedClient = createClient(withEndpoint('https://example.com'), withHTTPHandle(fetchMock as unknown as typeof fetch))
    const useRequest = defineRequest({ method: 'GET', path: '/snapshot' })

    const [error, result, response] = await guardedClient.execute(useRequest(), options as HttpExecuteOptions)

    expect(error).toBeNull()
    expect(result).toBeUndefined()
    expect(response?.status).toBe(204)
    expect(timeoutReads).toBe(1)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  test('should return a definition error when reading HTTP cancellation options throws', async () => {
    const options = Object.defineProperty({}, 'abort', {
      get() {
        throw new Error('abort getter failed')
      },
    })
    const useRequest = defineRequest({ method: 'GET', path: '/snapshot' })

    const [error, result, response] = await client.execute(useRequest(), options as HttpExecuteOptions)

    expect(error).toMatchObject({ code: 'REQ_OPTIONS_INVALID' })
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
  })

  test('should return ABORTED when signal is aborted with explicit undefined reason', async () => {
    const signal = { aborted: true, reason: undefined } as AbortSignal

    const useRequest = defineRequest({
      method: 'GET',
      output: struct.null(),
      path: '/null',
    })

    const [error, result, response] = await client.execute(useRequest(), { abort: signal })

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('NET_ABORTED')
  })

  test('should classify an interceptor that throws the abort sentinel as cancellation', async () => {
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () => {
          throw ERR_ABORTED
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/transport-error' })

    const [error, result, response] = await guardedClient.execute(useRequest())

    expect(error).toMatchObject({ cause: ERR_ABORTED, code: 'NET_ABORTED' })
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
  })

  test('should classify an async download observer rejection as a transport error', async () => {
    const observerError = new Error('download observer failed')
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(async () => new Response('ok', { headers: { 'content-type': 'text/plain' } })),
    )
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.string(),
      path: '/download',
    })

    const [error, result, response] = await guardedClient.execute(useRequest(), {
      async onDownloadProgress() {
        throw observerError
      },
    })

    expect(error).toMatchObject({ cause: observerError, code: 'EXT_OBSERVER_FAILED' })
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
  })

  test('should use HTTP status message when response.error is undefined without output', async () => {
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: null,
            status: 500,
            statusText: 'Server Error',
            url: 'https://example.com/test',
          }),
        ),
      ),
    )

    const useRequest = defineRequest({
      method: 'GET',
      path: '/test',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')
    expect(error?.response?.status).toBe(500)
    expect(error?.message).toContain('500')
  })

  test('should use HTTP status message when response.error is undefined with output struct', async () => {
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: { code: 'ERR' },
            headers: new Headers([['content-type', 'application/json']]),
            status: 500,
            statusText: 'Server Error',
            url: 'https://example.com/test',
          }),
        ),
      ),
    )

    const useRequest = defineRequest({
      method: 'GET',
      error: struct.object({ code: struct.string() }),
      path: '/test',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')
    expect(error?.response?.status).toBe(500)
    expect(error?.message).toContain('500')
    if (error?.code === 'HTTP_STATUS') {
      expect(error.data).toEqual({ code: 'ERR' })
    }
  })

  test('should expose error on ref after failed request', async () => {
    const useBadRequest = defineRequest({
      builder: () => ({}),
      input: struct.object({
        id: struct.number(),
      }),
      method: 'GET',
      output: struct.null(),
      path: '/null',
    })

    const [error] = await client.execute(useBadRequest({ id: 'invalid' } as never))

    expect(error?.code).toBe('REQ_INPUT_INVALID')
  })

  test('should cancel a pending request', async () => {
    const useDelay = defineRequest({
      builder: (input) => input,
      input: struct.object({
        query: struct.object({
          ms: struct.number(),
        }),
      }),
      method: 'GET',
      output: struct.null(),
      path: '/delay',
    })

    const controller = new AbortController()
    const command = useDelay({ query: { ms: 5000 } })
    const promise = client.execute(command, { signal: controller.signal })
    controller.abort()

    const [error] = await promise
    expect(error?.code).toBe('NET_ABORTED')
  })

  test('should return transport error with ABORTED code when interceptor aborts', async () => {
    const abortingInterceptor = createHttpInterceptor(async (req, next) => {
      const result = await next(req)
      if (result.status === 200) {
        throw ERR_ABORTED
      }
      return result
    })

    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        abortingInterceptor,
        createHttpInterceptor(async () =>
          makeResponse({
            body: null,
            status: 200,
          }),
        ),
      ),
    )

    const useRequest = defineRequest({
      method: 'GET',
      output: struct.null(),
      path: '/test',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('NET_ABORTED')
  })

  test('should ignore a representation error when output is not declared', async () => {
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: null,
            headers: new Headers(),
            status: 500,
            statusText: 'Server Error',
            url: 'https://example.com/test',
          }),
        ),
      ),
    )

    const useRequest = defineRequest({
      method: 'GET',
      path: '/test',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')
    expect(error?.response?.status).toBe(500)
    expect(error?.message).toBe('Http failure response: 500 - Server Error')
  })

  test('should decode an interceptor short-circuit through the same path as a real response', async () => {
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: { code: 'ERR' },
            headers: new Headers([['content-type', 'application/json']]),
            status: 500,
            statusText: 'Server Error',
            url: 'https://example.com/test',
          }),
        ),
      ),
    )

    const useRequest = defineRequest({
      method: 'GET',
      error: struct.object({ code: struct.string() }),
      path: '/test',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')

    if (error?.code !== 'HTTP_STATUS') {
      throw new Error('Expected an http status fault')
    }

    // Decoding happens once, after the chain: where a response came from does not change
    // how it is interpreted.
    expect(error.status).toBe(500)
    expect(error.data).toEqual({ code: 'ERR' })
  })

  test('should return success for ok response without output', async () => {
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: null,
            status: 204,
            url: 'https://example.com/test',
          }),
        ),
      ),
    )

    const useRequest = defineRequest({
      method: 'GET',
      path: '/test',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(error).toBeNull()
    expect(result).toBeUndefined()
    expect(response?.ok).toBe(true)
  })

  test('should use Error message for non-ok response without output', async () => {
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: null,
            status: 500,
            statusText: 'Internal Server Error',
            url: 'https://example.com/test',
          }),
        ),
      ),
    )

    const useRequest = defineRequest({
      method: 'GET',
      path: '/test',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')
    expect(error?.response?.status).toBe(500)
    expect(error?.message).toContain('500')
    expect(error?.message).toContain('Internal Server Error')
  })

  test('should use Error message for non-ok response with output struct', async () => {
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body: { code: 'ERR' },
            headers: new Headers([['content-type', 'application/json']]),
            status: 500,
            statusText: 'Server Error',
            url: 'https://example.com/test',
          }),
        ),
      ),
    )

    const useRequest = defineRequest({
      method: 'GET',
      error: struct.object({ code: struct.string() }),
      path: '/test',
    })

    const [error, result, response] = await client.execute(useRequest())

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('HTTP_STATUS')
    expect(error?.response?.status).toBe(500)
    expect(error?.message).toContain('500')
    expect(error?.message).toContain('Server Error')
    if (error?.code === 'HTTP_STATUS') {
      expect(error.data).toEqual({ code: 'ERR' })
    }
  })

  test('should support timeout in second-stage config', async () => {
    const useDelay = defineRequest({
      builder: (input) => input,
      input: struct.object({
        query: struct.object({
          ms: struct.number(),
        }),
      }),
      method: 'GET',
      output: struct.null(),
      path: '/delay',
    })

    const [error, result, response] = await client.execute(useDelay({ query: { ms: 100 } }), { timeout: 10 })

    expect(result).toBeUndefined()
    expect(response).toBeUndefined()
    expect(error?.code).toBe('NET_TIMEOUT')
  })

  test('should release the timeout timer after a successful request without aborting its signal', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const successfulClient = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(async () => new Response(null, { status: 204 })),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          requestSignal = request.abort
          return next(request)
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/success' })

    try {
      const [error, result, response] = await successfulClient.execute(useRequest(), { timeout: 60_000 })

      expect(error).toBeNull()
      expect(result).toBeUndefined()
      expect(response?.status).toBe(204)
      expect(requestSignal?.aborted).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('should report timeout when synchronous response conversion outlasts the deadline', async () => {
    let clock = 1_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const body: { id?: number } = {}
    Object.defineProperty(body, 'id', {
      enumerable: true,
      get() {
        clock += 40
        return 1
      },
    })
    const slowClient = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body,
            headers: new Headers({ 'content-type': 'application/json' }),
            status: 200,
          }),
        ),
      ),
    )
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.object({ id: struct.number() }),
      path: '/slow-decode',
    })

    try {
      const [error, result] = await slowClient.execute(useRequest(), { timeout: 30 })

      expect(result).toBeUndefined()
      expect(error?.code).toBe('NET_TIMEOUT')
    } finally {
      now.mockRestore()
    }
  })

  test('should prefer caller cancellation when synchronous response conversion also crosses the deadline', async () => {
    let clock = 1_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const controller = new AbortController()
    const body: { id?: number } = {}
    Object.defineProperty(body, 'id', {
      enumerable: true,
      get() {
        controller.abort('caller stopped')
        clock += 40
        return 1
      },
    })
    const slowClient = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body,
            headers: new Headers({ 'content-type': 'application/json' }),
            status: 200,
          }),
        ),
      ),
    )
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.object({ id: struct.number() }),
      path: '/slow-decode',
    })

    try {
      const [error, result] = await slowClient.execute(useRequest(), { signal: controller.signal, timeout: 30 })

      expect(result).toBeUndefined()
      expect(error?.code).toBe('NET_ABORTED')
    } finally {
      now.mockRestore()
    }
  })

  test('should report timeout when a declared error conversion outlasts the deadline', async () => {
    let clock = 1_000
    let converted = false
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const body: { id?: number } = {}
    Object.defineProperty(body, 'id', {
      enumerable: true,
      get() {
        converted = true
        clock += 40
        return 1
      },
    })
    const slowClient = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body,
            headers: new Headers({ 'content-type': 'application/json' }),
            status: 403,
          }),
        ),
      ),
    )
    const shape = struct.object({ id: struct.number() })
    const useRequest = defineRequest({
      error: shape,
      method: 'GET',
      output: shape,
      path: '/slow-error',
    })

    try {
      const [error, result] = await slowClient.execute(useRequest(), { timeout: 30 })

      expect(converted).toBe(true)
      expect(result).toBeUndefined()
      expect(error?.code).toBe('NET_TIMEOUT')
    } finally {
      now.mockRestore()
    }
  })

  test('should report timeout when declared conversion fails after the deadline', async () => {
    let clock = 1_000
    let converted = false
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const body: { id?: number } = {}
    Object.defineProperty(body, 'id', {
      enumerable: true,
      get() {
        converted = true
        clock += 40
        return 'wrong' as unknown as number
      },
    })
    const slowClient = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body,
            headers: new Headers({ 'content-type': 'application/json' }),
            status: 200,
          }),
        ),
      ),
    )
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.object({ id: struct.number() }),
      path: '/slow-mismatch',
    })

    try {
      const [error, result] = await slowClient.execute(useRequest(), { timeout: 30 })

      expect(converted).toBe(true)
      expect(result).toBeUndefined()
      expect(error?.code).toBe('NET_TIMEOUT')
    } finally {
      now.mockRestore()
    }
  })

  test('should report timeout when synchronous decoding throws after the deadline', async () => {
    let clock = 1_000
    let converted = false
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const body: { id?: number } = {}
    Object.defineProperty(body, 'id', {
      enumerable: true,
      get() {
        converted = true
        clock += 40
        throw new TypeError('broken body')
      },
    })
    const slowClient = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body,
            headers: new Headers({ 'content-type': 'application/json' }),
            status: 200,
          }),
        ),
      ),
    )
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.object({ id: struct.number() }),
      path: '/slow-decode-throw',
    })

    try {
      const [error, result] = await slowClient.execute(useRequest(), { timeout: 30 })

      expect(converted).toBe(true)
      expect(result).toBeUndefined()
      expect(error?.code).toBe('NET_TIMEOUT')
    } finally {
      now.mockRestore()
    }
  })

  test('should prefer caller cancellation when declared conversion fails after the deadline', async () => {
    let clock = 1_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const controller = new AbortController()
    const body: { id?: number } = {}
    Object.defineProperty(body, 'id', {
      enumerable: true,
      get() {
        controller.abort('caller stopped')
        clock += 40
        return 'wrong' as unknown as number
      },
    })
    const slowClient = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async () =>
          makeResponse({
            body,
            headers: new Headers({ 'content-type': 'application/json' }),
            status: 200,
          }),
        ),
      ),
    )
    const useRequest = defineRequest({
      method: 'GET',
      output: struct.object({ id: struct.number() }),
      path: '/slow-mismatch-abort',
    })

    try {
      const [error, result] = await slowClient.execute(useRequest(), { signal: controller.signal, timeout: 30 })

      expect(result).toBeUndefined()
      expect(error?.code).toBe('NET_ABORTED')
    } finally {
      now.mockRestore()
    }
  })

  test('should report timeout when an undeclared response outlasts the deadline', async () => {
    let clock = 1_000
    let converted = false
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const body: { id?: number } = {}
    Object.defineProperty(body, 'id', {
      enumerable: true,
      get() {
        converted = true
        return 1
      },
    })
    const slowClient = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async () => {
          clock += 40
          return makeResponse({
            body,
            headers: new Headers({ 'content-type': 'application/json' }),
            status: 200,
          })
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/slow-undeclared' })

    try {
      const [error, result] = await slowClient.execute(useRequest(), { timeout: 30 })

      expect(converted).toBe(false)
      expect(result).toBeUndefined()
      expect(error?.code).toBe('NET_TIMEOUT')
    } finally {
      now.mockRestore()
    }
  })

  test('should release the timeout timer when request construction fails', async () => {
    vi.useFakeTimers()
    const buildError = new Error('build failed')
    const useRequest = defineRequest({
      builder() {
        throw buildError
      },
      input: struct.object({ id: struct.string() }),
      method: 'GET',
      path: '/build-error',
    })

    try {
      const [error, result, response] = await client.execute(useRequest({ id: 'request' }), { timeout: 60_000 })

      expect(error).toMatchObject({ cause: buildError, code: 'REQ_BUILD_FAILED' })
      expect(result).toBeUndefined()
      expect(response).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('should return TIMEOUT when an interceptor never settles after next resolves', async () => {
    vi.useFakeTimers()
    let markNextResolved!: () => void
    const nextResolved = new Promise<void>((resolve) => {
      markNextResolved = resolve
    })
    const hangingClient = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(async () => new Response(null, { status: 204 })),
      withInterceptors(
        createHttpInterceptor(async (request, next) => {
          await next(request)
          markNextResolved()
          return await new Promise<never>(() => undefined)
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/hang-after-next' })

    try {
      const pending = hangingClient.execute(useRequest(), { timeout: 40 })
      let outcome: Awaited<typeof pending> | undefined
      void pending.then((result) => {
        outcome = result
      })

      await nextResolved
      await vi.advanceTimersByTimeAsync(40)

      expect(outcome?.[0]).toMatchObject({ code: 'NET_TIMEOUT' })
      expect(outcome?.[1]).toBeUndefined()
      expect(outcome?.[2]).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('should time out a hanging HTTP handle with a platform timer', async () => {
    vi.useFakeTimers()
    const hangingClient = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(() => new Promise<Response>(() => undefined)),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/hang' })

    try {
      const pending = hangingClient.execute(useRequest(), { timeout: 40 })
      await vi.advanceTimersByTimeAsync(40)

      const [error, result, response] = await pending
      expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
      expect(result).toBeUndefined()
      expect(response).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('should settle interceptor finally before returning TIMEOUT', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const logs: string[] = []
    let markEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    let settled = false
    const hangingClient = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(() => new Promise<Response>(() => undefined)),
      withInterceptors(
        createHttpInterceptor(async (req, next) => {
          markEntered()
          try {
            return await next(req)
          } finally {
            logs.push('after')
          }
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/hang' })

    try {
      const pending = hangingClient.execute(useRequest(), { timeout: 40 })
      void pending.then(() => {
        settled = true
      })

      await entered
      expect(settled).toBe(false)
      expect(logs).toEqual([])
      await vi.advanceTimersByTimeAsync(40)
      expect(settled).toBe(true)
      const [error] = await pending
      expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
      expect(logs).toEqual(['after'])
    } finally {
      vi.useRealTimers()
    }
  })

  test.each(['abort', 'timeout'] as const)('should classify a pre-cancelled interceptor signal as %s without fetching', async (mode) => {
    let fetches = 0
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response(null, { status: 204 })
      }),
      withInterceptors(
        createHttpInterceptor((_request, next) =>
          next({
            ..._request,
            abort: AbortSignal.abort(mode === 'timeout' ? new DOMException('deadline', 'TimeoutError') : 'stop'),
          }),
        ),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/preabort' })

    const [error] = await guardedClient.execute(useRequest())

    expect(fetches).toBe(0)
    expect(error?.code).toBe(mode === 'timeout' ? 'NET_TIMEOUT' : 'NET_ABORTED')
  })

  test('should classify a non-Error interceptor throw as INTERCEPTOR_FAILED', async () => {
    const guardedClient = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async () => {
          throw 'interceptor boom'
        }),
      ),
    )
    const useRequest = defineRequest({ method: 'GET', path: '/intercepted' })

    const [error] = await guardedClient.execute(useRequest())

    expect(error).toMatchObject({ code: 'EXT_INTERCEPTOR_FAILED', message: 'interceptor boom' })
    expect(error).toBeInstanceOf(Error)
  })
})
