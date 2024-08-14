import { max, maxLength, min, minLength, pattern, required, requiredTrue } from '@src/validator'
import { describe, expect, test } from 'vitest'

describe('Validator', () => {
  test('should required', () => {
    expect(required('')).toBeInstanceOf(Error)
    expect(required(null)).toBeInstanceOf(Error)
    expect(required(undefined)).toBeInstanceOf(Error)
    expect(required('value')).toBeNull()
  })

  test('should requiredTrue', () => {
    expect(requiredTrue('')).toBeInstanceOf(Error)
    expect(requiredTrue(null)).toBeInstanceOf(Error)
    expect(requiredTrue(undefined)).toBeInstanceOf(Error)
    expect(requiredTrue(true)).toBeNull()
    expect(requiredTrue(false)).toBeInstanceOf(Error)
  })

  test('should minLength', () => {
    const fn = minLength(2)
    expect(fn('')).toBeInstanceOf(Error)
    expect(fn('Hello world!')).toBeNull()
    expect(fn(12)).toBeInstanceOf(Error)
    expect(fn(123)).toBeInstanceOf(Error)
  })

  test('should maxLength', () => {
    const fn = maxLength(2)
    expect(fn('')).toBeNull()
    expect(fn('1')).toBeNull()
    expect(fn(12)).toBeInstanceOf(Error)
    expect(fn('123')).toBeInstanceOf(Error)
  })

  test('should min', () => {
    const fn = min(2)
    expect(fn(1)).toBeInstanceOf(Error)
    expect(fn('Hello world!')).toBeInstanceOf(Error)
    expect(fn(2)).toBeNull()
    expect(fn(3)).toBeNull()
  })

  test('should max', () => {
    const fn = max(2)
    expect(fn(1)).toBeNull()
    expect(fn('Hello world!')).toBeInstanceOf(Error)
    expect(fn(2)).toBeNull()
    expect(fn(3)).toBeInstanceOf(Error)
  })

  test('should pattern', () => {
    const fn = pattern(/^[0-9]+$/)
    expect(fn(1)).toBeInstanceOf(Error)
    expect(fn('')).toBeInstanceOf(Error)
    expect(fn('1')).toBeNull()
    expect(fn('a')).toBeInstanceOf(Error)
  })
})
