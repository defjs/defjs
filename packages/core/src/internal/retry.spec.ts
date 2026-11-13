import { expect, test, vi } from "vitest";
import type { RetryContext } from "../client/config";
import { resolveAbortedFault } from "./abort";
import { isRetryMethod, resolveRetryPolicy, retryStep } from "./retry";

const context = (retryable: boolean): RetryContext => ({
  transport: "websocket",
  attempt: 1,
  cause: undefined,
  retryable,
});

test("no options means no policy", () => {
  expect(resolveRetryPolicy(undefined)).toBeUndefined();
});

test("an empty object enables every default", () => {
  expect(resolveRetryPolicy({})).toEqual({
    maxRetries: 3,
    delayMs: 1000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.2,
    attemptTimeoutMs: undefined,
    methods: ["GET", "HEAD", "OPTIONS", "TRACE", "PUT", "DELETE"],
    shouldRetry: undefined,
  });
});

test("given fields replace their defaults and methods compare case-insensitively", () => {
  const shouldRetry = () => true;
  const policy = resolveRetryPolicy({
    maxRetries: 0,
    delayMs: 5,
    factor: 1,
    maxDelayMs: Infinity,
    jitter: 0,
    attemptTimeoutMs: 100,
    methods: ["post"],
    shouldRetry,
  });
  expect(policy).toEqual({
    maxRetries: 0,
    delayMs: 5,
    factor: 1,
    maxDelayMs: Infinity,
    jitter: 0,
    attemptTimeoutMs: 100,
    methods: ["POST"],
    shouldRetry,
  });
  expect(policy && isRetryMethod(policy, "Post")).toBe(true);
  expect(policy && isRetryMethod(policy, "GET")).toBe(false);
});

test("retryStep uses the default verdict without a policy function and asks for retry n + 1", async () => {
  const policy = resolveRetryPolicy({ maxRetries: 2 });
  if (!policy) throw new Error("expected a policy");
  const describe = vi.fn((attempt: number) => ({
    ...context(attempt === 1),
    attempt,
  }));
  const signal = new AbortController().signal;
  expect(await retryStep(policy, 0, signal, describe)).toBe("retry");
  expect(await retryStep(policy, 1, signal, describe)).toBe("stop");
  expect(describe.mock.calls).toEqual([[1], [2]]);
});

test("retryStep builds nothing and calls nothing once the retries are used", async () => {
  const shouldRetry = vi.fn(() => true);
  const policy = resolveRetryPolicy({ maxRetries: 1, shouldRetry });
  if (!policy) throw new Error("expected a policy");
  const describe = vi.fn(() => context(true));
  expect(
    await retryStep(policy, 1, new AbortController().signal, describe),
  ).toBe("stop");
  expect(describe).not.toHaveBeenCalled();
  expect(shouldRetry).not.toHaveBeenCalled();
});

test("retryStep hands the context to the policy function and returns its answer", async () => {
  const shouldRetry = vi.fn((_context: RetryContext) => Promise.resolve(false));
  const policy = resolveRetryPolicy({ shouldRetry });
  if (!policy) throw new Error("expected a policy");
  const described = context(true);
  expect(
    await retryStep(policy, 0, new AbortController().signal, () => described),
  ).toBe("stop");
  expect(shouldRetry).toHaveBeenCalledWith(described);
});

test("retryStep ends with the abort fault when the signal aborts during the policy function", async () => {
  const policy = resolveRetryPolicy({
    shouldRetry: () => new Promise<boolean>(() => {}),
  });
  if (!policy) throw new Error("expected a policy");
  const controller = new AbortController();
  const pending = retryStep(policy, 0, controller.signal, () => context(true));
  controller.abort(new Error("stop"));
  expect(await pending).toEqual(resolveAbortedFault(controller.signal));
});
