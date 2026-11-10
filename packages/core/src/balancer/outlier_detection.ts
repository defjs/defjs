import { rememberEndpoint } from "./retention";
import { monotonicNow } from "../internal/clock";
import type { Balancer, DoneInfo } from "./balancer";
import { memberList } from "./balancer";

/**
 * Failure counting that ejects an endpoint for a while, and an optional
 * application-defined health check.
 * The library does not know what healthy means. It counts classified failures,
 * ejects an endpoint by time, and puts it back when the time is up; only
 * `isHealthy` can say that an endpoint is unfit, and only the application
 * supplies it. No timers, ejection quotas, settlement grid, or slow start are used.
 * @group client
 * @see {@link outlierDetection}
 */
export interface OutlierDetectionOptions {
  /** Consecutive failures that eject an endpoint; defaults to 5 (Finagle). Zero disables passive breaking. */
  readonly consecutiveFailures?: number;
  /** First penalty in milliseconds, also the step added per level; defaults to 1000 ms (Linkerd). */
  readonly minPenaltyMs?: number;
  /** Penalty cap in milliseconds, at least `minPenaltyMs`; defaults to 60000 ms (Linkerd). */
  readonly maxPenaltyMs?: number;
  /** Jitter ratio from 0 to 1; defaults to 0.5 (Linkerd). */
  readonly jitterRatio?: number;
  /**
   * Synchronous rule that decides which outcomes count toward ejection. The
   * default counts every outcome with a `code`. It is a trigger for time-based
   * ejection, not a judgement of health; replace it to count differently. A
   * throw is not caught here; it leaves `done` and is contained and reported
   * like any other `done` failure.
   */
  readonly isFailure?: (info: DoneInfo) => boolean;
  /**
   * The only health judgement. Synchronous, called on every pick for each
   * endpoint that is not currently ejected (an ejected endpoint is not asked),
   * so it should read state that the application keeps up to date. An
   * endpoint for which it returns `false` is not selected. Returning `true`
   * does not end an ejection: the endpoint must also not be ejected. A throw is
   * not caught here; `pickEndpoint` reports it as `REQ_BUILD_FAILED` with the
   * thrown value as `cause`.
   */
  readonly isHealthy?: (endpoint: string) => boolean;
}
/** One penalty level decays per ten seconds without an ejection (gRPC A50 and Envoy default to 10 s). */
const LEVEL_DECAY_MS = 10_000;
interface HealthState {
  /** The endpoint is ejected while the clock is before this. */
  until: number;
  level: number;
  /** Start of the time that has not yet decayed a level. */
  healthyFrom: number;
  consecutive: number;
  /** Counts ejections, so a sample from an attempt that started before one can be told apart. */
  ejections: number;
}
/** Default classifier: every classified attempt failure, including timeouts and incomplete bodies. */
export function defaultEndpointFailure(info: DoneInfo): boolean {
  return info.code !== undefined;
}
/**
 * Wraps a strategy with consecutive-failure ejection by time.
 * Five attributed failures eject an endpoint by default. The penalty is the
 * minimum penalty (1s by default) times the penalty level, so successive
 * ejections last 1s, 2s, 3s and so on; uniform positive jitter of up to 0.5
 * times the base is added, and the total caps at 60s. When the time is up the
 * endpoint is selectable again; nothing probes it or decides that it has
 * recovered. As in gRPC outlier detection (gRFC A50) a success never clears the
 * penalty level: every ejection raises it by one and every ten seconds without
 * one lowers it by one, evaluated when the endpoint is next used. An endpoint
 * that accepts a connection and then drops it is therefore ejected for longer
 * each time, as long as its failures return faster than one level decays.
 * Every classified failure code fails by default, including NET_TIMEOUT and
 * NET_BODY_INCOMPLETE, as Envoy's consecutive 5xx and gRPC outlier detection
 * count timeouts and resets; `isFailure` replaces that rule. An attempted
 * outcome without a code resets the streak; unattributed attempts leave it
 * unchanged. The outcome of an attempt that began before an
 * ejection, or while the endpoint was ejected, is ignored even if it arrives
 * after the endpoint is selectable again, so late results do not eject it anew.
 * The child receives the filtered candidates as `endpoints` and the unfiltered
 * `members`, so ejection does not look like a membership change to it.
 * `isHealthy`, when supplied, is the only health judgement and combines with
 * ejection by AND: it can keep an endpoint out, and `true` cannot let an ejected
 * endpoint in. If it rejects every endpoint that is not ejected, it is ignored
 * for that pick. If every endpoint is ejected, the original current list is
 * used (Finagle panic mode). Unlike Envoy and gRPC A50 there is no ejection
 * quota. All callbacks are synchronous; no timer is created. Configuration is
 * captured at construction.
 * History holds at least 256 endpoints, and at least the current list, shared
 * across endpoint lists. LRU clean or expired states are evicted first, then
 * partial failure sequences, then the oldest protected state only if every
 * retained endpoint is ejected. Temporary candidate exclusion does not itself
 * erase a penalty.
 * @param child - Selection strategy retaining its identity and state.
 * @param options - Captured thresholds and application callbacks.
 * @returns An independent wrapper.
 * @group client
 * @see {@link OutlierDetectionOptions}
 * @see {@link roundRobinBalancer}
 * @see {@link p2cBalancer}
 */
