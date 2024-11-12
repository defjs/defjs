import { beforeEach, describe, expect, test } from 'vitest'
import {
  type Client,
  type ClientConfig,
  cloneClient,
  createClient,
  createGlobalClient,
  getClientConfig,
  getGlobalClient,
  isClient,
  restGlobalClient,
  setGlobalClient,
} from './client'
import { fetchHandler } from './handler'
import { ERR_NOT_FOUND_GLOBAL_CLIENT } from './response'

describe('Client', () => {
  const clientConfig: ClientConfig = {
    host: 'https://example.com',
    handler: fetchHandler,
    interceptors: [],
  }
  let baseClient: Client

  beforeEach(() => {
    baseClient = createClient(clientConfig)
  })

  test('should isClient return true for client', () => {
    expect(isClient(baseClient)).toBeTruthy()
  })

  test('should isClient return false for non-client', () => {
    expect(isClient({})).toBeFalsy()
  })

  test('should getClientConfig return client config', () => {
    const conf = getClientConfig(baseClient)
    expect(conf).toEqual(clientConfig)
  })

  test('should getClientConfig return null for non-client', () => {
    expect(() => getClientConfig({} as any)).toThrowError()
  })

  test('should createGlobalClient set global client', () => {
    createGlobalClient(clientConfig)
    const client = getGlobalClient()
    expect(isClient(client)).toBeTruthy()
    restGlobalClient()
    expect(() => getGlobalClient()).toThrowError(ERR_NOT_FOUND_GLOBAL_CLIENT)
  })

  test('should setGlobalClient set global client', () => {
    setGlobalClient(baseClient)
    const client = getGlobalClient()
    expect(isClient(client)).toBeTruthy()
    restGlobalClient()
  })

  test('should cloneClient return new client', () => {
    const newConfig: ClientConfig = {
      host: 'https://example.com',
      handler: fetchHandler,
      interceptors: [],
    }
    const newClient = cloneClient(baseClient, newConfig)
    expect(isClient(newClient)).toBeTruthy()
    expect(getClientConfig(newClient)).toEqual(newConfig)
  })
})
