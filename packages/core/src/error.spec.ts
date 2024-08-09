import { describe, expect, test } from 'bun:test'
import { HttpError, __withErrorCause } from './error'

describe('Error', () => {
  test('should withErrorCause return error with cause', () => {
    const error = new Error('test')
    const cause = new Error('cause')
    const result = __withErrorCause(error, cause)
    expect(result).toBe(error)
    expect(result.cause).toBe(cause)
  })

  test('should HttpError be instance of Error', () => {
    const error = new HttpError({ status: 404 })
    expect(error).toBeInstanceOf(Error)
  })
})
