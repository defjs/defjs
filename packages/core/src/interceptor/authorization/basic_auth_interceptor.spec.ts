import { describe, expect, test } from 'bun:test'
import { makeFakeHandler } from '../../handler/test_handler'
import type { HttpRequest } from '../../request'
import { makeInterceptorChain } from '../interceptor'
import { type BasicCredential, basicAuthInterceptor } from './basic_auth_interceptor'

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
})
