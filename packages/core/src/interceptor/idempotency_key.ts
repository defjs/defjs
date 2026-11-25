import type { HttpRequest } from "../http/http_request";
import { generateCorrelationId } from "../internal/correlation_id";
import type { HttpInterceptor } from "./interceptor";
import { createHttpInterceptor } from "./interceptor";

const DEFAULT_METHODS: readonly string[] = ["POST", "PATCH"];
const MAX_GENERATED_CACHE_SIZE = 4096;

/**
 * Options for {@link idempotencyKeyHttpInterceptor}.
 *
 * Controls which header name is set, which HTTP methods receive the key, how
 * keys are generated, and whether caller-supplied headers are preserved.
 *
 * @group interceptors
 */
export interface IdempotencyKeyInterceptorOptions {
  /** Header name written on matching requests; defaults to `'Idempotency-Key'`. */
  readonly headerName?: string;
  /** HTTP methods that receive an idempotency key (case-insensitive); defaults to `['POST', 'PATCH']`. */
  readonly methods?: readonly string[];
  /** Custom key generator; by default reuses `req.correlationId` (or falls back to an RFC 4122 v4 UUID) so retries of one call keep the same key. */
  readonly generate?: (req: HttpRequest) => string;
  /** When `true` (default), leaves an existing `headerName` untouched without invoking `generate`. */
  readonly respectExisting?: boolean;
}

function createKeyResolver(
  generate: ((req: HttpRequest) => string) | undefined,
): (req: HttpRequest) => string {
  if (generate === undefined) {
    return (req) => req.correlationId ?? generateCorrelationId();
  }
  const cache = new Map<string, string>();
  return (req) => {
    const correlationId = req.correlationId;
    if (correlationId === undefined) {
      return generate(req);
    }
    const cached = cache.get(correlationId);
    if (cached !== undefined) {
      cache.delete(correlationId);
      cache.set(correlationId, cached);
      return cached;
    }
    const created = generate(req);
    if (cache.size >= MAX_GENERATED_CACHE_SIZE) {
      for (const oldest of cache.keys()) {
        cache.delete(oldest);
        break;
      }
    }
    cache.set(correlationId, created);
    return created;
  };
}

/**
 * HTTP interceptor that attaches an idempotency key header to mutating requests.
 *
 * For requests whose method matches `methods` (default `POST` and `PATCH`),
 * clones `req.headers` and sets `headerName` (default `'Idempotency-Key'`).
 * When `respectExisting` is `true` (default) and the request already carries
 * `headerName`, the request passes through unchanged.
 *
 * Without a custom `generate` callback, reuses `req.correlationId` so every
 * `withRetry` attempt of the same call sends the same idempotency key without
 * storing keys across calls. With a custom `generate` callback, memoizes
 * generated values by `req.correlationId` in a bounded LRU cache (4,096
 * entries) so custom generators are likewise called once per retry chain.
 *
 * @param options - Optional header name, target methods, generator, and overwrite flag.
 * @returns An `HttpInterceptor` that injects the idempotency key header.
 * @group interceptors
 */
export function idempotencyKeyHttpInterceptor(
  options?: IdempotencyKeyInterceptorOptions,
): HttpInterceptor {
  const headerName = options?.headerName ?? "Idempotency-Key";
  const methods = new Set(
    (options?.methods ?? DEFAULT_METHODS).map((method) => method.toUpperCase()),
  );
  const respectExisting = options?.respectExisting ?? true;
  const resolveKey = createKeyResolver(options?.generate);

  return createHttpInterceptor((req, next) => {
    if (!methods.has(req.method.toUpperCase())) {
      return next(req);
    }
    if (respectExisting && req.headers?.has(headerName)) {
      return next(req);
    }
    const headers = new Headers(req.headers);
    headers.set(headerName, resolveKey(req));
    return next({ ...req, headers });
  });
}
