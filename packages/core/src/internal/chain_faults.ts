/**
 * The fault behind every rejection the terminal handler of an interceptor chain hands out.
 *
 * An interceptor is shown the plain cause of a failure, never a library fault, so it and any tracing around it see
 * the error that actually happened. The transport still has to report the fault that cause stands for. It builds
 * the fault where it rejects, and records it under the value it rejects with:
 *
 * - One `Map` per operation call (per attempt for HTTP). Never share one between calls or keep one at module level.
 * - The key is the rejected value itself: an object matches by identity, a primitive by value. An interceptor that
 *   rethrows what `next()` rejected with keeps the fault; one that throws anything else owns the failure.
 * - The same value recorded twice keeps the later fault.
 * - After the chain: `resolveAbortFault(signal) ?? faults.get(error) ?? <the transport's rule for a foreign error>`.
 */

/** A rejected promise that an interceptor may drop without causing an unhandled rejection. */
export function rejected<T>(reason: unknown): Promise<T> {
  const promise = Promise.reject<T>(reason);
  void promise.catch(() => undefined);
  return promise;
}

/** Records `fault` as what `shown` stands for, then rejects with `shown`. */
export function rejectAs<T, F>(
  faults: Map<unknown, F>,
  shown: unknown,
  fault: F,
): Promise<T> {
  faults.set(shown, fault);
  return rejected(shown);
}
