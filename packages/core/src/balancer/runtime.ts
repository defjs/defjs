import type { PreflightFault } from "../error/types";
import { createPreflightFault } from "../error/factory";
import { reportContainedError } from "./report_error";
import type { Balancer, DoneInfo, PickInfo, PickResult } from "./balancer";

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
  /**
   * Starts the selected transport at most once; ignored after completion.
   * A throw from the balancer's `start` is contained and reported with
   * `reportError` where the runtime defines it.
   */
  start: () => void;
  /** Reports the transport response once, only after start and before done. */
  end: (info: DoneInfo) => void;
  /**
   * Reports the attempt outcome. The first call invokes the balancer's `done`
   * synchronously. A throw is contained and reported with `reportError` where
   * the runtime defines it. `done` must be synchronous; a returned promise is
   * not awaited. Later calls do nothing.
   * When `pick` omitted `done`, the first call only marks this attempt finished.
   */
  done: (info: DoneInfo) => void;
}

/**
 * Calls `balancer.pick` and normalizes the result. Never throws.
 *
 * - `[Error, undefined]`, including `ERR_NO_CANDIDATE`, becomes
 *   `REQ_BUILD_FAILED`. The original error is `cause`.
 * - A throw from `pick` or from reading the result becomes
 *   `createPreflightFault("REQ_BUILD_FAILED", thrown)`. Result fields are read once.
 * - `start`, `end`, and `done` are called without a receiver, so `this` is
 *   `undefined`. A throw is contained and reported with `reportError` where the
 *   runtime defines it.
 * - `start`, `end`, and `done` must be synchronous. A returned promise is not
 *   awaited.
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
    const [error, result] = balancer.pick(info);
    return error === null
      ? [null, resolve(result)]
      : [createPreflightFault("REQ_BUILD_FAILED", error), undefined];
  } catch (cause) {
    return [createPreflightFault("REQ_BUILD_FAILED", cause), undefined];
  }
}

function resolve(result: PickResult): ResolvedEndpoint {
  let phase: "picked" | "started" | "ended" | "done" = "picked";
  const start = result.start;
  const done = result.done;
  const end = result.end;
  return {
    endpoint: result.endpoint,
    start() {
      if (phase !== "picked") return;
      phase = "started";
      try {
        start?.();
      } catch (thrown) {
        // Callback failures must not change the transport attempt.
        reportContainedError(thrown);
      }
    },
    end(info) {
      if (phase !== "started") return;
      phase = "ended";
      try {
        end?.(attributed(info));
      } catch (thrown) {
        // Callback failures must not change the transport attempt.
        reportContainedError(thrown);
      }
    },
    done(info) {
      if (phase === "done") return;
      phase = "done";
      try {
        done?.(attributed(info));
      } catch (thrown) {
        // A throwing done must not replace the operation tuple.
        reportContainedError(thrown);
      }
    },
  };
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
