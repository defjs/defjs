const NO_ENDPOINT_BRAND = Symbol.for("defjs.cause.no-endpoint");

/**
 * Sentinel for an empty candidate list.
 *
 * Built-in balancers return it as `[ERR_NO_CANDIDATE, undefined]`. The runtime
 * reports that as `REQ_BUILD_FAILED` and keeps this error as `cause`. It is not
 * a `FaultCode`. The non-enumerable `Symbol.for("defjs.cause.no-endpoint")`
 * brand lets {@link isNoCandidateCause} recognize the sentinel from another
 * Core copy.
 *
 * @group client
 * @see {@link isNoCandidateCause}
 */
export const ERR_NO_CANDIDATE: Error = brandSentinel(
  new Error("No endpoint available"),
);

/**
 * Whether `cause` is {@link ERR_NO_CANDIDATE}, including a copy from another Core build.
 *
 * Returns `true` when `cause` carries the non-enumerable
 * `Symbol.for("defjs.cause.no-endpoint")` brand. Other values return `false`.
 * Pass `fault.cause`; this does not unwrap faults.
 *
 * @group client
 * @see {@link ERR_NO_CANDIDATE}
 */
export function isNoCandidateCause(cause: unknown): boolean {
  return (
    typeof cause === "object" && cause !== null && NO_ENDPOINT_BRAND in cause
  );
}

function brandSentinel(error: Error): Error {
  Object.defineProperty(error, NO_ENDPOINT_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return error;
}
