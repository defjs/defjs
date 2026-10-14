import { runInNewContext } from 'node:vm'
import { describe, expect, test } from 'vitest'
import type { DecodedResponse, HttpMeta } from '../internal/http_response'
import { ERR_ABORTED, ERR_TIMEOUT } from './cause'
import {
  createDecodeFault,
  createHttpStatusFault,
  createNetworkFault,
  createPreflightFault,
  createUndecodedHttpStatusFault,
} from './factory'

function meta(overrides: Partial<HttpMeta> = {}): HttpMeta {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    ok: false,
    status: 404,
    statusText: 'Not Found',
    url: 'https://api.example.test/users/1',
    ...overrides,
  }
}

function decoded<TBody>(body: TBody, overrides: Partial<HttpMeta> = {}): DecodedResponse<TBody> {
  return { ...meta(overrides), body }
}

function expectNativeFault(fault: Error, expectedKeys: string[], cause?: unknown): void {
  expect(fault).toBeInstanceOf(Error)
  expect(fault.name).toBe('DefjsFault')
  expect(String(fault)).toBe(`DefjsFault: ${fault.message}`)
  expect(Object.getOwnPropertyDescriptor(fault, 'name')).toEqual({
    configurable: true,
    enumerable: false,
    value: 'DefjsFault',
    writable: true,
  })
  expect(Object.getOwnPropertyDescriptor(fault, 'cause')).toEqual({
    configurable: true,
    enumerable: false,
    value: cause,
    writable: true,
  })
  expect(Object.keys(JSON.parse(JSON.stringify(fault)))).toEqual(expectedKeys)
  expect(JSON.parse(JSON.stringify(fault))).not.toHaveProperty('cause')
  expect(JSON.parse(JSON.stringify(fault))).not.toHaveProperty('name')
}

