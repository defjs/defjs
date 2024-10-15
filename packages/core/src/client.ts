import { ERR_INVALID_CLIENT, ERR_NOT_FOUND_GLOBAL_CLIENT } from './error'
import { type HttpHandler, fetchHandler } from './handler'
import type { InterceptorFn } from './interceptor'

export interface ClientOptions {
  host: string
  interceptors?: InterceptorFn[]
  handler?: HttpHandler
  /** @todo: Add support for query params serializer */
  // queryParamsSerializer?: (req) => string
}

export type ClientConfig = {
  host: string
  handler: HttpHandler
  interceptors: InterceptorFn[]
}

const CLIENT = Symbol('Client')

export type Client = {
  readonly [CLIENT]: ClientConfig
}

let globalClient: Client | undefined

export function isClient(value: unknown): value is Client {
  return typeof value === 'object' && value !== null && CLIENT in value
}

export function getClientConfig(client: Client): ClientConfig {
  if (!isClient(client)) {
    throw ERR_INVALID_CLIENT
  }
  return client[CLIENT]
}

export function createClient(options: ClientOptions): Client {
  const conf: ClientConfig = {
    host: options.host,
    interceptors: options.interceptors ?? [],
    handler: options.handler || fetchHandler,
  }

  return {
    [CLIENT]: conf,
  }
}

export function cloneClient(client: Client, options: Partial<ClientOptions>): Client {
  const preConf = getClientConfig(client)
  const conf: ClientConfig = {
    ...preConf,
    ...options,
  }

  return {
    [CLIENT]: conf,
  }
}

export function getGlobalClient(): Client {
  if (!globalClient) {
    throw ERR_NOT_FOUND_GLOBAL_CLIENT
  }
  return globalClient
}

export function setGlobalClient(client: Client): void {
  globalClient = client
}

export function restGlobalClient(): void {
  globalClient = undefined
}

export function createGlobalClient(options: ClientOptions): void {
  globalClient = createClient(options)
}
