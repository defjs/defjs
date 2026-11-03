import type { EndpointBalancer, EndpointDoneInfo } from "./balancer";
import { balancerOptionError } from "./balancer";

/**
 * Linkerd-style consecutive-failure circuit breaking and optional cached health checks.
 * All endpoints may break; Finagle-style fail-open falls back to the current list.
 * No timers, ejection quotas, settlement grid, or slow start are used.
 * @group client
 * @see {@link outlierDetection}
 */
export interface OutlierDetectionOptions {
  /** Nonnegative safe integer; defaults to 5 (Finagle). Zero disables passive breaking. */
  readonly consecutiveFailures?: number;
  /** Positive finite first penalty; defaults to 1000 ms (Linkerd). */
  readonly minPenaltyMs?: number;
  /** Positive finite cap, at least minPenaltyMs; defaults to 60000 ms (Linkerd). */
  readonly maxPenaltyMs?: number;
  /** Finite positive-jitter ratio in [0, 1]; defaults to 0.5 (Linkerd). */
  readonly jitterRatio?: number;
  /** Synchronous classifier. Throws and non-booleans discard the sample. */
  readonly isFailure?: (info: EndpointDoneInfo) => boolean;
  /** Synchronous cached check. Invalid results reject only that pick with REQ_OPTIONS_INVALID. */
  readonly isHealthy?: (endpoint: string) => boolean;
}
interface HealthState {
  phase: "available" | "broken" | "probing";
  until: number;
  level: number;
  consecutive: number;
  probe: object | undefined;
}
/** Default classifier: coded timeouts and incomplete bodies take precedence over status. */
export function defaultEndpointFailure(info: EndpointDoneInfo): boolean {
  return (
    info.code !== "NET_TIMEOUT" &&
    info.code !== "NET_BODY_INCOMPLETE" &&
    (info.code === "NET_UNREACHABLE" || (info.status ?? 0) >= 500)
  );
}
/** Invalid application classifiers discard samples. */
export function classifyEndpointFailure(
  classifier: (info: EndpointDoneInfo) => boolean,
  info: EndpointDoneInfo,
): boolean | undefined {
  try {
    const result: unknown = classifier(info);
    return typeof result === "boolean" ? result : undefined;
  } catch {
    return undefined;
  }
}
/**
 * Wraps a strategy with Linkerd-style consecutive-failure circuit breaking.
 * Five attributed failures break an endpoint by default. Penalties start at 1s,
 * double after failed probes, add uniform positive jitter of up to 0.5 times the
 * base, and cap at 60s. A successful probe resets the backoff. Expiry admits one
 * probe, decided at transport `end` (headers or socket open), as in Finagle.
 * `done` without `end` decides the probe instead; later done is an ordinary sample.
 * NET_UNREACHABLE and 5xx fail by default, not timeouts or incomplete bodies.
 * Active true cannot cancel a penalty. Empty candidates first ignore active checks,
 * then fall back to the original current list (Finagle panic mode). Unlike Envoy
 * and gRPC A50 there is no ejection quota. All callbacks are synchronous; no timer
 * is created. Configuration is captured at construction.
 * @param child - Selection strategy retaining its identity and state.
 * @param options - Captured thresholds and application callbacks.
 * @returns An independent wrapper; invalid options become REQ_OPTIONS_INVALID.
 * @group client
 * @see {@link OutlierDetectionOptions}
 * @see {@link roundRobinBalancer}
 * @see {@link p2cBalancer}
 */