describe('fault factories', () => {
  describe('createHttpStatusFault', () => {
    test('should expose the decoded body when an error struct was declared', () => {
      const response = decoded({ code: 'not_found', message: 'missing' })
      const fault = createHttpStatusFault(response)

      expect(fault).toMatchObject({
        code: 'HTTP_STATUS',
        data: { code: 'not_found', message: 'missing' },
        status: 404,
      })
      expect(fault.response).toBe(response)
      expect(fault.response.body).toEqual({ code: 'not_found', message: 'missing' })
      expect(fault.message).toBe('Http failure response: 404 - Not Found')
      expectNativeFault(fault, ['code', 'data', 'response', 'status'])
    })

    test('should leave data undefined when no error struct was declared', () => {
      const response = meta()
      const fault = createUndecodedHttpStatusFault(response)

      expect(fault.code).toBe('HTTP_STATUS')
      expect(fault.data).toBeUndefined()
      expect(fault.response).toBe(response)
      expect(fault.response).not.toHaveProperty('body')
      // `data` stays an own property so the field is always present; JSON simply omits undefined.
      expect(Object.hasOwn(fault, 'data')).toBe(true)
      expectNativeFault(fault, ['code', 'response', 'status'])
    })

    test('should omit the status text from the message when the peer sent none', () => {
      const fault = createUndecodedHttpStatusFault(meta({ status: 503, statusText: '' }))

      expect(fault.message).toBe('Http failure response: 503')
      expect(fault.status).toBe(503)
    })
  })

  describe('createDecodeFault', () => {
    test.each([['RES_DECODE_FAILED'], ['RES_MEDIA_TYPE_INVALID'], ['RES_STRUCT_MISMATCH']] as const)(
      'should report %s with metadata but no body',
      (code) => {
        const cause = new Error('boom')
        const response = meta()
        const fault = createDecodeFault(code, cause, response)

        expect(fault).toMatchObject({ code, status: 404 })
        expect(fault.response).toBe(response)
        expect(fault.response).not.toHaveProperty('body')
        expect(fault.cause).toBe(cause)
        expect(fault.message).toBe('boom')
        expectNativeFault(fault, ['code', 'response', 'status'], cause)
      },
    )

    test('should stringify a non-error cause', () => {
      const fault = createDecodeFault('RES_DECODE_FAILED', 'unexpected token <', meta())

      expect(fault.message).toBe('unexpected token <')
      expect(fault.cause).toBe('unexpected token <')
    })

    test('should leave a JSON parser fragment out of a RES_DECODE_FAILED message', () => {
      const cause = new SyntaxError('Unexpected token \'s\', "session=FA"... is not valid JSON')
      const response = meta()
      const fault = createDecodeFault('RES_DECODE_FAILED', cause, response)

      expect(fault.message).toBe('Response body could not be decoded')
      expect(fault.cause).toBe(cause)
      expect(String(fault)).toBe('DefjsFault: Response body could not be decoded')
      expect(String(fault)).not.toContain('session=FA')
      expectNativeFault(fault, ['code', 'response', 'status'], cause)
    })
  })

  describe('createPreflightFault', () => {
    test('should report a caller fault without a response', () => {
      const cause = new Error('input invalid')
      const fault = createPreflightFault('REQ_INPUT_INVALID', cause)

      expect(fault.code).toBe('REQ_INPUT_INVALID')
      expect(fault.response).toBeUndefined()
      expect(fault.message).toBe('input invalid')
      expectNativeFault(fault, ['code'], cause)
    })

    test('should attach response metadata when the transport had some', () => {
      const response = meta({ ok: true, status: 200, statusText: 'OK' })
      const fault = createPreflightFault('NET_BODY_INCOMPLETE', new Error('terminated'), response)

      expect(fault.code).toBe('NET_BODY_INCOMPLETE')
      expect(fault.response).toBe(response)
      expectNativeFault(fault, ['code', 'response'], fault.cause)
    })

    test('should fall back to the code as the message when there is no cause', () => {
      const fault = createPreflightFault('ENV_UNSUPPORTED')

      expect(fault.message).toBe('ENV_UNSUPPORTED')
      expect(fault.cause).toBeUndefined()
      expectNativeFault(fault, ['code'])
    })

    test('should stringify a non-error cause', () => {
      const fault = createPreflightFault('REQ_OPTIONS_INVALID', 'abort and timeout are exclusive')

      expect(fault.message).toBe('abort and timeout are exclusive')
    })
  })

  describe('createNetworkFault', () => {
    test.each([
      ['aborted', 'NET_ABORTED'],
      ['timeout', 'NET_TIMEOUT'],
    ] as const)('should recognize the %s brand on an error from another realm', (brand, code) => {
      const cause = runInNewContext(
        `Object.defineProperty(new Error('foreign cause'), Symbol.for('defjs.cause.${brand}'), { value: true })`,
      )

      expect(cause).not.toBeInstanceOf(Error)
      const fault = createNetworkFault(cause)
      expect(fault.code).toBe(code)
      expect(fault.cause).toBe(cause)
    })

    test('should recognize the shared abort sentinel', () => {
      const fault = createNetworkFault(ERR_ABORTED)

      expect(fault.code).toBe('NET_ABORTED')
      expect(fault.message).toBe(ERR_ABORTED.message)
    })

    test('should recognize abort and timeout sentinels branded by another copy', () => {
      const foreignAbort = new Error('Request was aborted')
      const foreignTimeout = new Error('Request timed out')
      Object.defineProperty(foreignAbort, Symbol.for('defjs.cause.aborted'), { value: true })
      Object.defineProperty(foreignTimeout, Symbol.for('defjs.cause.timeout'), { value: true })

      expect(foreignAbort).not.toBe(ERR_ABORTED)
      expect(foreignTimeout).not.toBe(ERR_TIMEOUT)
      expect(createNetworkFault(foreignAbort).code).toBe('NET_ABORTED')
      expect(createNetworkFault(foreignTimeout)).toMatchObject({ code: 'NET_TIMEOUT', message: 'Request timed out' })
      expect(Object.getOwnPropertyDescriptor(ERR_ABORTED, Symbol.for('defjs.cause.aborted'))?.enumerable).toBe(false)
      expect(Object.getOwnPropertyDescriptor(ERR_TIMEOUT, Symbol.for('defjs.cause.timeout'))?.enumerable).toBe(false)
    })

    test('should recognize a DOMException abort', () => {
      const cause = new DOMException('stop', 'AbortError')
      const fault = createNetworkFault(cause)

      expect(fault.code).toBe('NET_ABORTED')
      expect(fault.message).toBe(ERR_ABORTED.message)
      expect(fault.cause).toBe(cause)
    })

    test('should recognize the shared timeout sentinel', () => {
      const fault = createNetworkFault(ERR_TIMEOUT)

      expect(fault.code).toBe('NET_TIMEOUT')
      expect(fault.message).toBe(ERR_TIMEOUT.message)
    })

    test('should keep a timeout cause message when it has one', () => {
      const fault = createNetworkFault(new DOMException('took too long', 'TimeoutError'))

      expect(fault.code).toBe('NET_TIMEOUT')
      expect(fault.message).toBe('took too long')
    })

    test('should fall back to the shared timeout message when the cause has none', () => {
      const cause = new DOMException('', 'TimeoutError')
      const fault = createNetworkFault(cause)

      expect(fault.code).toBe('NET_TIMEOUT')
      expect(fault.message).toBe(ERR_TIMEOUT.message)
    })

    test('should treat anything else as unreachable', () => {
      const fault = createNetworkFault(new TypeError('fetch failed'))

      expect(fault.code).toBe('NET_UNREACHABLE')
      expect(fault.message).toBe('fetch failed')
    })

    test('should stringify a non-error cause', () => {
      const fault = createNetworkFault('offline')

      expect(fault.code).toBe('NET_UNREACHABLE')
      expect(fault.message).toBe('offline')
    })

    test('should attach response metadata when given', () => {
      const response = meta({ ok: true, status: 200, statusText: 'OK' })
      const fault = createNetworkFault(new Error('terminated'), response)

      expect(fault.code).toBe('NET_UNREACHABLE')
      expect(fault.response).toBe(response)
    })
  })
})
