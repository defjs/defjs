import { describe, expect, test } from 'vitest'
import { resolveHttpUrl, resolveUrl } from './url'

describe('resolveUrl', () => {
  test('returns endpoint when no baseEndpoint', () => {
    expect(resolveUrl('/test')).toBe('/test')
  })

  test('resolves relative endpoint with baseEndpoint', () => {
    expect(resolveUrl('/test', 'https://api.example.com')).toBe('https://api.example.com/test')
  })

  test('keeps base pathname when joining a rooted path', () => {
    expect(resolveUrl('/users', 'https://api.example.com/staging')).toBe('https://api.example.com/staging/users')
  })

  test('returns endpoint on invalid baseEndpoint', () => {
    expect(resolveUrl('/test', 'not-a-url')).toBe('/test')
  })
})

describe('resolveHttpUrl', () => {
  test('returns endpoint when no baseEndpoint', () => {
    const result = resolveHttpUrl('/test')
    expect(result.url).toBe('/test')
    expect(result.serverAddress).toBeUndefined()
    expect(result.serverPort).toBeUndefined()
  })

  test('resolves with hostname and no explicit port', () => {
    const result = resolveHttpUrl('/test', 'https://api.example.com')
    expect(result.url).toBe('https://api.example.com/test')
    expect(result.serverAddress).toBe('api.example.com')
    expect(result.serverPort).toBeUndefined()
  })

  test('keeps base pathname when joining a rooted path', () => {
    const result = resolveHttpUrl('/users', 'https://api.example.com/staging')
    expect(result.url).toBe('https://api.example.com/staging/users')
    expect(result.serverAddress).toBe('api.example.com')
  })

  test('resolves with explicit port', () => {
    const result = resolveHttpUrl('/test', 'https://api.example.com:8080')
    expect(result.url).toBe('https://api.example.com:8080/test')
    expect(result.serverAddress).toBe('api.example.com')
    expect(result.serverPort).toBe(8080)
  })

  test('returns endpoint on invalid baseEndpoint', () => {
    const result = resolveHttpUrl('/test', 'not-a-url')
    expect(result.url).toBe('/test')
    expect(result.serverAddress).toBeUndefined()
    expect(result.serverPort).toBeUndefined()
  })
})