export function outlierDetection(
  child: Balancer,
  options?: OutlierDetectionOptions,
): Balancer {
  const minimum = options?.minPenaltyMs ?? 1000;
  const maximum = options?.maxPenaltyMs ?? 60000;
  const jitter = options?.jitterRatio ?? 0.5;
  const consecutive = options?.consecutiveFailures ?? 5;
  const isFailure = options?.isFailure ?? defaultEndpointFailure;
  const isHealthy = options?.isHealthy;
  const states = new Map<string, HealthState>();
  function stateFor(endpoint: string, members: number): HealthState {
    let state = states.get(endpoint);
    if (state === undefined) {
      state = {
        until: 0,
        level: 0,
        healthyFrom: 0,
        consecutive: 0,
        ejections: 0,
      };
    }
    rememberEndpoint(
      states,
      endpoint,
      state,
      (value) => {
        if (monotonicNow() < value.until) return 2;
        return value.consecutive === 0 ? 0 : 1;
      },
      members,
    );
    return state;
  }
  function refresh(state: HealthState, now: number): void {
    if (now < state.until) return;
    const steps = Math.max(
      0,
      Math.floor((now - state.healthyFrom) / LEVEL_DECAY_MS),
    );
    state.level = Math.max(0, state.level - steps);
    state.healthyFrom += steps * LEVEL_DECAY_MS;
  }
  function ejectEndpoint(state: HealthState, now: number): void {
    state.level += 1;
    const base = Math.min(minimum * state.level, maximum);
    state.until =
      now +
      base +
      (jitter === 0
        ? 0
        : Math.min(base * jitter * Math.random(), maximum - base));
    state.healthyFrom = state.until;
    state.consecutive = 0;
    state.ejections += 1;
  }
  function sample(state: HealthState, report: DoneInfo): void {
    const now = monotonicNow();
    refresh(state, now);
    if (!report.attempted || consecutive === 0) return;
    state.consecutive = isFailure(report) ? state.consecutive + 1 : 0;
    if (state.consecutive >= consecutive) ejectEndpoint(state, now);
  }
  return {
    pick(info) {
      const now = monotonicNow();
      const members = memberList(info.members, info.endpoints);
      const available = info.endpoints.filter((endpoint) => {
        const state = states.get(endpoint);
        if (state === undefined) return true;
        refresh(state, now);
        return now >= state.until;
      });
      let candidates: readonly string[] =
        isHealthy === undefined
          ? available
          : available.filter((endpoint) => isHealthy(endpoint));
      if (candidates.length === 0) candidates = available;
      if (
        candidates.length === 0 ||
        candidates.length === info.endpoints.length
      )
        candidates = info.endpoints;
      const [error, result] = child.pick(
        candidates === info.endpoints
          ? info
          : { ...info, endpoints: candidates, members },
      );
      if (error !== null) return [error, undefined];
      const state = candidates.includes(result.endpoint)
        ? stateFor(result.endpoint, members.length)
        : undefined;
      // An attempt that starts while the endpoint is ejected, or that an
      // ejection overtakes, no longer says anything about the endpoint.
      const counted =
        state !== undefined && now >= state.until ? state.ejections : undefined;
      const childDone = result.done;
      return [
        null,
        {
          endpoint: result.endpoint,
          start: result.start,
          end: result.end,
          done(report) {
            // The child hears first, so an `isFailure` that throws cannot leave state it reserved unreleased.
            const returned = childDone?.(report);
            if (state !== undefined && state.ejections === counted)
              sample(state, report);
            return returned;
          },
        },
      ];
    },
  };
}
/** Applies the health filter option shared by built-in factories: off unless an object is given. */
export function withHealthFilter(
  child: Balancer,
  option: OutlierDetectionOptions | false | undefined,
): Balancer {
  return option === undefined || option === false
    ? child
    : outlierDetection(child, option);
}
