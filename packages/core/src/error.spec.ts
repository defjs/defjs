import { describe, expect, test } from 'bun:test'
import { __withErrorCause } from './error'

describe('Error', () => {
  test('should withErrorCause return error with cause', () => {
    const error = new Error('test')
    const cause = new Error('cause')
    const result = __withErrorCause(error, cause)
    expect(result).toBe(error)
    expect(result.cause).toBe(cause)
  })
})
