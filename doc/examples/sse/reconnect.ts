// #region example
import { createClient, withEndpoint, withRetry } from "@defjs/core";

const client = createClient(
  withEndpoint("https://api.example.com"),
  withRetry({
    maxRetries: 3,
    attemptTimeoutMs: 5_000,
    delayMs: 1_000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.5,
    shouldRetry(context) {
      // A POST stream is not retried by default. Retry it only when the server can resume it from Last-Event-ID.
      return (
        context.retryable ||
        (context.transport === "sse" &&
          context.method === "POST" &&
          context.lastEventId !== "")
      );
    },
  }),
);
// #endregion
