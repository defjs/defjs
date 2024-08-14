import { makeFakeHandler } from '@src/handler/test_handler'
import { type BasicCredential, basicAuthInterceptor } from '@src/interceptor/authorization/basic_auth_interceptor'
import { makeInterceptorChain } from '@src/interceptor/interceptor'
import type { HttpRequest } from '@src/request'
import { describe, expect, test } from 'vitest'

describe('Basic Auth Interceptor', () => {
  test('should use basic auth', async () => {
    const hq: HttpRequest = {
      host: 'https://example.com',
      endpoint: '/v1/user',
      method: 'GET',
    }
    const credential: BasicCredential = {
      username: 'user',
      password: '123',
    }
    const chain = makeInterceptorChain([
      basicAuthInterceptor(() => credential),
      basicAuthInterceptor(() => credential, {
        encode: data => btoa(`${data.username}:${data.password}`),
      }),
    ])
    const handler = makeFakeHandler({
      response: {
        status: 200,
        statusText: 'OK',
      },
      onRequestBefore: req => {
        const authorization = req.headers?.get('Authorization')
        expect(req.headers).toBeInstanceOf(Headers)
        expect(authorization).toEqual(`Basic ${btoa(`${credential.username}:${credential.password}`)}`)
      },
    })

    await chain(hq, handler)
  })

  test('should throw error if btoa is not supported', () => {
    const _btoa = globalThis.btoa
    // @ts-ignore
    globalThis.btoa = undefined

    const credential: BasicCredential = {
      username: 'user',
      password: '123',
    }

    expect(() => basicAuthInterceptor(() => credential)).toThrowError()

    globalThis.btoa = _btoa
  })
})