export function outlierDetection(
  child: EndpointBalancer,
  options?: OutlierDetectionOptions,
): EndpointBalancer {
  const invalid = invalidHealthOptions(options);
  if (invalid !== undefined) return { pick: () => [invalid, undefined] };
  const minimum = options?.minPenaltyMs ?? 1000;
  const maximum = options?.maxPenaltyMs ?? 60000;
  const jitter = options?.jitterRatio ?? 0.5;
  const consecutive = options?.consecutiveFailures ?? 5;
  const isFailure = options?.isFailure ?? defaultEndpointFailure;
  const isHealthy = options?.isHealthy;
  const states = new Map<string, HealthState>();
  function stateFor(endpoint: string): HealthState {
    let state = states.get(endpoint);
    if (state === undefined) {
      state = {
        phase: "available",
        until: 0,
        level: 0,
        consecutive: 0,
        probe: undefined,
      };
      states.set(endpoint, state);
    }
    return state;
  }
  function refresh(state: HealthState, now: number): void {
    if (state.phase === "broken" && now >= state.until) state.phase = "probing";
  }
  function breakEndpoint(state: HealthState, now: number): void {
    const base = Math.min(minimum * 2 ** state.level, maximum);
    state.until =
      now +
      base +
      (jitter === 0
        ? 0
        : Math.min(base * jitter * Math.random(), maximum - base));
    state.phase = "broken";
    state.consecutive = 0;
    state.probe = undefined;
  }
  function sample(
    state: HealthState,
    report: EndpointDoneInfo,
    probe: object | undefined,
    terminal: boolean,
  ): void {
    const now = Date.now();
    refresh(state, now);
    const isProbe = probe !== undefined && state.probe === probe;
    if (!report.attempted) {
      if (isProbe) state.probe = undefined;
      return;
    }
    if (!isProbe && state.phase !== "available") return;
    const failed = classifyEndpointFailure(isFailure, report);
    if (failed === undefined) {
      // A discarded terminal sample must not strand a probe without an owner.
      if (isProbe && terminal) state.probe = undefined;
      return;
    }
    if (isProbe) {
      state.probe = undefined;
      if (failed) {
        state.level += 1;
        breakEndpoint(state, now);
      } else {
        state.phase = "available";
        state.level = 0;
        state.consecutive = 0;
      }
    } else if (consecutive > 0) {
      state.consecutive = failed ? state.consecutive + 1 : 0;
      if (state.consecutive >= consecutive) {
        state.level = 0;
        breakEndpoint(state, now);
      }
    }
  }
  return {
    pick(info) {
      const now = Date.now();
      const eligible = info.endpoints.filter((endpoint) => {
        const state = stateFor(endpoint);
        refresh(state, now);
        return (
          state.phase === "available" ||
          (state.phase === "probing" && state.probe === undefined)
        );
      });
      let candidates: readonly string[] = eligible;
      if (isHealthy !== undefined) {
        const active = new Set<string>();
        try {
          for (const endpoint of info.endpoints) {
            const healthy: unknown = isHealthy(endpoint);
            if (typeof healthy !== "boolean")
              throw new TypeError("isHealthy must return a boolean");
            if (healthy) active.add(endpoint);
          }
        } catch {
          return [
            balancerOptionError(
              new TypeError("isHealthy must synchronously return a boolean"),
            ),
            undefined,
          ];
        }
        candidates = eligible.filter((endpoint) => active.has(endpoint));
      }
      if (candidates.length === 0) candidates = eligible;
      if (
        candidates.length === 0 ||
        candidates.length === info.endpoints.length
      )
        candidates = info.endpoints;
      const [error, result] = child.pick({ ...info, endpoints: candidates });
      if (error !== null) return [error, undefined];
      const state = states.get(result.endpoint);
      const probe =
        state?.phase === "probing" ? (state.probe ?? {}) : undefined;
      if (state && probe) state.probe = probe;
      return [
        null,
        {
          endpoint: result.endpoint,
          start: result.start,
          end(report) {
            if (state && probe !== undefined && state.probe === probe)
              sample(state, report, probe, false);
            return result.end?.(report);
          },
          done(report) {
            if (state) sample(state, report, probe, true);
            return result.done?.(report);
          },
        },
      ];
    },
  };
}
function invalidHealthOptions(options: unknown): Error | undefined {
  if (options === undefined) return undefined;
  if (!isBalancerOptionRecord(options))
    return balancerOptionError(
      new TypeError("outlierDetection options must be an object"),
    );
  if (
    "maxEjectionPercent" in options ||
    "baseEjectionMs" in options ||
    "maxEjectionMs" in options ||
    "intervalMs" in options ||
    "failurePercentage" in options ||
    "halfOpen" in options ||
    "probeTimeoutMs" in options ||
    "slowStartWindowMs" in options ||
    "slowStartMinWeightPercent" in options
  )
    return balancerOptionError(
      new TypeError("Removed outlierDetection option"),
    );
  const invalid =
    positiveOption(options["minPenaltyMs"], "minPenaltyMs") ??
    positiveOption(options["maxPenaltyMs"], "maxPenaltyMs") ??
    integerOption(options["consecutiveFailures"], "consecutiveFailures") ??
    callbackOption(options["isFailure"], "isFailure") ??
    callbackOption(options["isHealthy"], "isHealthy");
  if (invalid) return invalid;
  const min = options["minPenaltyMs"] ?? 1000;
  const max = options["maxPenaltyMs"] ?? 60000;
  if (typeof min === "number" && typeof max === "number" && max < min)
    return balancerOptionError(
      new RangeError("maxPenaltyMs must not be less than minPenaltyMs"),
    );
  const ratio = options["jitterRatio"];
  return ratio === undefined ||
    (typeof ratio === "number" &&
      Number.isFinite(ratio) &&
      ratio >= 0 &&
      ratio <= 1)
    ? undefined
    : balancerOptionError(
        new RangeError("jitterRatio must be finite and between 0 and 1"),
      );
}
/** Fixed-shape option validation shared by built-in factories. */
export function isBalancerOptionRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validates optional finite positive numeric configuration. */
export function positiveOption(
  value: unknown,
  name: string,
): Error | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number")
    return balancerOptionError(new TypeError(`${name} must be a number`));
  return Number.isFinite(value) && value > 0
    ? undefined
    : balancerOptionError(
        new RangeError(`${name} must be finite and positive`),
      );
}

function integerOption(value: unknown, name: string): Error | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number")
    return balancerOptionError(new TypeError(`${name} must be a number`));
  return Number.isSafeInteger(value) && value >= 0
    ? undefined
    : balancerOptionError(
        new RangeError(`${name} must be a nonnegative safe integer`),
      );
}

/** Validates optional synchronous application callback types at construction. */
export function callbackOption(
  value: unknown,
  name: string,
): Error | undefined {
  return value === undefined || typeof value === "function"
    ? undefined
    : balancerOptionError(new TypeError(`${name} must be a function`));
}

/** Applies factory health defaults without a second implementation of the filter. */
export function withHealthFilter(
  child: EndpointBalancer,
  option: OutlierDetectionOptions | false | undefined,
  enabledByDefault: boolean,
): EndpointBalancer {
  if (option === false || (option === undefined && !enabledByDefault))
    return child;
  return outlierDetection(child, option);
}
