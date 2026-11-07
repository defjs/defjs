import type { PreflightFault } from "../error/types";
import { createPreflightFault } from "../error/factory";
import {
  type Balancer,
  type DoneInfo,
  type PickInfo,
  type PickResult,
  isBalancerOptionError,
} from "./balancer";

/**
 * Endpoint selected for the transport, plus one-shot `start` and `done` wrappers.
 *
 * Transports call `done` on every exit after a successful pick, including
 * build failures (`{ attempted: false }`). The wrapper, not the balancer, owns
 * the once-only rule.
 */
export interface ResolvedEndpoint {
  /** Endpoint string returned by `pick`. Not checked as a URL. */
  readonly endpoint: string;
  /** Starts the selected transport at most once; ignored after completion. Callback failures are contained. */
  start: () => void;
  /** Reports the transport response once, only after start and before done. */
  end: (info: DoneInfo) => void;
  /**
   * Reports the attempt outcome. The first call invokes the balancer's `done`
   * synchronously and swallows a throw. `done` must be synchronous; a returned
   * promise is not awaited and its rejection is ignored. Later calls do nothing.
   * When `pick` omitted `done`, the first call only marks this attempt finished.
   */
  done: (info: DoneInfo) => void;
  /** Whether `done` has already been entered. */
  finished: () => boolean;
}

/**
 * Calls `balancer.pick` and normalizes the result. Never throws.
 *
 * - `[Error, undefined]` with the internal option-error brand becomes
 *   `REQ_OPTIONS_INVALID`. Any other error, including `ERR_NO_CANDIDATE`,
 *   becomes `REQ_BUILD_FAILED`. The original error is `cause`.
 * - A throw from `pick` or outcome normalization becomes
 *   `createPreflightFault("REQ_BUILD_FAILED", thrown)`. Result fields are read once.
 * - Any other shape becomes `REQ_BUILD_FAILED` whose `cause` is the returned
 *   value itself.
 * - `pick`, `start`, and `done` must be synchronous. A returned promise is not awaited
 *   and its rejection is ignored. A promise returned by `pick` is an invalid shape.
 * - A selection outside `endpoints` or with an invalid callback calls the
 *   result's `done` with `{ attempted: false }` when `done` is a function, so
 *   state reserved by that pick is released.
 * - Success returns the selected endpoint and a `done` wrapper. Call that
 *   wrapper, not the function on the raw pick result.
 *
 * @param balancer - Client balancer, built-in or custom.
 * @param info - Candidates and the definition's `operation`.
 * @returns An error-first tuple. The fault is a `PreflightFault`.
 */
export function pickEndpoint(
  balancer: Balancer,
  info: PickInfo,
): readonly [PreflightFault, undefined] | readonly [null, ResolvedEndpoint] {
  try {
    const outcome: unknown = balancer.pick(info);
    if (Array.isArray(outcome) && outcome.length === 2) {
      const error: unknown = outcome[0];
      const result: unknown = outcome[1];
      if (isCrossRealmError(error) && result === undefined) {
        // The tag check also accepts errors from another realm.
        const code = isBalancerOptionError(error)
          ? "REQ_OPTIONS_INVALID"
          : "REQ_BUILD_FAILED";
        return [createPreflightFault(code, error), undefined];
      }
      if (error === null && result !== null && typeof result === "object") {
        const endpoint = "endpoint" in result ? result.endpoint : undefined;
        const done = "done" in result ? result.done : undefined;
        const start = "start" in result ? result.start : undefined;
        const end = "end" in result ? result.end : undefined;
        if (
          typeof endpoint === "string" &&
          isOptionalCallback<(info: DoneInfo) => void>(done) &&
          isOptionalCallback<() => void>(start) &&
          isOptionalCallback<(info: DoneInfo) => void>(end)
        ) {
          if (!info.endpoints.includes(endpoint)) {
            releasePick(done);
            return [
              createPreflightFault(
                "REQ_BUILD_FAILED",
                new Error(
                  "Balancer selected an endpoint outside the candidate set",
                ),
              ),
              undefined,
            ];
          }
          // The callable check is the runtime boundary for custom balancers.
          return [null, resolve({ endpoint, done, start, end })];
        }
        // A rejected shape still owns whatever its pick reserved, such as a probe slot.
        if (isOptionalCallback<(info: DoneInfo) => void>(done))
          releasePick(done);
      }
    }
    ignoreRejection(outcome);
    return [createPreflightFault("REQ_BUILD_FAILED", outcome), undefined];
  } catch (cause) {
    return [createPreflightFault("REQ_BUILD_FAILED", cause), undefined];
  }
}

function resolve(result: PickResult): ResolvedEndpoint {
  let settled = false;
  let started = false;
  let ended = false;
  const start = result.start;
  const done = result.done;
  const end = result.end;
  return {
    endpoint: result.endpoint,
    finished: () => settled,
    start() {
      if (settled || started) return;
      started = true;
      try {
        ignoreRejection(start?.());
      } catch {
        // Callback failures must not change the transport attempt.
      }
    },
    end(info) {
      if (!started || ended || settled) return;
      ended = true;
      try {
        ignoreRejection(end?.(attributed(info)));
      } catch {
        // Callback failures must not change the transport attempt.
      }
    },
    done(info) {
      if (settled) {
        return;
      }
      settled = true;
      if (done === undefined) {
        return;
      }
      try {
        ignoreRejection(done(attributed(info)));
      } catch {
        // A throwing done must not replace the operation tuple.
      }
    },
  };
}

/** Ends a pick the runtime rejected, so state reserved by `pick` is released. */
function releasePick(done: ((info: DoneInfo) => unknown) | undefined): void {
  if (done === undefined) return;
  try {
    ignoreRejection(done({ attempted: false }));
  } catch {
    // A throwing done must not replace the operation tuple.
  }
}

/** `[object Error]` also matches errors constructed in another realm. */
function isCrossRealmError(value: unknown): value is Error {
  return Object.prototype.toString.call(value) === "[object Error]";
}

function isOptionalCallback<T extends (...args: never[]) => void>(
  value: unknown,
): value is T | undefined {
  return value === undefined || typeof value === "function";
}

export function ignoreRejection(value: unknown): void {
  try {
    if (
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    ) {
      const then = "then" in value ? value.then : undefined;
      if (typeof then === "function") {
        then.call(value, undefined, () => undefined);
      }
    }
  } catch {
    // Observing a non-conforming thenable must not replace the operation tuple.
  }
}

/** Only an explicit browser offline signal suppresses endpoint attribution. */
export function isOffline(): boolean {
  try {
    return globalThis.navigator?.onLine === false;
  } catch {
    return false;
  }
}

function attributed(info: DoneInfo): DoneInfo {
  return info.attempted && info.code === "NET_UNREACHABLE" && isOffline()
    ? { attempted: false }
    : info;
}
