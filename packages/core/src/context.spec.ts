import { describe, expect, test } from 'bun:test'
import { isHttpContextToken, makeHttpContext, makeHttpContextToken } from './context'

describe('Context', () => {
  test('should throw error when set other token', () => {
    const context = makeHttpContext()
    const token = {} as any
    expect(() => context.set(token, 'value')).toThrowError()
  })

  test('should throw error when get other token', () => {
    const context = makeHttpContext()
    const token = {} as any
    expect(() => context.get(token)).toThrowError()
  })

  test('should set and get value', () => {
    const context = makeHttpContext()
    const token = makeHttpContextToken(() => 'default')
    context.set(token, 'value')
    expect(context.get(token)).toBe('value')
  })

  test('should get default value', () => {
    const context = makeHttpContext()
    const token = makeHttpContextToken(() => 'default')
    expect(context.get(token)).toBe('default')
  })

  test('should delete value', () => {
    const context = makeHttpContext()
    const token = makeHttpContextToken(() => 'default')
    context.set(token, 'value')
    context.del(token)
    expect(context.has(token)).toBeFalse()
  })

  test('should check if value exists', () => {
    const context = makeHttpContext()
    const token = makeHttpContextToken(() => 'default')
    context.set(token, 'value')
    expect(context.has(token)).toBeTrue()
  })

  test('should return keys', () => {
    const context = makeHttpContext()
    const token1 = makeHttpContextToken(() => 'default')
    const token2 = makeHttpContextToken(() => 'default')
    context.set(token1, 'value')
    context.set(token2, 'value')
    const keys = Array.from(context.keys())
    expect(keys).toEqual([token1, token2])
  })

  test('should check if value is HttpContextToken', () => {
    const token = makeHttpContextToken(() => 'default')
    expect(isHttpContextToken(token)).toBeTrue()
    expect(isHttpContextToken({})).toBeFalse()
  })
})
