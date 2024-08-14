import { HttpErrorResponse, __withErrorCause } from '@src/error'
import { describe, expect, test } from 'vitest'

describe('Error', () => {
  test('should withErrorCause return error with cause', () => {
    const error = new Error('test')
    const cause = new Error('cause')
    const result = __withErrorCause(error, cause)
    expect(result).toBe(error)
    expect(result.cause).toBe(cause)
  })

  test('should HttpErrorResponse be instance of Error', () => {
    const error = new HttpErrorResponse({ status: 404 })
    expect(error).toBeInstanceOf(Error)
  })

  test('should make error response when status 500', () => {
    const error = new HttpErrorResponse({ status: 500 })
    expect(error.message).toBe(`Http failure response for (unknown url): 500`)
  })

  test('should make error response when network error', () => {
    const error = new HttpErrorResponse()
    expect(error.message).toBe(`Http failure response for (unknown url): 0`)
    expect(error.url).toBe('')
    expect(error.status).toBe(0)
  })

  test('should make error response when network error', () => {
    const error = new HttpErrorResponse()
    expect(error.message).toBe(`Http failure response for (unknown url): 0`)
    expect(error.url).toBe('')
    expect(error.status).toBe(0)
  })
})
