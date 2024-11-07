import { ERR_INVALID_HTTP_CONTEXT_TOKEN } from './response'

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

const HTTP_CONTEXT = Symbol('HttpContext')

export type HttpContext = {
  set<T>(token: HttpContextToken<T>, value: T): HttpContext
  get<T>(token: HttpContextToken<T>): T
  del(token: HttpContextToken<unknown>): HttpContext
  has(token: HttpContextToken<unknown>): boolean
  keys(): IterableIterator<HttpContextToken<unknown>>
  get length(): number

  readonly [HTTP_CONTEXT]: Map<HttpContextToken<unknown>, unknown>
}

export function isHttpContext(value: unknown): value is HttpContext {
  return typeof value === 'object' && value !== null && HTTP_CONTEXT in value
}

export function makeHttpContext(): HttpContext
export function makeHttpContext(entries?: readonly (readonly [HttpContextToken<unknown>, unknown])[]): HttpContext
export function makeHttpContext(context?: HttpContext): HttpContext
export function makeHttpContext(entries?: readonly (readonly [HttpContextToken<unknown>, unknown])[] | HttpContext | null): HttpContext {
  const ctx = new Map<HttpContextToken<unknown>, unknown>()

  switch (true) {
    case Array.isArray(entries): {
      for (const [token, value] of entries) {
        if (isHttpContextToken(token)) {
          ctx.set(token, value)
        }
      }
      break
    }
    case isHttpContext(entries): {
      for (const [token, value] of entries[HTTP_CONTEXT]) {
        ctx.set(token, value)
      }
      break
    }
  }

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
    get length(): number {
      return Array.from(ctx.keys()).length
    },

    [HTTP_CONTEXT]: ctx,
  }
}
