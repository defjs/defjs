const ABORT_BRAND = Symbol.for("defjs.cause.aborted");
const TIMEOUT_BRAND = Symbol.for("defjs.cause.timeout");

function brandSentinel(error: Error, brand: symbol): Error {
  Object.defineProperty(error, brand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return error;
}

function hasCauseBrand(cause: unknown, brand: symbol): boolean {
  return typeof cause === "object" && cause !== null && brand in cause;
}

/**
 * Shared Error sentinel that marks a request as aborted.
 *
 * Its `message` is `Request was aborted`. Shared `cause` and message value for caller cancellation. `createNetworkFault`
 * maps it, and a `DOMException` named `AbortError`, to `NET_ABORTED`. An HTTP
 * interceptor that throws it makes the call resolve with a `NET_ABORTED` fault.
 * SSE and WebSocket interceptors that throw it are reported as
 * `EXT_INTERCEPTOR_FAILED`.
 *
 * The sentinel carries a non-enumerable `Symbol.for('defjs.cause.aborted')`
 * brand. {@link isAbortCause} recognizes this sentinel from any Core copy
 * without comparing object identity. Classification is independent of unrelated
 * earlier executions.
 *
 * @group errors
 */
export const ERR_ABORTED = brandSentinel(
  new Error("Request was aborted"),
  ABORT_BRAND,
);

/**
 * Shared Error sentinel that marks a request as timed out.
 *
 * Its `message` is `Request timed out`. Shared `cause` and message value for timeouts. `createNetworkFault` maps it,
 * and any error named `TimeoutError`, to `NET_TIMEOUT`. An HTTP interceptor
 * that throws it makes the call resolve with a `NET_TIMEOUT` fault. SSE and
 * WebSocket interceptors that throw it are reported as `EXT_INTERCEPTOR_FAILED`.
 *
 * The sentinel carries a non-enumerable `Symbol.for('defjs.cause.timeout')`
 * brand. {@link isTimeoutCause} recognizes this sentinel from any Core copy
 * without comparing object identity. Classification is independent of unrelated
 * earlier executions.
 *
 * @group errors
 */
export const ERR_TIMEOUT = brandSentinel(
  new Error("Request timed out"),
  TIMEOUT_BRAND,
);

/**
 * Whether `cause` is caller cancellation, across Core copies and platform abort errors.
 *
 * Returns `true` for an `Error` carrying the non-enumerable
 * `Symbol.for('defjs.cause.aborted')` brand, including `ERR_ABORTED` from
 * another Core copy, or a `DOMException` named `AbortError`. An ordinary
 * unbranded `Error` with that name does not match. Other values return `false`.
 *
 * Pass the underlying `fault.cause`; this function does not unwrap faults.
 * `createNetworkFault` uses this check to select `NET_ABORTED`. OpenTelemetry
 * uses it to suppress caller-cancellation logs while preserving timeout logs.
 *
 * @group errors
 * @see {@link ERR_ABORTED}
 * @see {@link isTimeoutCause}
 */
export function isAbortCause(cause: unknown): boolean {
  return (
    hasCauseBrand(cause, ABORT_BRAND) ||
    (cause instanceof DOMException && cause.name === "AbortError")
  );
}

/**
 * Whether `cause` is a timeout, across Core copies and platform timeout errors.
 *
 * Returns `true` for an `Error` carrying the non-enumerable
 * `Symbol.for('defjs.cause.timeout')` brand, including `ERR_TIMEOUT` from
 * another Core copy, or a `DOMException` or `Error` named `TimeoutError`.
 * Other values return `false`.
 *
 * Pass the underlying `fault.cause`; this function does not unwrap faults.
 * `createNetworkFault` uses this check to select `NET_TIMEOUT`. OpenTelemetry
 * keeps logging timeouts even when the abort signal is also set.
 *
 * @group errors
 * @see {@link ERR_TIMEOUT}
 * @see {@link isAbortCause}
 */
export function isTimeoutCause(cause: unknown): boolean {
  return (
    hasCauseBrand(cause, TIMEOUT_BRAND) ||
    (cause instanceof DOMException && cause.name === "TimeoutError") ||
    (cause instanceof Error && cause.name === "TimeoutError")
  );
}

/** Message carried by `cause`, or its string form when it is not an error. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
