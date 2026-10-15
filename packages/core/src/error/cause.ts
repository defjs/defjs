const ABORT_BRAND = Symbol.for('defjs.cause.aborted')
const TIMEOUT_BRAND = Symbol.for('defjs.cause.timeout')

function brandSentinel(error: Error, brand: symbol): Error {
  Object.defineProperty(error, brand, { configurable: false, enumerable: false, value: true, writable: false })
  return error
}

function hasCauseBrand(cause: unknown, brand: symbol): boolean {
  return typeof cause === 'object' && cause !== null && brand in cause
}

/** Shared cause/message sentinel for aborted requests. */
export const ERR_ABORTED = brandSentinel(new Error('Request was aborted'), ABORT_BRAND)

/** Shared cause/message sentinel for timed-out requests. */
export const ERR_TIMEOUT = brandSentinel(new Error('Request timed out'), TIMEOUT_BRAND)

/**
 * Whether `cause` represents caller cancellation.
 *
 * Recognizes `ERR_ABORTED` from this copy or another (`Symbol.for('defjs.cause.aborted')`)
 * and the platform's `AbortError`.
 */
export function isAbortCause(cause: unknown): boolean {
  return hasCauseBrand(cause, ABORT_BRAND) || (cause instanceof DOMException && cause.name === 'AbortError')
}

/**
 * Whether `cause` represents a timeout.
 *
 * Recognizes `ERR_TIMEOUT` from this copy or another (`Symbol.for('defjs.cause.timeout')`)
 * and any error named `TimeoutError`.
 */
export function isTimeoutCause(cause: unknown): boolean {
  return (
    hasCauseBrand(cause, TIMEOUT_BRAND) ||
    (cause instanceof DOMException && cause.name === 'TimeoutError') ||
    (cause instanceof Error && cause.name === 'TimeoutError')
  )
}

/** Message carried by `cause`, or its string form when it is not an error. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
