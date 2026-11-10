/**
 * Track transport rejections for one execution, without changing the cause seen by interceptors.
 * A cause a WeakSet cannot hold is recorded by value, so a rejected primitive keeps transport
 * attribution; an interceptor that throws an equal primitive after the transport rejected it is
 * attributed to the transport. Never share this tracker between executions.
 */
export function createTransportOrigin() {
  const causes = new WeakSet<object>();
  const values = new Set<unknown>();

  function holdsWeakly(cause: unknown): cause is object {
    return (
      (typeof cause === "object" && cause !== null) ||
      typeof cause === "function"
    );
  }

  return {
    mark<T>(cause: T): T {
      if (holdsWeakly(cause)) {
        causes.add(cause);
      } else {
        values.add(cause);
      }
      return cause;
    },
    has(cause: unknown): boolean {
      return holdsWeakly(cause) ? causes.has(cause) : values.has(cause);
    },
  };
}
