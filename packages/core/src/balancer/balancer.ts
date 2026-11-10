import { rememberEndpoint } from "./retention";
import { monotonicNow } from "../internal/clock";
import {
  withHealthFilter,
  type OutlierDetectionOptions,
} from "./outlier_detection";

/**
 * Chooses one endpoint for a call.
 *
 * `pick` is synchronous and returns an error-first tuple. It does not throw
 * for an empty candidate list or for invalid factory options. Built-in
 * factories record invalid options at construction and return that error from
 * every later `pick`. A selected endpoint must belong to the candidates supplied
 * to that pick; a foreign selection becomes `REQ_BUILD_FAILED`, and its `done`
 * is called with `{ attempted: false }`.
 *
 * @group client
 */
export interface Balancer {
  /**
   * Selects an endpoint synchronously, or returns an error when none can be selected.
   * Must be synchronous: a returned promise is not awaited and its rejection is ignored.
   * A promise is an invalid pick outcome and becomes `REQ_BUILD_FAILED`.
   */
  pick(info: PickInfo): PickOutcome;
}

/**
 * Error-first result of {@link Balancer.pick}.
 *
 * `[Error, undefined]` selects nothing. `[null, result]` is the selected
 * endpoint. The error comes first, matching operation results.
 *
 * @group client
 */
export type PickOutcome =
  | readonly [err: Error, result: undefined]
  | readonly [err: null, result: PickResult];

/**
 * What the runtime tells `pick` about this call.
 *
 * `endpoints` is the candidate list in first-seen order. It may be empty and
 * must not be modified. An empty list returns `[ERR_NO_CANDIDATE, undefined]`.
 * A retry picks again from every endpoint. Only a wrapping balancer that
 * filters candidates can make the list shorter than the client's endpoint list.
 *
 * `members` is the client's whole endpoint list, the same for every attempt.
 * A narrower `endpoints` is a per-pick filter, not a membership change, so
 * balancers that keep order or per-endpoint state key it on `members`.
 *
 * @group client
 */
export interface PickInfo {
  /** Candidate endpoints for this pick. Already deduplicated by first occurrence. Do not modify. */
  readonly endpoints: readonly string[];
  /** Every client endpoint, a superset of `endpoints`. Absent means `endpoints`. Do not modify. */
  readonly members?: readonly string[];
  /** `operation` from the definition, when it has one. */
  readonly operation?: string;
}

/**
 * Endpoint selected for one call.
 *
 * `done` is optional. When present, the runtime calls it once, synchronously,
 * with the outcome of this pick, or `{ attempted: false }` when no attempt can
 * be attributed to the endpoint.
 *
 * The runtime reads `start`, `end`, and `done` once, when the pick returns, and
 * calls each without a receiver, so `this` is `undefined`. Use arrow functions,
 * closures, or bound functions for state. A synchronous throw does not change
 * the attempt or the operation tuple. It is reported with `reportError` where
 * the runtime defines it, and that can end a Bun or Deno process that has no
 * error handler. Where the runtime has no `reportError`, as in Node.js, the
 * throw stays contained. A returned promise is not awaited and its rejection is
 * ignored.
 *
 * @group client
 */
export interface PickResult {
  /** One of this pick's candidate endpoints. Membership is checked, URL syntax is not. */
  readonly endpoint: string;
  /**
   * Called synchronously at most once immediately before the attempt begins.
   * Not called for build failures, interceptor short-circuits, or pre-transport cancellation.
   * A throw or returned thenable is contained exactly like `done`.
   */
  readonly start?: () => void;
  /**
   * Called synchronously at most once after start, when the peer response begins,
   * or when transport fails before that response. Caller cancellation is unattributed,
   * and so is a network error on a streamed HTTP request body.
   * A throw or returned thenable is contained exactly like `done`.
   */
  readonly end?: (info: DoneInfo) => void;
  /**
   * Called once with the attempt outcome. Omit when the balancer keeps no per-pick state.
   * Must be synchronous: a returned promise is not awaited and its rejection is ignored.
   * A throw does not replace the operation tuple; it is reported as described above.
   */
  readonly done?: (info: DoneInfo) => void;
}

