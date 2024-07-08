import type { InterceptorFn } from './interceptor'

/**
 * Noop 拦截器
 */
export const noopInterceptor: InterceptorFn = (req, next) => next(req)
