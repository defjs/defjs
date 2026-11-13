import type { PreflightFault } from "../error";
import { createPreflightFault } from "../error";
import type { AnyStruct } from "../struct";
import type { Guide } from "../struct/guide";
import { followAbort, resolveAbortedFault, resolveAbortFault } from "./abort";
import { parseEndpointInput } from "./endpoint_input";

/** What one operation call owns once its input has passed: its own abort controller and the parsed input. */
export interface CallScope {
  /** Aborts the call. The transport aborts it for its own stops: an attempt timeout, a close. */
  readonly controller: AbortController;
  /** `controller.signal`. It follows the caller's signal until `release` is called. */
  readonly signal: AbortSignal;
  /** Stops following the caller's signal. The caller of `preflight` calls it once, on every exit. */
  readonly release: () => void;
  /** The input after the input struct parsed it, or the input as given when no struct is declared. */
  readonly input: unknown;
  /** Guides the input struct recorded for the builder. */
  readonly guides: WeakMap<object, Guide>;
}

/**
 * The first steps of every operation call, shared by HTTP, SSE and WebSocket.
 *
 * 1. A caller signal that is already aborted ends the call before anything is allocated or parsed.
 * 2. The call gets its own controller, which follows the caller's signal.
 * 3. The input is parsed by `inputStruct`. A failure is `REQ_INPUT_INVALID`, unless the signal aborted meanwhile.
 * 4. A signal that aborted during parsing ends the call.
 *
 * Returns the fault that ended the call, or the scope of a call that goes on. A fault is an `Error` and a scope is
 * not, so the caller tells them apart with `instanceof Error`.
 * PERF: no error-first tuple here. Allocating one and reading it back made the already-aborted fast path 3% to 5%
 * slower (2.23M to 2.12M ops/s on Bun 1.4.4); the plain union measures level with an inline check.
 *
 * On a fault nothing is left attached to the caller's signal. On success the scope's `release` belongs to the
 * caller: call it on every exit, and for a long-lived session when the session ends. It does not pick an endpoint,
 * read a retry policy or touch the balancer, and it does not throw for input the types allow.
 */
export function preflight(
  inputStruct: AnyStruct | undefined,
  input: unknown,
  callerSignal: AbortSignal | undefined,
): PreflightFault | CallScope {
  if (callerSignal?.aborted) {
    return resolveAbortedFault(callerSignal);
  }

  const controller = new AbortController();
  const signal = controller.signal;
  const release = followAbort(controller, callerSignal);
  const guides = new WeakMap<object, Guide>();

  let parsed: unknown;
  try {
    parsed = inputStruct
      ? parseEndpointInput(inputStruct, input, guides)
      : input;
  } catch (error) {
    release();
    return (
      resolveAbortFault(signal) ??
      createPreflightFault("REQ_INPUT_INVALID", error)
    );
  }

  const cancelled = resolveAbortFault(signal);
  if (cancelled) {
    release();
    return cancelled;
  }
  return { controller, signal, release, input: parsed, guides };
}
