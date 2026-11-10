import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import { createClientConfig, type RetryOptions } from "../client/config";
import { retryBudgetFor } from "../balancer/retry_budget";
import {
  withEndpoint,
  withHTTPHandle,
  withBalancer,
  withRetry,
} from "../client/option";
import { defineRequest } from "./http";
import { pickFirstBalancer, type Balancer } from "../balancer/balancer";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const op = defineRequest({ method: "GET", path: "/" });
function fixture(retryBudget: RetryOptions["budget"], maxRetries = 1) {
  let calls = 0;
  const client = createClient(
    withEndpoint("https://a.test", "https://b.test", "https://c.test"),
    withRetry({ budget: retryBudget, maxRetries, delayMs: 0 }),
    withHTTPHandle(() => {
      calls++;
      return Promise.reject(new TypeError("refused"));
    }),
  );
  return { client, calls: () => calls };
}
test("shared budget limits a broad outage and restores its reserve after TTL", async () => {
  const h = fixture({
    percentCanRetry: 0,
    minRetriesPerSecond: 1,
    ttlMs: 1000,
  });
  for (let i = 0; i < 20; i++)
    expect((await op(h.client))[0]?.code).toBe("NET_UNREACHABLE");
  expect(h.calls()).toBe(21);
  vi.advanceTimersByTime(1000 - performance.now());
  await op(h.client);
  expect(h.calls()).toBe(23);
});
test("each original call deposits, every retry withdraws, and debits expire too", async () => {
  const h = fixture(
    { percentCanRetry: 0.5, minRetriesPerSecond: 0, ttlMs: 1000 },
    2,
  );
  await op(h.client);
  expect(h.calls()).toBe(1);
  await op(h.client);
  expect(h.calls()).toBe(3);
  vi.advanceTimersByTime(1000 - performance.now());
  await op(h.client);
  expect(h.calls()).toBe(4);
});
test("separate clients have independent budgets; derived clients share their configuration", async () => {
  const options = { percentCanRetry: 0, minRetriesPerSecond: 1, ttlMs: 1000 };
  const a = fixture(options);
  const b = fixture(options);
  await op(a.client());
  await op(a.client);
  await op(b.client);
  expect(a.calls()).toBe(3);
  expect(b.calls()).toBe(2);
});
test("false disables budget, and defaults limit retries to the Finagle reserve plus twenty percent", async () => {
  const unlimited = fixture(false);
  for (let i = 0; i < 150; i++) await op(unlimited.client);
  expect(unlimited.calls()).toBe(300);
  const defaults = fixture(undefined);
  for (let i = 0; i < 150; i++) await op(defaults.client);
  expect(defaults.calls()).toBe(280);
});
test("retry configuration is captured field by field", async () => {
  const options = { percentCanRetry: 0, minRetriesPerSecond: 1, ttlMs: 1000 };
  const h = fixture(options);
  options.minRetriesPerSecond = 999;
  await op(h.client);
  await op(h.client);
  expect(h.calls()).toBe(3);
});
test("tiny positive retry ratios saturate Finagle's integer retry cost instead of granting infinite credit", async () => {
  const h = fixture({
    percentCanRetry: Number.MIN_VALUE,
    minRetriesPerSecond: 0,
    ttlMs: 1000,
  });
  for (let i = 0; i < 10; i++) await op(h.client);
  expect(h.calls()).toBe(10);
});

test("fractional-second TTL reserves only Finagle whole seconds without deposits", () => {
  const config = createClientConfig();
  config.retry = {
    budget: { ttlMs: 1500, minRetriesPerSecond: 10, percentCanRetry: 0.2 },
  };
  const budget = retryBudgetFor(config);
  for (let i = 0; i < 10; i++) expect(budget.tryWithdraw()).toBe(true);
  expect(budget.tryWithdraw()).toBe(false);
});

test("two clients sharing one balancer keep independent retry reserves", async () => {
  const balancer = pickFirstBalancer();
  let calls = 0;
  function clientFor(shared: Balancer) {
    return createClient(
      withEndpoint("https://a.test", "https://b.test"),
      withBalancer(shared),
      withRetry({
        delayMs: 0,
        budget: { percentCanRetry: 0, minRetriesPerSecond: 1, ttlMs: 1000 },
      }),
      withHTTPHandle(() => {
        calls++;
        return Promise.reject(new TypeError("refused"));
      }),
    );
  }
  const a = clientFor(balancer);
  const b = clientFor(balancer);
  expect((await op(a))[0]?.code).toBe("NET_UNREACHABLE");
  expect(calls).toBe(2);
  expect((await op(b))[0]?.code).toBe("NET_UNREACHABLE");
  expect(calls).toBe(4);
});

test("TTL slices expire staggered credits gradually rather than all at once", () => {
  const config = createClientConfig();
  config.retry = {
    budget: { percentCanRetry: 0.5, minRetriesPerSecond: 0, ttlMs: 1000 },
  };
  const budget = retryBudgetFor(config);
  budget.deposit();
  budget.deposit();
  vi.advanceTimersByTime(500 - performance.now());
  budget.deposit();
  budget.deposit();
  vi.advanceTimersByTime(1000 - performance.now());
  expect(budget.tryWithdraw()).toBe(true);
  expect(budget.tryWithdraw()).toBe(false);
  vi.advanceTimersByTime(1500 - performance.now());
  expect(budget.tryWithdraw()).toBe(false);
});

test.each([86_400_000, -3_600_000])(
  "wall clock jump %i does not expire or strand retry debits",
  (jump) => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(0);
    const config = createClientConfig();
    config.retry = {
      budget: { percentCanRetry: 0, minRetriesPerSecond: 1, ttlMs: 1000 },
    };
    const budget = retryBudgetFor(config);
    expect(budget.tryWithdraw()).toBe(true);
    vi.setSystemTime(jump);
    expect(budget.tryWithdraw()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(budget.tryWithdraw()).toBe(true);
  },
);
