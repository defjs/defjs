import { getGlobalHttpHandler, setGlobalHttpHandler } from '@src/handler/handler'
import { makeFakeHandler } from '@src/handler/test_handler'
import { describe, expect, test } from 'vitest'

describe('Handler', () => {
  test('should set and get global http handler', () => {
    const handler = makeFakeHandler({
      response: {
        status: 200,
        body: 'Hello, world!',
      },
    })
    setGlobalHttpHandler(handler)
    expect(getGlobalHttpHandler()).toBe(handler)
  })
})
