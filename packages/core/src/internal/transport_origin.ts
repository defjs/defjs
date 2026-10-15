/**
 * Track transport rejections for one execution, without changing the cause seen by interceptors.
 * Primitive causes retain extension attribution. Never share this tracker between executions.
 */
export function createTransportOrigin() {
  const causes = new WeakSet<object>()
  return {
    mark<T>(cause: T): T {
      if (typeof cause === 'object' && cause !== null) {
        causes.add(cause)
      }
      return cause
    },
    has(cause: unknown): boolean {
      return typeof cause === 'object' && cause !== null && causes.has(cause)
    },
  }
}
