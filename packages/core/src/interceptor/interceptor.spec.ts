import { makeFakeHandler } from '@src/handler/test_handler'
import { type InterceptorFn, makeInterceptorChain } from '@src/interceptor/interceptor'
import type { HttpRequest } from '@src/request'
import { describe, expect, it } from 'vitest'

describe('interceptor', () => {
  it('should work', async () => {
    const result: number[] = []
    const fun1: InterceptorFn = (req, next) => {
      result.push(1)
      return next(req).then(r => {
        result.push(1.1)
        return r
      })
    }

    const fun2: InterceptorFn = (req, next) => {
      result.push(2)
      return next(req).then(r => {
        result.push(2.1)
        return r
      })
    }

    const fun3: InterceptorFn = (req, next) => {
      result.push(3)
      return next(req).then(r => {
        result.push(3.1)
        return r
      })
    }

    const handler = makeFakeHandler({
      response: {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: 'Hello World',
      },
    })
    const chain = makeInterceptorChain([fun1, fun2, fun3])
    const req: HttpRequest = {
      method: 'GET',
      host: 'https://api.github.com',
      endpoint: '/user',
    }

    await chain(req, handler)

    expect(result).toEqual([1, 2, 3, 3.1, 2.1, 1.1])
  })
})
