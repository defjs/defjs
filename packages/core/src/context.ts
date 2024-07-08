import { ERR_INVALID_HTTP_CONTEXT_TOKEN } from 'src/error'

export const HTTP_CONTEXT_TOKEN = Symbol('HttpContextToken')

export type HttpContextToken<T> = (() => T) & {
  readonly [HTTP_CONTEXT_TOKEN]: () => T
}

export function makeHttpContextToken<T>(defaultValue: () => T): HttpContextToken<T> {
  Object.defineProperty(defaultValue, HTTP_CONTEXT_TOKEN, { value: defaultValue })
  return defaultValue as HttpContextToken<T>
}

export function isHttpContextToken(value: unknown): value is HttpContextToken<unknown> {
  return typeof value === 'function' && HTTP_CONTEXT_TOKEN in value
}

export type HttpContext = {
  set<T>(token: HttpContextToken<T>, value: T): HttpContext
  get<T>(token: HttpContextToken<T>): T
  del(token: HttpContextToken<unknown>): HttpContext
  has(token: HttpContextToken<unknown>): boolean
  keys(): IterableIterator<HttpContextToken<unknown>>
}

export function makeHttpContext(): HttpContext {
  const ctx = new Map<HttpContextToken<unknown>, unknown>()

  return {
    set<T>(token: HttpContextToken<T>, value: T) {
      if (!isHttpContextToken(token)) {
        throw ERR_INVALID_HTTP_CONTEXT_TOKEN
      }
      ctx.set(token, value)
      return this
    },
    get<T>(token: HttpContextToken<T>) {
      if (!isHttpContextToken(token)) {
        throw ERR_INVALID_HTTP_CONTEXT_TOKEN
      }
      if (!ctx.has(token)) {
        ctx.set(token, token())
      }
      return ctx.get(token) as T
    },
    del<T>(token: HttpContextToken<T>) {
      ctx.delete(token)
      return this
    },
    has<T>(token: HttpContextToken<T>) {
      return ctx.has(token)
    },
    keys() {
      return ctx.keys()
    },
  }
}
