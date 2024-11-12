import { describe, expect, test } from 'vitest'
import { isHttpContext, isHttpContextToken, makeHttpContext, makeHttpContextToken } from './context'

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
    expect(context.has(token)).toBeFalsy()
  })

  test('should check if value exists', () => {
    const context = makeHttpContext()
    const token = makeHttpContextToken(() => 'default')
    context.set(token, 'value')
    expect(context.has(token)).toBeTruthy()
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
    expect(isHttpContextToken(token)).toBeTruthy()
    expect(isHttpContextToken({})).toBeFalsy()
  })

  test('should check if value is HttpContext', () => {
    const context = makeHttpContext()
    expect(isHttpContext(context)).toBeTruthy()
    expect(isHttpContext({})).toBeFalsy()
  })

  test('should make context with HttpContext', () => {
    const token = makeHttpContextToken(() => 1)

    const oldContext = makeHttpContext()
    oldContext.set(token, 1)

    const newContext = makeHttpContext(oldContext)

    expect(newContext.get(token)).toBe(1)
  })

  test('should make context with entries', () => {
    const token = makeHttpContextToken(() => 1)
    const context = makeHttpContext([[token, 1]])
    expect(context.get(token)).toBe(1)
  })

  test('should unset un token key', () => {
    const context = makeHttpContext([[{} as any, 1]])
    expect(context.length).toBe(0)
  })
})