/**
 * Neutral attempt outcome codes observed through `end` and `done`.
 *
 * `end` reports the beginning of a peer response; later failures can still give
 * `done` a different `code`. Unavailability and server failures describe a peer
 * that answered, while unreachable and timeout outcomes describe transport failures.
 * Normal completion and application errors do not themselves create failure samples.
 *
 * Transport mapping: HTTP and SSE statuses 502, 503, and 504 map to
 * `NET_UNAVAILABLE`; other statuses at least 500 map to `NET_SERVER_ERROR`.
 * Incomplete HTTP bodies retain `NET_BODY_INCOMPLETE` and their status.
 * An SSE body-read rejection, a WebSocket heartbeat acknowledgement timeout,
 * or an opened WebSocket's close code 1006 or 1015 (no close frame arrived)
 * maps to `NET_UNREACHABLE`, without a status; a WebSocket close frame with
 * 1012 or 1013 maps to `NET_UNAVAILABLE`, even when the engine dispatched no
 * `open` event before it; both unless timeout or cancellation takes priority.
 * Other close codes are not failures, whatever `wasClean` reports: engines
 * disagree on it for a server-initiated close.
 *
 * @group client
 */
export type PickFaultCode =
  | "NET_UNREACHABLE"
  | "NET_UNAVAILABLE"
  | "NET_SERVER_ERROR"
  | "NET_TIMEOUT"
  | "NET_BODY_INCOMPLETE";

/**
 * Outcome of the attempt that used the selected endpoint.
 *
 * `attempted: false` means no attempt is attributed to that endpoint: nothing
 * was sent, the attempt ended by caller cancellation or `close()`, or `fetch`
 * rejected a streamed HTTP request body with a network error before any
 * response. Both `code` and `status` are then absent. `attempted: true` with no
 * `code` means the peer answered without a classified failure. Built-in balancers
 * read only the neutral `code`, never `status`.
 *
 * A streamed HTTP request body is a caller-supplied `ReadableStream`. `fetch`
 * rejects it with the same network error for a refused connection, an HTTP/1.1 connection, a redirect that cannot
 * replay the stream, a failed CORS preflight, and a source stream that throws,
 * so that error does not reliably show the endpoint is down and is reported as
 * `{ attempted: false }`. The cost is that a genuinely down endpoint is not
 * detected by streamed uploads alone: they do not switch `pickFirst` away from
 * it and do not count toward `outlierDetection`.
 *
 * @group client
 */
export interface DoneInfo {
  /** Whether a transport attempt reached the selected endpoint. */
  readonly attempted: boolean;
  /** Neutral attempt outcome, including failures after a peer response begins. */
  readonly code?: PickFaultCode;
  /** Raw response status for custom balancers; built-in balancers never read it. */
  readonly status?: number;
}

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

/** Not exported. Marks a factory option error so the runtime can report `REQ_OPTIONS_INVALID`. */
const OPTION_ERROR = Symbol("defjs.balancer.option-error");

