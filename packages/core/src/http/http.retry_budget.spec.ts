import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import { createClientConfig } from "../client/config";
import { retryBudgetFor } from "../balancer/retry_budget";
import {
  withEndpoint,
  withEndpointFailover,
  withHTTPHandle,
  withEndpointBalancer,
} from "../client/option";
import { defineRequest } from "./http";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const op = defineRequest({ method: "GET", path: "/" });
function fixture(retryBudget: unknown, attempts = 1) {
  let calls = 0;
  const client = createClient(
    withEndpoint("https://a.test", "https://b.test", "https://c.test"),
    withEndpointBalancer({
      pick: (info) => [null, { endpoint: info.endpoints[0] ?? "" }],
    }),
    withEndpointFailover(
      // @ts-expect-error invalid retry budget is rejected at execution
      { retryBudget, attempts },
    ),
    // eslint-disable-next-line @typescript-eslint/require-await -- INTENT: the callback under test must reject asynchronously
    withHTTPHandle(async () => {
      calls++;
      throw new TypeError("refused");
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
  vi.setSystemTime(1000);
  await op(h.client);
  expect(h.calls()).toBe(23);
});
test("each original call deposits, every failover withdraws, and debits expire too", async () => {
  const h = fixture(
    { percentCanRetry: 0.5, minRetriesPerSecond: 0, ttlMs: 1000 },
    2,
  );
  await op(h.client);
  expect(h.calls()).toBe(1);
  await op(h.client);
  expect(h.calls()).toBe(3);
  vi.setSystemTime(1000);
  await op(h.client);
  expect(h.calls()).toBe(4);
});
test("budgets are per-client, whereas a derived client shares the same reserve", async () => {
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
test.each([
  null,
  true,
  [],
  1,
  { percentCanRetry: null },
  { minRetriesPerSecond: null },
  { ttlMs: null },
  { percentCanRetry: -1 },
  { percentCanRetry: 1001 },
  { percentCanRetry: Infinity },
  { percentCanRetry: NaN },
  { percentCanRetry: "0.2" },
  { minRetriesPerSecond: -1 },
  { minRetriesPerSecond: 0.5 },
  { minRetriesPerSecond: Infinity },
  { minRetriesPerSecond: "1" },
  { ttlMs: 999 },
  { ttlMs: 60001 },
  { ttlMs: NaN },
  { ttlMs: Infinity },
  { ttlMs: "1000" },
])("invalid retry budget %j fails before transport", async (options) => {
  const h = fixture(options);
  expect((await op(h.client))[0]?.code).toBe("REQ_OPTIONS_INVALID");
  expect(h.calls()).toBe(0);
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
  withEndpointFailover({
    retryBudget: { ttlMs: 1500, minRetriesPerSecond: 10, percentCanRetry: 0.2 },
  })(config);
  const budget = retryBudgetFor(config);
  if (budget instanceof Error) throw budget;
  for (let i = 0; i < 10; i++) expect(budget.tryWithdraw()).toBe(true);
  expect(budget.tryWithdraw()).toBe(false);
});
