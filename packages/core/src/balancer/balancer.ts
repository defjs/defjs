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
 * every later `pick`.
 *
 * @group client
 */
export interface EndpointBalancer {
  /**
   * Selects an endpoint synchronously, or returns an error when none can be selected.
   * Must be synchronous: a returned promise is not awaited and its rejection is ignored.
   * A promise is an invalid pick outcome and becomes `REQ_BUILD_FAILED`.
   */
  pick(info: EndpointPickInfo): EndpointPickOutcome;
}

/**
 * Error-first result of {@link EndpointBalancer.pick}.
 *
 * `[Error, undefined]` selects nothing. `[null, result]` is the selected
 * endpoint. The error comes first, matching operation results.
 *
 * @group client
 */
export type EndpointPickOutcome =
  | readonly [err: Error, result: undefined]
  | readonly [err: null, result: EndpointPickResult];

/**
 * Transport that is about to use the selected endpoint.
 *
 * @group client
 */
export type EndpointTransport = "http" | "sse" | "websocket";

/**
 * What the runtime tells `pick` about this call.
 *
 * `endpoints` is the candidate list in first-seen order. It may be empty and
 * must not be modified. An empty list returns `[ERR_NO_ENDPOINT, undefined]`.
 *
 * @group client
 */
export interface EndpointPickInfo {
  /** Candidate endpoints. Already deduplicated by first occurrence. Do not modify. */
  readonly endpoints: readonly string[];
  /** Transport that will use the selected endpoint. */
  readonly transport: EndpointTransport;
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
 * @group client
 */
export interface EndpointPickResult {
  /** Selected endpoint string. It is not validated as a URL here. */
  readonly endpoint: string;
  /**
   * Called synchronously at most once immediately before Fetch or socket construction.
   * Not called for build failures, interceptor short-circuits, or pre-transport cancellation.
   * A throw or returned thenable is contained exactly like `done`.
   */
  readonly start?: () => void;
  /**
   * Called synchronously at most once after start, when Fetch returns headers or a socket opens,
   * or when transport fails before that response. Caller cancellation is unattributed.
   * A throw or returned thenable is contained exactly like `done`.
   */
  readonly end?: (info: EndpointDoneInfo) => void;
  /**
   * Called once with the attempt outcome. Omit when the balancer keeps no per-pick state.
   * Must be synchronous: a returned promise is not awaited and its rejection is ignored.
   * A throw does not replace the operation tuple.
   */
  readonly done?: (info: EndpointDoneInfo) => void;
}

/**
 * Transport failure codes a balancer can observe through `end` and `done`.
 *
 * `end` reports headers or socket open; later transport failures can still give
 * `done` a `code`. HTTP incomplete bodies keep their status with `NET_BODY_INCOMPLETE`.
 * An SSE response-body read rejection or an opened WebSocket's close code 1006
 * or strictly false `wasClean` reports `NET_UNREACHABLE`, without a status, unless
 * timeout or cancellation takes priority. Normal EOF, clean closes, and application
 * errors do not themselves create network failure samples.
 * `pickFirstBalancer` moves to the next endpoint for `NET_UNREACHABLE` or an
 * uncoded 502, 503, or 504 response.
 *
 * @group client
 */
export type EndpointFaultCode =
  "NET_UNREACHABLE" | "NET_TIMEOUT" | "NET_BODY_INCOMPLETE";

/**
 * Outcome of the attempt that used the selected endpoint.
 *
 * `attempted: false` means no attempt is attributed to that endpoint: nothing
 * was sent, or the attempt ended by caller cancellation or `close()`. Both
 * `code` and `status` are then absent. `attempted: true` with no `code` means the peer
 * answered.
 *
 * @group client
 */
export interface EndpointDoneInfo {
  /** Whether a transport attempt reached the selected endpoint. */
  readonly attempted: boolean;
  /** Transport failure, including a body-read or socket-close failure after a response. */
  readonly code?: EndpointFaultCode;
  /** HTTP/SSE status. Kept with NET_BODY_INCOMPLETE; absent for network/timeout codes and WebSocket open. */
  readonly status?: number;
}

const NO_ENDPOINT_BRAND = Symbol.for("defjs.cause.no-endpoint");

/**
 * Sentinel for an empty candidate list.
 *
 * Built-in balancers return it as `[ERR_NO_ENDPOINT, undefined]`. The runtime
 * reports that as `REQ_BUILD_FAILED` and keeps this error as `cause`. It is not
 * a `FaultCode`. The non-enumerable `Symbol.for("defjs.cause.no-endpoint")`
 * brand lets {@link isNoEndpointCause} recognize the sentinel from another
 * Core copy.
 *
 * @group client
 * @see {@link isNoEndpointCause}
 */
export const ERR_NO_ENDPOINT: Error = brandSentinel(
  new Error("No endpoint available"),
);

/**
 * Whether `cause` is {@link ERR_NO_ENDPOINT}, including a copy from another Core build.
 *
 * Returns `true` when `cause` carries the non-enumerable
 * `Symbol.for("defjs.cause.no-endpoint")` brand. Other values return `false`.
 * Pass `fault.cause`; this does not unwrap faults.
 *
 * @group client
 * @see {@link ERR_NO_ENDPOINT}
 */
export function isNoEndpointCause(cause: unknown): boolean {
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

interface PickFirstOptions {
  readonly outlierDetection?: OutlierDetectionOptions | false;
  readonly shuffle?: boolean;
  readonly failbackMs?: number;
}

/**
 * Sticky failover balancer. The default when a client sets no balancer.
 *
 * Uses the first candidate until `done` reports
 * `{ attempted: true, code: "NET_UNREACHABLE" }` for the endpoint that is still
 * sticky, or an uncoded 502, 503, or 504 response. The next `pick` then moves
 * to the following candidate and wraps to the first. Other results, including timeouts and
 * `attempted: false`, keep the current endpoint. Overlapping failures advance
 * one step: a `done` that finds the sticky endpoint already changed does nothing.
 *
 * `shuffle: true` assigns each endpoint a random sort key on first sight and
 * sticks to that order. Keys survive a shorter candidate list. The default is
 * `false`.
 *
 * `failbackMs`, when finite and positive, permits one concurrent probe of the
 * first candidate after that interval away from it. A successful probe restores
 * the first; an advance outcome restarts the interval. Unattributed probes only
 * release the probe slot. No background timer is created.
 *
 * Every successful `pick` returns `done`. An empty candidate list returns
 * `[ERR_NO_ENDPOINT, undefined]`. Invalid options are remembered here and
 * returned from every `pick` without throwing.
 *
 * Health filtering is off by default. Supply `outlierDetection: {}` to enable
 * default ejection, or configure its thresholds and application health callback.
 *
 * @param options - Optional shuffled order, failback interval, and health filtering.
 * @returns A new balancer. Each call has its own sticky endpoint.
 * @group client
 */
export function pickFirstBalancer(
  options?: PickFirstOptions,
): EndpointBalancer {
  const invalid = invalidPickFirst(options);
  const shuffle = options?.shuffle === true;
  const keys = new Map<string, number>();
  let sticky: string | undefined;
  let leftFirstAt: number | undefined;
  let probing = false;
  const failbackMs = options?.failbackMs;

  const child: EndpointBalancer = {
    pick(info) {
      if (invalid !== undefined) {
        return [invalid, undefined];
      }
      const order = candidateOrder(info.endpoints, shuffle, keys);
      const first = order[0];
      if (first === undefined) {
        return [ERR_NO_ENDPOINT, undefined];
      }
      let chosen = sticky;
      if (chosen === undefined || !order.includes(chosen)) {
        chosen = first;
        sticky = first;
      }
      const probe =
        chosen !== first &&
        failbackMs !== undefined &&
        leftFirstAt !== undefined &&
        Date.now() - leftFirstAt >= failbackMs &&
        !probing;
      if (probe) {
        chosen = first;
        probing = true;
      }
      return [
        null,
        {
          endpoint: chosen,
          done(report) {
            const advance =
              report.attempted === true &&
              (report.code === "NET_UNREACHABLE" ||
                (report.code === undefined &&
                  (report.status === 502 ||
                    report.status === 503 ||
                    report.status === 504)));
            if (probe) {
              probing = false;
              if (!report.attempted) return;
              if (advance) leftFirstAt = Date.now();
              else {
                sticky = first;
                leftFirstAt = undefined;
              }
              return;
            }
            if (!advance || sticky !== chosen) return;
            const next = order[(order.indexOf(chosen) + 1) % order.length];
            if (next !== undefined) {
              if (chosen === first && next !== first) leftFirstAt = Date.now();
              sticky = next;
            }
          },
        },
      ];
    },
  };
  if (invalid !== undefined) return child;
  return withHealthFilter(child, options?.outlierDetection, false);
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
      keys.set(endpoint, key);
    }
    ranked.push({ endpoint, index, key });
  }
  ranked.sort(
    (left, right) => left.key - right.key || left.index - right.index,
  );
  return ranked.map((item) => item.endpoint);
}