/** Brands `error` as an invalid built-in balancer option. Not a package export. */
export function balancerOptionError(error: Error): Error {
  Object.defineProperty(error, OPTION_ERROR, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return error;
}

/** Whether `error` was branded by {@link balancerOptionError}. */
export function isBalancerOptionError(error: Error): boolean {
  return OPTION_ERROR in error;
}

/**
 * Options for {@link pickFirstBalancer}.
 *
 * @group client
 * @see {@link pickFirstBalancer}
 */
export interface PickFirstOptions {
  /** Health filtering around the sticky order; off by default. `{}` enables the defaults. */
  readonly outlierDetection?: OutlierDetectionOptions | false;
  /** Random but stable endpoint order instead of list order; defaults to `false`. */
  readonly shuffle?: boolean;
  /** Finite positive time away from the first endpoint after which the next pick returns to it; unset disables failback. */
  readonly failbackMs?: number;
}

/**
 * Sticky failover balancer. The default when a client sets no balancer.
 *
 * Uses the first endpoint until `done` reports
 * `{ attempted: true, code: "NET_UNREACHABLE" }` or `NET_UNAVAILABLE` for the
 * endpoint that is still sticky. The next `pick` then moves
 * to the following endpoint and wraps to the first. Other results, including timeouts and
 * `attempted: false`, keep the current endpoint. Overlapping failures advance
 * one step: a `done` that finds the sticky endpoint already changed does nothing.
 *
 * Order and the sticky endpoint follow `members`. When the sticky endpoint is
 * not among this pick's `endpoints`, as when a wrapper filters candidates, the
 * pick takes the next candidate after it in member order without moving it, so
 * a narrowed pick never changes where later calls go. Only a sticky endpoint missing from `members`
 * resets the order to the first.
 *
 * `shuffle: true` assigns each endpoint a random sort key on first sight and
 * sticks to that order. Keys survive a shorter endpoint list. The default is
 * `false`. Shuffle history keeps at least 256 endpoints, and at least the
 * current members, in least-recently-used order; a forgotten endpoint gets a new
 * random key when it returns.
 *
 * `failbackMs`, when finite and positive, returns to the first endpoint by time
 * alone: once the sticky endpoint has been away from the first for that long, the
 * next pick whose candidates include the first selects it and makes it sticky
 * again. Nothing judges whether the first endpoint has recovered. If it fails
 * again, the ordinary advance rule above moves on and the time starts anew.
 * Choose an interval longer than the time between picks, such as a reconnect
 * delay, or every pick returns to the first endpoint. No background timer is
 * created.
 *
 * Every successful `pick` returns `done`. An empty candidate list returns
 * `[ERR_NO_CANDIDATE, undefined]`. Invalid options are remembered here and
 * returned from every `pick` without throwing.
 *
 * Health filtering is off by default. Supply `outlierDetection: {}` to enable
 * default ejection, or configure its thresholds and application health function.
 *
 * @param options - Optional shuffled order, failback interval, health filtering.
 * @returns A new balancer. Each call has its own sticky endpoint.
 * @group client
 * @see {@link PickFirstOptions}
 */
export function pickFirstBalancer(options?: PickFirstOptions): Balancer {
  const invalid = invalidPickFirst(options);
  const shuffle = options?.shuffle === true;
  const keys = new Map<string, number>();
  let sticky: string | undefined;
  let leftFirstAt: number | undefined;
  const failbackMs = options?.failbackMs;

  const child: Balancer = {
    pick(info) {
      if (invalid !== undefined) {
        return [invalid, undefined];
      }
      const candidates = info.endpoints;
      if (candidates.length === 0) {
        return [ERR_NO_CANDIDATE, undefined];
      }
      const order = candidateOrder(
        memberList(info.members, candidates),
        shuffle,
        keys,
      );
      const first = order[0];
      if (first === undefined) {
        return [ERR_NO_CANDIDATE, undefined];
      }
      if (sticky === undefined || !order.includes(sticky)) {
        sticky = first;
      }
      if (
        sticky !== first &&
        candidates.includes(first) &&
        failbackMs !== undefined &&
        leftFirstAt !== undefined &&
        monotonicNow() - leftFirstAt >= failbackMs
      ) {
        sticky = first;
      }
      const chosen = nextCandidate(order, order.indexOf(sticky), candidates);
      if (chosen === undefined) {
        return [ERR_NO_CANDIDATE, undefined];
      }
      return [
        null,
        {
          endpoint: chosen,
          done(report) {
            if (!advancesSticky(report) || sticky !== chosen) return;
            const next = order[(order.indexOf(chosen) + 1) % order.length];
            if (next !== undefined) {
              if (chosen === first && next !== first)
                leftFirstAt = monotonicNow();
              sticky = next;
            }
          },
        },
      ];
    },
  };
  if (invalid !== undefined) return child;
  return withHealthFilter(child, options?.outlierDetection);
}

function advancesSticky(report: DoneInfo): boolean {
  return (
    report.attempted &&
    (report.code === "NET_UNREACHABLE" || report.code === "NET_UNAVAILABLE")
  );
}

/** First member at or after `offset`, wrapping, that is a candidate of this pick. */
function nextCandidate(
  order: readonly string[],
  offset: number,
  candidates: readonly string[],
): string | undefined {
  return [...order.slice(offset), ...order.slice(0, offset)].find((endpoint) =>
    candidates.includes(endpoint),
  );
}

/**
 * Members in their own order, plus any candidate a caller left out of them, so
 * every candidate stays selectable.
 */
export function memberList(
  members: readonly string[] | undefined,
  candidates: readonly string[],
): readonly string[] {
  if (members === undefined || members === candidates) return candidates;
  const known = new Set(members);
  const missing = candidates.filter((endpoint) => !known.has(endpoint));
  return missing.length === 0 ? members : [...members, ...missing];
}

function invalidPickFirst(options: unknown): Error | undefined {
  if (options === undefined) {
    return undefined;
  }
  if (!isOptionRecord(options)) {
    return balancerOptionError(
      new TypeError("pickFirstBalancer options must be an object"),
    );
  }
  const shuffle = options["shuffle"];
  if (shuffle !== undefined && typeof shuffle !== "boolean") {
    return balancerOptionError(
      new TypeError("pickFirstBalancer shuffle must be a boolean"),
    );
  }
  const failbackMs = options["failbackMs"];
  if (
    failbackMs !== undefined &&
    (typeof failbackMs !== "number" ||
      !Number.isFinite(failbackMs) ||
      failbackMs <= 0)
  ) {
    return balancerOptionError(
      new RangeError(
        "pickFirstBalancer failbackMs must be finite and positive",
      ),
    );
  }
  return undefined;
}

function isOptionRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function candidateOrder(
  endpoints: readonly string[],
  shuffle: boolean,
  keys: Map<string, number>,
): readonly string[] {
  if (!shuffle) {
    return endpoints.slice();
  }
  const ranked: { endpoint: string; index: number; key: number }[] = [];
  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    if (endpoint === undefined) {
      continue;
    }
    let key = keys.get(endpoint);
    if (key === undefined) {
      key = Math.random();
    }
    rememberEndpoint(keys, endpoint, key, () => 0, endpoints.length);
    ranked.push({ endpoint, index, key });
  }
  ranked.sort(
    (left, right) => left.key - right.key || left.index - right.index,
  );
  return ranked.map((item) => item.endpoint);
}

