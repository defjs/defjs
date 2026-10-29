// #region example
import {
  createHttpInterceptor,
  type HttpRequest,
  type HttpResponse,
} from "@defjs/core";

const retryableMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const retryableStatuses = new Set([429, 502, 503, 504]);

function isReplayable(request: HttpRequest): boolean {
  return (
    typeof ReadableStream === "undefined" ||
    !(request.body instanceof ReadableStream)
  );
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get("retry-after");
  if (!value) return 250;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1_000, 30_000);

  const date = Date.parse(value);
  return Number.isNaN(date)
    ? 250
    : Math.min(Math.max(0, date - Date.now()), 30_000);
}

function waitForRetryAfter(
  response: HttpResponse<unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const delay = retryAfterMs(response);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(done, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };

    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (
    !retryableMethods.has(request.method.toUpperCase()) ||
    !isReplayable(request)
  )
    return next(request);

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request);
    if (!retryableStatuses.has(response.status) || attempt >= 2)
      return response;
    await waitForRetryAfter(response, request.abort);
  }
});
// #endregion
