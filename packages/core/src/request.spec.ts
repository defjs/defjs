import { cloneClient, createClient, restGlobalClient, setGlobalClient } from '@src/client'
import { makeHttpContext } from '@src/context'
import { field } from '@src/field'
import { setGlobalHttpHandler } from '@src/handler/handler'
import {
  type HttpRequest,
  __buildFieldDefaultValue,
  __detectContentTypeHeader,
  __fillRequestFromField,
  __fillUrl,
  __serializeBody,
  defineRequest,
} from '@src/request'
import { ERR_ABORTED, ERR_NOT_FOUND_HANDLER, ERR_NOT_SET_ALIAS, ERR_TIMEOUT } from '@src/response'
import { describe, expect, inject, test, vi } from 'vitest'
import { z } from 'zod'

describe('Request', () => {
  const testClient = createClient({ host: inject('testServerHost') })

  test('should build field default value', () => {
    expect(__buildFieldDefaultValue(field(1))).toBe(1)
    expect(__buildFieldDefaultValue(field('Hello World!'))).toBe('Hello World!')
    expect(__buildFieldDefaultValue(field(true))).toBeTruthy()
    expect(__buildFieldDefaultValue(field(false))).toBeFalsy()
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

    test('should set endpoint without method', () => {
      expect(defineRequest('/v1/user')).toBeTypeOf('function')
    })

    test('should throw error when input quantity does not meet the requirements', () => {
      // @ts-ignore
      expect(() => defineRequest('', '', '')).toThrowError()
      // @ts-ignore
      expect(() => defineRequest()).toThrowError()
    })

    test('should be use global client', () => {
      setGlobalClient(testClient)
      const useRequest = defineRequest('POST', '/')
      useRequest()
    })

    test('should set upload progress', () => {
      const useRequest = defineRequest('POST', '/')
      const { setUploadProgress } = useRequest({ client: testClient })
      setUploadProgress(() => void 0)
    })

    test('should set download progress', () => {
      const useRequest = defineRequest('POST', '/')
      const { setDownloadProgress } = useRequest({ client: testClient })
      setDownloadProgress(() => void 0)
    })

    test('should throw error when define input but not use', async () => {
      const useRequest = defineRequest('POST', '/').withField(field<number>())
      const { doRequest } = useRequest({ client: testClient })

      const { error } = await doRequest()
      expect(error).toBeInstanceOf(Error)
    })

    test('should throw error when use abort signal timeout', async () => {
      const signal = AbortSignal.timeout(100)
      const useRequest = defineRequest('GET', '/delay').withField(field<number>().withQuery('ms'))
      const { doRequest } = useRequest({ abort: signal, client: testClient })
      const { error } = await doRequest(500)
      expect(error).toBe(ERR_TIMEOUT)
    })

    test('should throw error when cancel', async () => {
      const useRequest = defineRequest('GET', '/delay').withField(field<number>().withQuery('ms'))
      const { doRequest, cancel } = useRequest({ client: testClient })

      setTimeout(() => {
        cancel()
      }, 500)

      const { error } = await doRequest(10000)
      expect(error).toBe(ERR_ABORTED)
    })

    test('should throw error when set timeout option', async () => {
      const useRequest = defineRequest('GET', '/delay').withField(field<number>().withQuery('ms'))
      const { doRequest } = useRequest({ timeout: 100, client: testClient })
      const { error } = await doRequest(500)
      expect(error).toBe(ERR_TIMEOUT)
    })

    test('should throw error when offline', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Fetch failed'))

      const useRequest = defineRequest('GET', '/')
      const { doRequest } = useRequest({ timeout: 100, client: testClient })
      const { error } = await doRequest()
      expect(error).toBeInstanceOf(Error)

      fetchSpy.mockRestore()
    })

    test('should throw error when not found handler', async () => {
      // clone and set handler to undefined
      const client = cloneClient(testClient, { handler: undefined })
      // set global handler to undefined
      // @ts-ignore
      setGlobalHttpHandler(undefined)
      const useRequest = defineRequest('POST', '/')

      try {
        useRequest({ client, timeout: 100 })
      } catch (e) {
        expect(e).toBe(ERR_NOT_FOUND_HANDLER)
      }
    })

    test('should transform response', async () => {
      const useRequest = defineRequest('GET', '/').withTransformResponse(response => response.body)
      const { doRequest } = useRequest({ client: testClient })

      await doRequest()
    })

    test('should throw error when transform fail', async () => {
      const useRequest = defineRequest('GET', '/').withTransformResponse(() => {
        throw new Error('Transform fail')
      })
      const { doRequest } = useRequest({ client: testClient })

      try {
        await doRequest()
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
      }
    })

    test('should observe is response', async () => {
      const useRequest = defineRequest('GET', '/')
      const { doRequest } = useRequest({ client: testClient })
      const resp = await doRequest()

      expect('headers' in resp).toBeTruthy()
      expect('url' in resp).toBeTruthy()
      expect('status' in resp).toBeTruthy()
      expect('statusText' in resp).toBeTruthy()
    })

    test('should throw error when field valid error', async () => {
      const err = new Error('Invalid value')
      const useRequest = defineRequest('POST', '/').withField({
        id: field(0)
          .withJson()
          .withValidators(value => {
            if (value < 10) {
              throw err
            }
          }),
      })
      const { doRequest } = useRequest({ client: testClient })
      try {
        await doRequest({ id: 5 })
      } catch (e) {
        expect(e).toBe(err)
      }

      await doRequest({ id: 20 })
    })

    test('should field value is null', async () => {
      const useRequest = defineRequest('POST', '/').withField({
        id: field<number | null>().withJson(),
      })
      const { doRequest } = useRequest({ client: testClient })
      await doRequest({ id: 5 })
    })

    test('should valid input value', async () => {
      const err = new Error('Invalid value')
      const useRequest = defineRequest('POST', '/')
        .withField({
          id: field<number>().withJson(),
          name: field<string>().withJson(),
        })
        .withValidators([
          value => {
            if (!value.id || !value.name) {
              throw err
            }
            if (value.id < 10) {
              throw err
            }
            return null
          },
        ])
      const { doRequest } = useRequest({ client: testClient })
      try {
        await doRequest({ id: 5, name: 'Jack' })
      } catch (e) {
        expect(e).toBe(err)
      }
    })

    test('should request with interceptors', async () => {
      let isSet = false
      const useRequest = defineRequest('GET', '/').withInterceptors([
        (req, next) => {
          isSet = true
          return next(req)
        },
      ])
      const { doRequest } = useRequest({ client: testClient })
      expect(isSet).toBeFalsy()
      await doRequest()
      expect(isSet).toBeTruthy()
    })

    test('should request with context', async () => {
      let isSet = false
      const useRequest = defineRequest('GET', '/')
        .withContext(makeHttpContext())
        .withInterceptors([
          (req, next) => {
            isSet = !!req.context
            return next(req)
          },
        ])
      const { doRequest } = useRequest({ client: testClient })
      expect(isSet).toBeFalsy()
      await doRequest()
      expect(isSet).toBeTruthy()
    })

    test('should request with credentials', async () => {
      let isSet = false
      const useRequest = defineRequest('GET', '/')
        .withCredentials(true)
        .withInterceptors([
          (req, next) => {
            isSet = !!req.withCredentials
            return next(req)
          },
        ])
      const { doRequest } = useRequest({ client: testClient })
      expect(isSet).toBeFalsy()
      await doRequest()
      expect(isSet).toBeTruthy()
    })

    test('should request with response type', async () => {
      let isSet = false
      const useRequest = defineRequest('GET', '/')
        .withResponseType('text')
        .withInterceptors([
          (req, next) => {
            isSet = req.responseType === 'text'
            return next(req)
          },
        ])
      const { doRequest } = useRequest({ client: testClient })
      expect(isSet).toBeFalsy()
      await doRequest()
      expect(isSet).toBeTruthy()
    })

    test('should use global client', async () => {
      setGlobalClient(testClient)
      const useRequest = defineRequest('GET', '/')

      const { doRequest } = useRequest({ client: testClient })
      await expect(doRequest()).resolves.not.toThrow()
      restGlobalClient()
    })

    test('should fillUrl return url', () => {
      const map = new Map<string, string>()
      map.set('id', '1')
      map.set('name', 'John')
      const endpoint = 'https://example.com/:id/:name'
      expect(__fillUrl(endpoint, map)).toEqual('https://example.com/1/John')
    })

    test('should use doRequest when input one param', async () => {
      setGlobalClient(testClient)
      const useRequest = defineRequest('POST', '/').withField(field<number>().withJson())
      const { doRequest, getInitValue } = useRequest({ client: testClient })
      let input = getInitValue()
      input = 10
      {
        const { body } = await doRequest(input)
        expect(body).toBe(10)
      }
      {
        const { error } = await doRequest()
        expect(error).toBeInstanceOf(Error)
      }
      restGlobalClient()
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
        const { doRequest, getInitValue } = useRequest({ client: testClient })
        const user = { id: 1, name: 'Jack' }
        const data = getInitValue()
        data.id = user.id
        data.name = user.name
        const res = await doRequest(data)
        expect(res.body).toEqual(user)
      })

      test('should be throw error when transform response body', async () => {
        const useRequest = defineRequest('POST', '/account').withTransformResponse(res => schema.parse(res.body))
        const { doRequest } = useRequest({ client: testClient })
        try {
          await doRequest()
        } catch (e) {
          expect(e).toBeInstanceOf(Error)
        }
      })
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
        await __fillRequestFromField(hq, field(1).withParam('uid').withBody().withQuery('id').withHeader('id'), 10)

        expect(hq.endpoint).toEqual('/v1/10/undefined')
        expect(hq.queryParams?.toString()).toEqual('id=10')
        expect(hq.headers?.get('id')).toEqual('10')
      })

      test('should fill single field to body with form', async () => {
        const hq = baseHttpRequest()
        await __fillRequestFromField(hq, field(1).withForm('id'), 10)

        expect(hq.body).toBeInstanceOf(FormData)
        expect((hq.body as FormData).get('id')).toEqual('10')
      })

      test('should fill single field to body with url form', async () => {
        const hq = baseHttpRequest()
        await __fillRequestFromField(hq, field(1).withUrlForm('id'), 10)

        expect(hq.body).toBeInstanceOf(URLSearchParams)
        expect((hq.body as URLSearchParams).get('id')).toEqual('10')
      })

      test('should fill single field to body with json', async () => {
        const hq = baseHttpRequest()
        await __fillRequestFromField(hq, field<{ id: number }>().withJson(), { id: 1 })

        expect(hq.body).toBeInstanceOf(Object)
        expect((hq.body as { id: number }).id).toEqual(1)
      })

      test('should fill field group to body with body', async () => {
        const hq = baseHttpRequest()
        await __fillRequestFromField(hq, { id: field<number>().withBody() }, { id: 1 })

        expect(hq.body).toEqual(1)
      })

      test('should fill field group to body with form', async () => {
        const hq = baseHttpRequest()
        await __fillRequestFromField(hq, { id: field<number>().withForm() }, { id: 1 })

        expect(hq.body).toBeInstanceOf(FormData)
        expect((hq.body as FormData).get('id')).toEqual('1')
      })

      test('should field value is null', async () => {
        const hq = baseHttpRequest()
        const fieldGroup = {
          uid: field<{ id: number }>().withQuery().withParam().withForm().withUrlForm().withHeader(),
          username: field<{ id: number }[]>().withQuery().withParam().withForm().withUrlForm().withHeader(),
        }

        await __fillRequestFromField(hq, fieldGroup, { uid: null, username: [{ id: 1 }, { id: 2 }] })
      })

      test('should field value is null', async () => {
        const hq = baseHttpRequest()
        const err = new Error('Invalid value')
        const fieldGroup = field<{ id: number }>()
          .withQuery()
          .withValidators(value => {
            if (value && value?.id < 10) {
              throw err
            }
          })

        try {
          await __fillRequestFromField(hq, fieldGroup, { id: null })
        } catch (e) {
          expect(e).toBe(err)
        }
      })

      test('should throw error when field not set alias', async () => {
        const hq = baseHttpRequest()

        try {
          await __fillRequestFromField(hq, field<{ id: number }>({ id: 1 }).withQuery(), undefined)
        } catch (e) {
          expect(e).toBe(ERR_NOT_SET_ALIAS)
        }

        try {
          await __fillRequestFromField(hq, field<{ id: number }>({ id: 1 }).withParam(), undefined)
        } catch (e) {
          expect(e).toBe(ERR_NOT_SET_ALIAS)
        }

        try {
          await __fillRequestFromField(hq, field<{ id: number }>({ id: 1 }).withHeader(), undefined)
        } catch (e) {
          expect(e).toBe(ERR_NOT_SET_ALIAS)
        }

        try {
          await __fillRequestFromField(hq, field<{ id: number }>({ id: 1 }).withForm(), undefined)
        } catch (e) {
          expect(e).toBe(ERR_NOT_SET_ALIAS)
        }

        try {
          await __fillRequestFromField(hq, field<{ id: number }>({ id: 1 }).withUrlForm(), undefined)
        } catch (e) {
          expect(e).toBe(ERR_NOT_SET_ALIAS)
        }
      })

      test('should throw error when field not Field', async () => {
        const hq = baseHttpRequest()
        await expect(__fillRequestFromField(hq, {}, undefined)).rejects.toThrowError()
      })

      test('should throw error when field value not supported', async () => {
        const hq = baseHttpRequest()
        await expect(__fillRequestFromField(hq, field({ id: Symbol('') }).withHeader(), { id: Symbol('') })).rejects.toThrowError()
        await expect(__fillRequestFromField(hq, { id: field(Symbol('')).withHeader() }, { id: Symbol('') })).rejects.toThrowError()
      })
    })
  })
})