/**
 * Options for {@link roundRobinBalancer}.
 *
 * @group client
 * @see {@link roundRobinBalancer}
 */
export interface RoundRobinOptions {
  /** Health filtering; off by default. `{}` enables the defaults. */
  readonly outlierDetection?: OutlierDetectionOptions | false;
  /**
   * Finite positive weight per endpoint; a missing weight is 1. Read by
   * iteration, so a `Map` from another realm and any custom `ReadonlyMap` work.
   * Copied at construction.
   */
  readonly weights?: ReadonlyMap<string, number>;
}

/**
 * Round-robin balancer, with nginx smooth weighting when `weights` is set.
 *
 * Without `weights`, a counter starts at a random `uint32` and each `pick`
 * returns `endpoints[counter % length]`, then increments the counter modulo
 * 2^32. With `weights`, each pick adds an endpoint's weight to its current
 * value, selects the highest value (earlier candidate on a tie), and subtracts
 * the total weight of this candidate list. Members left out of this pick's
 * candidates keep their current value, as nginx skips a peer that is down. A
 * missing weight is 1. Weights for endpoints not in the list are ignored.
 * Selection and the cleanup of current values for endpoints that left the
 * members take O(member count + candidate count) work per pick. Extreme weights
 * are scaled to avoid overflow; ratios below floating-point precision may round
 * to zero. Finite positive weights never produce a non-candidate selection.
 *
 * Without `weights`, every pick advances the counter, including a pick made for
 * a retry or a stream reconnect. Without `outlierDetection`, and with calls
 * that run one after another, an endpoint that fails persistently therefore
 * receives more than 1/n of the first attempts. With exactly two endpoints and
 * retries enabled it receives all of them, so every call needs one retry.
 * Concurrent calls interleave their picks and break this pattern.
 *
 * Health filtering is off by default, so successful picks omit `done`. Supply
 * `outlierDetection: {}` to enable it: five consecutive attributed failures then
 * eject an endpoint temporarily. An empty
 * candidate list returns `[ERR_NO_CANDIDATE, undefined]`. Invalid options are
 * remembered here and returned from every `pick` without throwing.
 *
 * @param options - Optional positive finite weights, health filtering.
 * @returns A new balancer. Each call has its own counter and weight state.
 * @group client
 * @see {@link RoundRobinOptions}
 */
