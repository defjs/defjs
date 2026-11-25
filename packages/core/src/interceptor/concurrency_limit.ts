import type { HttpRequest } from "../http/http_request";
import { resolveAbortedCause } from "../internal/abort";
import type { HttpInterceptor } from "./interceptor";
import { createHttpInterceptor } from "./interceptor";

/**
 * Options for {@link concurrencyLimitHttpInterceptor}.
 *
 * `maxConcurrency` caps the number of in-flight HTTP attempts allowed at once
 * per bucket. Requests beyond that limit wait in FIFO order up to `maxQueue`
 * (which defaults to `Infinity`), or fail immediately with
 * `EXT_INTERCEPTOR_FAILED` carrying a {@link BulkheadOverflowError} as `cause`
 * when the queue is full.
 *
 * `key` partitions limits across independent buckets (for example per selected
 * origin via `req.baseEndpoint ?? ""`, or by `req.method`). By default all
 * requests share one bucket (`""`).
 *
 * @group interceptors
 */
export interface ConcurrencyLimitInterceptorOptions {
  /** Maximum number of concurrent in-flight HTTP attempts per bucket; must be a positive integer (`>= 1`). */
  readonly maxConcurrency: number;
  /** Maximum number of waiters allowed in the FIFO queue per bucket (`0` rejects immediately when busy); defaults to `Infinity`. */
  readonly maxQueue?: number;
  /** Partitions concurrency and queue budgets into named buckets; defaults to one shared bucket (`""`). */
  readonly key?: (req: HttpRequest) => string;
}

/**
 * Cause attached to `EXT_INTERCEPTOR_FAILED` when {@link concurrencyLimitHttpInterceptor}
 * rejects a request because its queue is full (`maxQueue` reached).
 *
 * `name` is `'BulkheadOverflowError'`. The error carries the saturated bucket
 * `key`, `maxConcurrency`, and `maxQueue` for diagnostics and logging.
 *
 * @group interceptors
 */
export class BulkheadOverflowError extends Error {
  /** Bucket key that overflowed (`""` when no custom `key` selector was configured). */
  readonly key: string;
  /** Configured maximum in-flight concurrency for the bucket. */
  readonly maxConcurrency: number;
  /** Configured maximum queue length for the bucket. */
  readonly maxQueue: number;

  /**
   * Creates a queue overflow error for a saturated concurrency bucket.
   *
   * @param key - Bucket key that reached capacity.
   * @param maxConcurrency - Configured concurrent execution limit.
   * @param maxQueue - Configured waiting queue limit.
   */
  constructor(key: string, maxConcurrency: number, maxQueue: number) {
    super(
      key
        ? `Concurrency limit reached for "${key}" (maxConcurrency: ${maxConcurrency}, maxQueue: ${maxQueue})`
        : `Concurrency limit reached (maxConcurrency: ${maxConcurrency}, maxQueue: ${maxQueue})`,
    );
    this.name = "BulkheadOverflowError";
    this.key = key;
    this.maxConcurrency = maxConcurrency;
    this.maxQueue = maxQueue;
  }
}

interface Waiter {
  grant(): void;
}

interface Bucket {
  active: number;
  readonly queue: Waiter[];
}

/**
 * HTTP interceptor that caps concurrent in-flight HTTP attempts per bucket.
 *
 * When `maxConcurrency` requests are already active in a bucket, further
 * requests wait in FIFO order until a slot frees or `req.signal` aborts. While
 * waiting in the queue, transport `attemptTimeoutMs` and balancer pending-load
 * tracking have not started yet, and permits are released during `withRetry`
 * backoff waits so retries cannot deadlock the bulkhead.
 *
 * - Pre-aborted or mid-queue aborted requests do not consume a permit and fail
 *   with `NET_ABORTED` or `NET_TIMEOUT`.
 * - Requests that exceed `maxQueue` reject with {@link BulkheadOverflowError},
 *   which Defjs reports as `EXT_INTERCEPTOR_FAILED` (`attempt.info` stays
 *   `{ attempted: false }`, so balancers do not eject endpoints and retries stop).
 * - `maxConcurrency` must be an integer `>= 1` and `maxQueue` an integer `>= 0`
 *   or `Infinity`; invalid values throw `RangeError` synchronously.
 *
 * @param options - Concurrency cap, optional queue limit, and optional bucket key selector.
 * @returns An `HttpInterceptor` enforcing the bulkhead limit.
 * @group interceptors
 */
export function concurrencyLimitHttpInterceptor(
  options: ConcurrencyLimitInterceptorOptions,
): HttpInterceptor {
  const { maxConcurrency, maxQueue = Infinity, key } = options;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError("maxConcurrency must be a positive integer");
  }
  if (maxQueue !== Infinity && (!Number.isInteger(maxQueue) || maxQueue < 0)) {
    throw new RangeError("maxQueue must be a non-negative integer or Infinity");
  }

  const buckets = new Map<string, Bucket>();

  const release = (bucketKey: string, bucket: Bucket): void => {
    const nextWaiter = bucket.queue.shift();
    if (nextWaiter !== undefined) {
      nextWaiter.grant();
      return;
    }
    bucket.active -= 1;
    if (bucket.active === 0) {
      buckets.delete(bucketKey);
    }
  };

  return createHttpInterceptor(async (req, next) => {
    if (req.signal?.aborted) {
      throw resolveAbortedCause(req.signal);
    }

    const bucketKey = key ? key(req) : "";
    let bucket = buckets.get(bucketKey);
    if (bucket === undefined) {
      bucket = { active: 0, queue: [] };
      buckets.set(bucketKey, bucket);
    }

    if (bucket.active < maxConcurrency) {
      bucket.active += 1;
    } else {
      if (bucket.queue.length >= maxQueue) {
        throw new BulkheadOverflowError(bucketKey, maxConcurrency, maxQueue);
      }

      const signal = req.signal;
      if (signal === undefined) {
        await new Promise<void>((resolve) => {
          bucket.queue.push({ grant: resolve });
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            bucket.queue.splice(bucket.queue.indexOf(waiter), 1);
            reject(resolveAbortedCause(signal));
          };
          const waiter: Waiter = {
            grant() {
              signal.removeEventListener("abort", onAbort);
              resolve();
            },
          };
          bucket.queue.push(waiter);
          signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }

    try {
      return await next(req);
    } finally {
      release(bucketKey, bucket);
    }
  });
}
