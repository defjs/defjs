import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { testClient } from '../test-setup'
import { cloneClient } from './client'
import { ERR_NOT_FOUND_HANDLER, ERR_TIMEOUT, HttpErrorResponse } from './error'
import { field } from './field'
import { setGlobalHttpHandler } from './handler/handler'
import {
  type HttpRequest,
  __buildFieldDefaultValue,
  __detectContentTypeHeader,
  __fillRequestFromField,
  __fillUrl,
  __serializeBody,
  defineRequest,
} from './request'

describe('Request', () => {
  test('should build field default value', () => {
    expect(__buildFieldDefaultValue(field(1))).toBe(1)
    expect(__buildFieldDefaultValue(field('Hello World!'))).toBe('Hello World!')
    expect(__buildFieldDefaultValue(field(true))).toBe(true)
    expect(__buildFieldDefaultValue(field(false))).toBe(false)
    expect(__buildFieldDefaultValue(field([]))).toEqual([])
    expect(__buildFieldDefaultValue(field({}))).toEqual({})
    expect(__buildFieldDefaultValue(field(null))).toBeNull()
    expect(__buildFieldDefaultValue(field(undefined))).toBeUndefined()

    expect(__buildFieldDefaultValue({ id: field(1), name: field('Hello World!') })).toEqual({ id: 1, name: 'Hello World!' })

    expect(__buildFieldDefaultValue()).toBeUndefined()
  })

  describe('detect Content-Type', () => {
    test('should JPEG Blob is image/jpeg', () => {
      expect(__detectContentTypeHeader(new Blob([], { type: 'image/jpeg' }))).toBe('image/jpeg')
    })

    test('should Unknown type blob is octet-stream', () => {
      expect(__detectContentTypeHeader(new Blob([]))).toBe('application/octet-stream')
    })

    test('should FormData is multipart/form-data', () => {
      expect(__detectContentTypeHeader(new FormData())).toBe('multipart/form-data')
    })

    test('should ArrayBuffer is application/octet-stream', () => {
      expect(__detectContentTypeHeader(new ArrayBuffer(10))).toBe('application/octet-stream')
    })

    test('should URLSearchParams is application/x-www-form-urlencoded', () => {
      expect(__detectContentTypeHeader(new URLSearchParams())).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    })

    test('should String is text/plain', () => {
      expect(__detectContentTypeHeader('Hello World!')).toBe('text/plain')
    })

    test('should Object is application/json', () => {
      expect(__detectContentTypeHeader({ banner: 'Hello World!' })).toBe('application/json')
    })

    test('should Number is application/json', () => {
      expect(__detectContentTypeHeader(0)).toBe('application/json')
      expect(__detectContentTypeHeader(1)).toBe('application/json')
    })

    test('should Boolean is application/json', () => {
      expect(__detectContentTypeHeader(true)).toBe('application/json')
      expect(__detectContentTypeHeader(false)).toBe('application/json')
    })

    test('should Null is Null', () => {
      expect(__detectContentTypeHeader(null)).toBeNull()
    })

    test('should Undefined is Null', () => {
      expect(__detectContentTypeHeader(undefined)).toBeNull()
    })
  })

  describe('serialize body', () => {
    test('should FormData is FormData', () => {
      expect(__serializeBody(new FormData())).toBeInstanceOf(FormData)
    })

    test('should Blob is Blob', () => {
      expect(__serializeBody(new Blob())).toBeInstanceOf(Blob)
    })

    test('should URLSearchParams is String', () => {
      expect(__serializeBody(new URLSearchParams())).toBeInstanceOf(URLSearchParams)
    })

    test('should ArrayBuffer is ArrayBuffer', () => {
      expect(__serializeBody(new ArrayBuffer(0))).toBeInstanceOf(ArrayBuffer)
    })

    test('should String is String', () => {
      expect(__serializeBody('')).toBeTypeOf('string')
    })

    test('should Object is string', () => {
      expect(__serializeBody({})).toBeTypeOf('string')
    })

    test('should Boolean is string', () => {
      expect(__serializeBody(true)).toBeTypeOf('string')
      expect(__serializeBody(false)).toBeTypeOf('string')
    })

    test('should Number is string', () => {
      expect(__serializeBody(0)).toBeTypeOf('string')
      expect(__serializeBody(1)).toBeTypeOf('string')
    })
  })

  describe('define request', () => {
    test('should return a function', () => {
      expect(defineRequest('', '')).toBeTypeOf('function')
    })

    test('should set upload progress', () => {
      const useRequest = defineRequest('POST', '/')
      const { setUploadProgress } = useRequest()
      setUploadProgress(() => void 0)
    })

    test('should set download progress', () => {
      const useRequest = defineRequest('POST', '/')
      const { setDownloadProgress } = useRequest()
      setDownloadProgress(() => void 0)
    })

    test('should throw error when define input but not use', () => {
      const useRequest = defineRequest('POST', '/').withField(field<number>())
      const { doRequest } = useRequest()

      // @ts-ignore
      expect(() => doRequest()).toThrowError()
    })

    test('should throw error when use abort signal timeout', async () => {
      const signal = AbortSignal.timeout(100)
      const useRequest = defineRequest('POST', '/')
      const { doRequest } = useRequest()

      try {
        await doRequest({ abort: signal, client: testClient })
      } catch (e) {
        if (!(e instanceof HttpErrorResponse)) {
          throw new Error('Not HttpErrorResponse')
        }
        expect(e.cause).toBe(ERR_TIMEOUT)
      }
    })

    test('should throw error when set timeout option', async () => {
      const useRequest = defineRequest('POST', '/')
      const { doRequest } = useRequest()

      try {
        await doRequest({ client: testClient, timeout: 100 })
      } catch (e) {
        if (!(e instanceof HttpErrorResponse)) {
          throw new Error('Not HttpErrorResponse')
        }
        expect(e.cause).toBe(ERR_TIMEOUT)
      }
    })

    test('should throw error when not found handler', async () => {
      // clone and set handler to undefined
      const client = cloneClient(testClient, { handler: undefined })
      // set global handler to undefined
      // @ts-ignore
      setGlobalHttpHandler(undefined)
      const useRequest = defineRequest('POST', '/')
      const { doRequest } = useRequest()

      try {
        await doRequest({ client, timeout: 100 })
      } catch (e) {
        expect(e).toBe(ERR_NOT_FOUND_HANDLER)
      }
    })

    test('should transform response', async () => {
      const useRequest = defineRequest('GET', '/').withTransformResponse(response => response.body)
      const { doRequest } = useRequest()

      await doRequest({ client: testClient })
    })

    test('should throw error when transform fail', async () => {
      const useRequest = defineRequest('GET', '/').withTransformResponse(() => {
        throw new Error('Transform fail')
      })
      const { doRequest } = useRequest()

      try {
        await doRequest({ client: testClient })
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
      }
    })

    test('should observe is body', async () => {
      const useRequest = defineRequest<{ id: number }>('POST', '/').withField({
        id: field(1).withJson(),
      })
      const { doRequest, getInitValue } = useRequest()
      const resp = await doRequest(getInitValue(), { client: testClient })

      expect(resp).toEqual({ id: 1 })
    })

    test('should observe is response', async () => {
      const useRequest = defineRequest('GET', '/').withObserve('response')
      const { doRequest } = useRequest()
      const resp = await doRequest({ client: testClient })

      expect('headers' in resp).toBeTrue()
      expect('url' in resp).toBeTrue()
      expect('status' in resp).toBeTrue()
      expect('statusText' in resp).toBeTrue()
    })

    test('should throw error when field valid error', async () => {
      const err = new Error('Invalid value')
      const useRequest = defineRequest('POST', '/').withField({
        id: field(0)
          .withJson()
          .withValidators(value => {
            if (value < 10) {
              return err
            }
            return null
          }),
      })
      const { doRequest } = useRequest()
      try {
        await doRequest({ id: 5 }, { client: testClient })
      } catch (e) {
        expect(e).toBe(err)
      }

      await doRequest({ id: 20 }, { client: testClient })
    })

    test('should field value is null', async () => {
      const useRequest = defineRequest('POST', '/').withField({
        id: field<number | null>().withJson(),
      })
      const { doRequest } = useRequest()
      await doRequest({ id: 5 }, { client: testClient })
    })

    describe('with zod.js', () => {
      const schema = z.object({
        id: z.number(),
        name: z.string(),
      })

      test('should be ok with when parse transform response body', async () => {
        const useRequest = defineRequest('POST', '/account')
          .withField({
            id: field(0).withJson(),
            name: field('').withJson(),
          })
          .withTransformResponse(res => schema.parse(res.body))
        const { doRequest, getInitValue } = useRequest()
        const user = { id: 1, name: 'Jack' }
        const data = getInitValue()
        data.id = user.id
        data.name = user.name
        const res = await doRequest(data, { client: testClient })
        expect(res).toEqual(user)
      })

      test('should be throw error when transform response body', async () => {
        const useRequest = defineRequest('POST', '/account').withTransformResponse(res => schema.parse(res.body))
        const { doRequest } = useRequest()
        try {
          await doRequest({ client: testClient })
        } catch (e) {
          expect(e).toBeInstanceOf(Error)
        }
      })
    })

    test('should fillUrl return url', () => {
      const map = new Map<string, string>()
      map.set('id', '1')
      map.set('name', 'John')
      const endpoint = 'https://example.com/:id/:name'
      expect(__fillUrl(endpoint, map)).toEqual('https://example.com/1/John')
    })

    describe('should fillRequestFromField', () => {
      const baseHttpRequest = () =>
        ({
          method: 'POST',
          host: 'https://example.com',
          endpoint: '/v1/:uid/:username',
        }) as HttpRequest

      test('should fill fieldGroup is working', async () => {
        const data = { id: 1, name: 'Jack' }
        const hq = baseHttpRequest()
        const fields = {
          id: field(1).withParam('uid'),
          name: field('John').withParam('username'),
          data: field(data).withUrlForm('form_data'),
        }

        await __fillRequestFromField(hq, fields, {})

        expect(hq.endpoint).toEqual('/v1/1/John')
        expect(__detectContentTypeHeader(hq.body)).toBe('application/x-www-form-urlencoded;charset=UTF-8')

        const body = hq.body as URLSearchParams
        expect(body.toString()).toBe(new URLSearchParams([['form_data', JSON.stringify(data)]]).toString())
      })

      test('should fill fieldGroup is working', async () => {
        const hq = baseHttpRequest()
        const fields = {
          id: field(1).withParam('uid').withJson('uid'),
          name: field('John').withParam('username').withJson(),
          content: field('Hello World!').withJson(),
          status: field<number[]>([]).withQuery('s'),
        }

        await __fillRequestFromField(hq, fields, {
          id: 10,
          name: 'Alice',
          content: 'Hello Alice!',
          status: [1, 2, 3, 4, 5],
        })

        expect(hq.endpoint).toEqual('/v1/10/Alice')
        expect(hq.queryParams?.toString()).toEqual('s=1&s=2&s=3&s=4&s=5')
        expect(hq.body).toEqual({ uid: 10, name: 'Alice', content: 'Hello Alice!' })
      })

      test('should fill field is working', async () => {
        const hq = baseHttpRequest()
        await __fillRequestFromField(hq, field(1).withParam('uid').withBody().withQuery('id'), 10)

        expect(hq.endpoint).toEqual('/v1/10/undefined')
        expect(hq.queryParams?.toString()).toEqual('id=10')
      })
    })
  })
})
