import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as Bun from 'bun'
import { z } from 'zod'
import { type Client, createClient } from './client'
import { field } from './field'
import { type HttpRequest, __detectContentTypeHeader, __fillRequestFromField, __fillUrl, __serializeBody, defineRequest } from './request'

describe('detect Content-Type', () => {
  test('should FormData is multipart/form-data', () => {
    expect(__detectContentTypeHeader(new FormData())).toBe('multipart/form-data')
  })

  test('should ArrayBuffer is application/octet-stream', () => {
    expect(__detectContentTypeHeader(new ArrayBuffer(0))).toBe('application/octet-stream')
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
  let svr: Bun.Server
  let client: Client

  beforeEach(() => {
    svr = Bun.serve({
      port: 0,
      fetch: async request => {
        const url = new URL(request.url)

        switch (url.pathname) {
          case '/account': {
            return Response.json({ accountId: 1, accountName: 'Jack' })
          }
        }

        return new Response(request.body)
      },
    })
    client = createClient({
      host: svr.url.origin,
    })
  })

  afterEach(() => {
    svr.stop()
  })

  test('should return a function', () => {
    expect(defineRequest({ method: '', endpoint: '' })).toBeTypeOf('function')
  })

  describe('with zod.js', () => {
    const schema = z.object({
      id: z.number(),
      name: z.string(),
    })

    test('should be ok with when parse transform response body', async () => {
      const useRequest = defineRequest({
        method: 'POST',
        endpoint: '/',
        input: {
          id: field(0).withJson(),
          name: field('').withJson(),
        },
        transformResponse: res => schema.parse(res.body),
      })
      const { doRequest, getInitValue } = useRequest()
      const user = { id: 1, name: 'Jack' }
      const data = getInitValue()
      data.id = user.id
      data.name = user.name
      const res = await doRequest(data, { client })
      expect(res).toEqual(user)
    })

    test('should be throw error when transform response body', async () => {
      const useRequest = defineRequest({
        method: 'POST',
        endpoint: '/account',
        transformResponse: res => schema.parse(res.body),
      })
      const { doRequest } = useRequest()
      try {
        await doRequest({ client })
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
      console.log(body.toString())
      console.log(new URLSearchParams([['form_data', JSON.stringify(data)]]).toString())
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
