import { describe, expect, test } from 'vitest'
import { getGlobalHttpHandler, setGlobalHttpHandler } from '../handler/handler'
import { makeFakeHandler } from '../handler/test_handler'

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