export function roundRobinBalancer(options?: RoundRobinOptions): Balancer {
  const optionError = invalidRoundRobin(options);
  const copied = optionError === undefined ? copyWeights(options) : undefined;
  const invalid = copied instanceof Error ? copied : optionError;
  const weights = copied instanceof Error ? undefined : copied;
  let counter =
    invalid === undefined && weights === undefined
      ? Math.floor(Math.random() * 0x100000000) >>> 0
      : 0;
  let current = new Map<string, number>();
  let previousScale = 1;

  const child: Balancer = {
    pick(info) {
      if (invalid !== undefined) {
        return [invalid, undefined];
      }
      const endpoints = info.endpoints;
      if (endpoints.length === 0) {
        return [ERR_NO_CANDIDATE, undefined];
      }
      if (weights === undefined) {
        const endpoint = endpoints[counter % endpoints.length];
        counter = (counter + 1) >>> 0;
        if (endpoint === undefined) {
          return [ERR_NO_CANDIDATE, undefined];
        }
        return [null, { endpoint }];
      }
      const members = memberList(info.members, endpoints);
      const narrowed = members === endpoints ? undefined : new Set(endpoints);
      let scale = 0;
      for (const endpoint of members)
        scale = Math.max(scale, weights.get(endpoint) ?? 1);
      // Powers of two preserve the ordinary smooth-RR sequence without rounding its weights.
      scale = 2 ** Math.min(1023, Math.floor(Math.log2(scale)));
      const next = new Map<string, number>();
      let best: string | undefined;
      let bestValue = Number.NEGATIVE_INFINITY;
      let total = 0;
      for (const endpoint of members) {
        const carried = (current.get(endpoint) ?? 0) * (previousScale / scale);
        const kept = Number.isFinite(carried) ? carried : 0;
        if (narrowed !== undefined && !narrowed.has(endpoint)) {
          next.set(endpoint, kept);
          continue;
        }
        const weight = (weights.get(endpoint) ?? 1) / scale;
        const value = kept + weight;
        next.set(endpoint, value);
        total += weight;
        if (value > bestValue) {
          best = endpoint;
          bestValue = value;
        }
      }
      current = next;
      previousScale = scale;
      if (best === undefined) return [ERR_NO_CANDIDATE, undefined];
      current.set(best, bestValue - total);
      return [null, { endpoint: best }];
    },
  };
  if (invalid !== undefined) return child;
  return withHealthFilter(child, options?.outlierDetection);
}

function invalidRoundRobin(options: unknown): Error | undefined {
  if (options === undefined) {
    return undefined;
  }
  if (!isOptionRecord(options)) {
    return balancerOptionError(
      new TypeError("roundRobinBalancer options must be an object"),
    );
  }
  return undefined;
}

/** Copies `weights` from validated options into a Map of this realm, or returns the option error. */
function copyWeights(
  options: unknown,
): Map<string, number> | Error | undefined {
  if (!isOptionRecord(options)) return undefined;
  const copy = new Map<string, number>();
  try {
    const weights = options["weights"];
    if (weights === undefined) return undefined;
    if (!isIterableObject(weights)) {
      return balancerOptionError(
        new TypeError(
          "roundRobinBalancer weights must be a ReadonlyMap or an iterable of [key, value] entries",
        ),
      );
    }
    for (const [key, value] of weights) {
      if (typeof key !== "string") {
        return balancerOptionError(
          new TypeError("roundRobinBalancer weight keys must be strings"),
        );
      }
      if (typeof value !== "number") {
        return balancerOptionError(
          new TypeError("roundRobinBalancer weights must be numbers"),
        );
      }
      if (!Number.isFinite(value) || value <= 0) {
        return balancerOptionError(
          new RangeError(
            "roundRobinBalancer weights must be finite and greater than 0",
          ),
        );
      }
      copy.set(key, value);
    }
  } catch (thrown) {
    return balancerOptionError(
      new TypeError("roundRobinBalancer weights could not be read", {
        cause: thrown,
      }),
    );
  }
  return copy;
}

/**
 * Whether `value` can be read by iteration; `instanceof Map` rejects other
 * realms and custom implementations. Entries are checked while they are read.
 */
function isIterableObject(
  value: unknown,
): value is Iterable<readonly [unknown, unknown]> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function"
  );
}
