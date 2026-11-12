// #region example
import {
  createHttpInterceptor,
  type HttpRequest,
  type HttpResponse,
} from "@defjs/core";

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

async function waitForRetryAfter(
  response: HttpResponse<unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const delay = retryAfterMs(response);
  signal?.throwIfAborted();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay);
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };

    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
  // An abort during the wait ends it early and rejects with the signal's reason.
  signal?.throwIfAborted();
}

const honorRetryAfter = createHttpInterceptor(async (request, next) => {
  if (!isReplayable(request)) return next(request);

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request);
    if (response.status !== 429 || attempt >= 2) return response;
    await waitForRetryAfter(response, request.signal);
  }
});
// #endregion
