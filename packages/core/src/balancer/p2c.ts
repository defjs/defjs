import { rememberEndpoint } from "./retention";
import { monotonicNow } from "./clock";
import type { Balancer } from "./balancer";
import { ERR_NO_CANDIDATE } from "./balancer";
import { withHealthFilter } from "./outlier_detection";
import type { OutlierDetectionOptions } from "./outlier_detection";
/**
 * Options for {@link p2cBalancer}.
 *
 * @group client
 * @see {@link p2cBalancer}
 */
export interface P2cOptions {
  /** Load signal: `"peakEwma"` (default) or `"pending"` in-flight attempts. */
  readonly load?: "peakEwma" | "pending";
  /** Number of candidates sampled, at least 2 and capped at 10; defaults to 2. */
  readonly choiceCount?: number;
  /** Initial RTT estimate in milliseconds; defaults to 30. */
  readonly defaultRttMs?: number;
  /** RTT decay time in milliseconds; defaults to 10000. */
  readonly decayMs?: number;
  /** Health filtering; off by default. `{}` enables the defaults. */
  readonly outlierDetection?: OutlierDetectionOptions | false;
}
interface LoadState {
  pending: number;
  rttMs: number;
  updatedAt: number;
}
// Decay underflow to zero erases pending from cost; only exact zero needs a floor.
const MIN_ESTIMATE_MS = Number.MIN_VALUE;

/**
 * Samples candidates without replacement and selects the least loaded draw.
 *
 * Defaults to two choices and PeakEwma load: decaying RTT times (pending + 1).
 * `load: "pending"` selects the fewest in-flight attempts in the sample. Ties
 * favor the first draw. `choiceCount` is at least 2, capped at 10.
 * `defaultRttMs` defaults to 30 and `decayMs` to 10000 (Linkerd). Pending is reserved when `pick` selects the endpoint, so
 * concurrent picks in one tick see each other, and releases at `end`, the
 * beginning of a peer response (tower CompleteOnResponse), or at `done` when no
 * response began. RTT is the real start-to-end duration for every transport,
 * including failures. Higher samples replace the estimate; lower samples blend
 * exponentially, as in tower PeakEwma. Idle estimates decay toward zero. A done
 * without end creates no sample. Health filtering is off by default; with
 * `outlierDetection: {}` it ejects quickly failing endpoints. There is no
 * synthetic failure penalty.
 * Unlike Envoy and gRPC A48, draws are without replacement.
 * Load history keeps at least 256 endpoints, and at least the current members, in
 * LRU order, evicting idle entries first; an in-flight entry is evicted only if
 * all retained entries are busy. Evicted endpoints restart from the configured
 * initial estimate.
 *
 * @param options - Captured load settings, optional health filtering.
 * @returns A new independent balancer.
 * @group client
 * @see {@link P2cOptions}
 * @see {@link outlierDetection}
 * @see {@link roundRobinBalancer}
 */
export function p2cBalancer(options?: P2cOptions): Balancer {
  const load = options?.load ?? "peakEwma";
  const choiceCount = Math.min(options?.choiceCount ?? 2, 10);
  const defaultRttMs = options?.defaultRttMs ?? 30;
  const decayMs = options?.decayMs ?? 10000;
  const states = new Map<string, LoadState>();
  function stateFor(endpoint: string, now: number, members: number): LoadState {
    let state = states.get(endpoint);
    if (state === undefined) {
      state = { pending: 0, rttMs: defaultRttMs, updatedAt: now };
    }
    rememberEndpoint(
      states,
      endpoint,
      state,
      (value) => (value.pending === 0 ? 0 : 1),
      members,
    );
    return state;
  }
  function finiteEstimate(value: number): number {
    return Number.isFinite(value)
      ? Math.max(value, MIN_ESTIMATE_MS)
      : defaultRttMs;
  }
  function cost(state: LoadState, now: number): number {
    if (load === "pending") return state.pending;
    state.rttMs = finiteEstimate(
      state.rttMs * Math.exp(-Math.max(0, now - state.updatedAt) / decayMs),
    );
    state.updatedAt = now;
    return finiteEstimate(state.rttMs * (state.pending + 1));
  }
  const child: Balancer = {
    pick(info) {
      if (info.endpoints.length === 0) return [ERR_NO_CANDIDATE, undefined];
      const members = Math.max(
        info.members?.length ?? 0,
        info.endpoints.length,
      );
      const remaining = info.endpoints.slice();
      const now = monotonicNow();
      let chosen:
        { endpoint: string; state: LoadState; cost: number } | undefined;
      const count = Math.min(choiceCount, remaining.length);
      for (let i = 0; i < count; i += 1) {
        const index =
          remaining.length === 1
            ? 0
            : Math.floor(Math.random() * remaining.length);
        const endpoint = remaining.splice(index, 1)[0];
        if (endpoint === undefined) continue;
        const state = stateFor(endpoint, now, members);
        const value = cost(state, now);
        if (chosen === undefined || value < chosen.cost)
          chosen = { endpoint, state, cost: value };
      }
      if (chosen === undefined) return [ERR_NO_CANDIDATE, undefined];
      const endpoint = chosen.endpoint;
      const state = chosen.state;
      // Reserved at selection, as Kratos and go-zero count in-flight picks, so a same-tick burst sees it.
      state.pending += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        state.pending = Math.max(0, state.pending - 1);
      };
      let startedAt: number | undefined;
      let ended = false;
      let finished = false;
      return [
        null,
        {
          endpoint,
          start() {
            if (startedAt === undefined && !finished) {
              startedAt = monotonicNow();
            }
          },
          end() {
            if (startedAt === undefined || ended || finished) return;
            ended = true;
            release();
            const at = monotonicNow();
            const sample = Math.max(0, at - startedAt);
            const d = Math.exp(-Math.max(0, at - state.updatedAt) / decayMs);
            state.rttMs = finiteEstimate(
              sample > state.rttMs
                ? sample
                : state.rttMs * d + sample * (1 - d),
            );
            state.updatedAt = at;
          },
          done() {
            if (finished) return;
            finished = true;
            release();
          },
        },
      ];
    },
  };
  return withHealthFilter(child, options?.outlierDetection);
}