interface RoundRobinOptions {
  readonly outlierDetection?: OutlierDetectionOptions | false;
  readonly weights?: ReadonlyMap<string, number>;
}

/**
 * Round-robin balancer, with nginx smooth weighting when `weights` is set.
 *
 * Without `weights`, a counter starts at a random `uint32` and each `pick`
 * returns `endpoints[counter % length]`, then increments the counter modulo
 * 2^32. With `weights`, each pick adds an endpoint's weight to its current
 * value, selects the highest value (earlier candidate on a tie), and subtracts
 * the total weight of this candidate list. A missing weight is 1. Weights for
 * endpoints not in the list are ignored. Current values for endpoints that
 * left the list are dropped.
 *
 * Health filtering is enabled by default: five consecutive attributed failures
 * eject an endpoint temporarily. Set `outlierDetection: false` to disable it;
 * only those unfiltered successful picks omit `done`. An empty
 * candidate list returns `[ERR_NO_ENDPOINT, undefined]`. Invalid options are
 * remembered here and returned from every `pick` without throwing.
 *
 * @param options - Optional positive finite weights and health filtering configuration.
 * @returns A new balancer. Each call has its own counter and weight state.
 * @group client
 */
export function roundRobinBalancer(
  options?: RoundRobinOptions,
): EndpointBalancer {
  const invalid = invalidRoundRobin(options);
  const weights =
    invalid === undefined && options?.weights !== undefined
      ? new Map(options.weights)
      : undefined;
  let counter =
    invalid === undefined && weights === undefined
      ? Math.floor(Math.random() * 0x100000000) >>> 0
      : 0;
  const current = new Map<string, number>();

  const child: EndpointBalancer = {
    pick(info) {
      if (invalid !== undefined) {
        return [invalid, undefined];
      }
      const endpoints = info.endpoints;
      if (endpoints.length === 0) {
        return [ERR_NO_ENDPOINT, undefined];
      }
      if (weights === undefined) {
        const endpoint = endpoints[counter % endpoints.length];
        counter = (counter + 1) >>> 0;
        if (endpoint === undefined) {
          return [ERR_NO_ENDPOINT, undefined];
        }
        return [null, { endpoint }];
      }
      for (const key of current.keys()) {
        if (!endpoints.includes(key)) {
          current.delete(key);
        }
      }
      let best = "";
      let bestValue = Number.NEGATIVE_INFINITY;
      let total = 0;
      for (const endpoint of endpoints) {
        const weight = weights.get(endpoint) ?? 1;
        const value = (current.get(endpoint) ?? 0) + weight;
        current.set(endpoint, value);
        total += weight;
        if (value > bestValue) {
          best = endpoint;
          bestValue = value;
        }
      }
      current.set(best, bestValue - total);
      return [null, { endpoint: best }];
    },
  };
  if (invalid !== undefined) return child;
  return withHealthFilter(child, options?.outlierDetection, true);
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
  const weights = options["weights"];
  if (weights === undefined) {
    return undefined;
  }
  if (!(weights instanceof Map)) {
    return balancerOptionError(
      new TypeError("roundRobinBalancer weights must be a Map"),
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
  }
  return undefined;
}
