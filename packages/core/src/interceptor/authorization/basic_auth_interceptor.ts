import type { InterceptorFn } from '../interceptor'

export type BasicCredential = {
  username: string
  password: string
}

export type BasicAuthInterceptorOptions = {
  encode?: (credential: BasicCredential) => string
}

export function basicAuthInterceptor(fn: () => BasicCredential, options?: BasicAuthInterceptorOptions): InterceptorFn {
  let encode = options?.encode

  if (!encode) {
    const btoa = (globalThis || window).btoa
    if (typeof btoa !== 'function') {
      throw new Error('BasicAuthInterceptor is not supported in this environment')
    }
    encode = (data: BasicCredential) => btoa(`${data.username}:${data.password}`)
  }

  return (req, next) => {
    const headers = req.headers || new Headers()
    headers.set('Authorization', `Basic ${encode(fn())}`)
    req.headers = headers
    return next(req)
  }
}
