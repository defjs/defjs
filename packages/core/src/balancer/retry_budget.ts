import { monotonicNow } from "../internal/clock";
import type { ClientConfig } from "../client/config";
import { isBalancerOptionRecord } from "./outlier_detection";

interface RetryBudget {
  deposit(): void;
  tryWithdraw(): boolean;
}
const budgets = new WeakMap<ClientConfig, RetryBudget | Error>();

/** A client-owned Finagle token budget. Both credits and debits expire lazily. */
export function retryBudgetFor(config: ClientConfig): RetryBudget | Error {
  const existing = budgets.get(config);
  if (existing !== undefined) return existing;
  const budget = createBudget(config.http.retry?.budget);
  budgets.set(config, budget);
  return budget;
}
function createBudget(option: unknown): RetryBudget | Error {
  if (option === false) return { deposit() {}, tryWithdraw: () => true };
  if (option !== undefined && !isBalancerOptionRecord(option))
    return new TypeError("retryBudget must be an object or false");
  const {
    percentCanRetry: percent = 0.2,
    minRetriesPerSecond: minimum = 10,
    ttlMs: ttl = 10000,
  } = option ?? {};
  if (
    typeof percent !== "number" ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 1000 ||
    typeof minimum !== "number" ||
    !Number.isSafeInteger(minimum) ||
    minimum < 0 ||
    typeof ttl !== "number" ||
    !Number.isFinite(ttl) ||
    ttl < 1000 ||
    ttl > 60000
  )
    return new RangeError("Invalid retryBudget options");
  const deposit = percent === 0 ? 0 : 1000;
  const withdrawal =
    percent === 0 ? 1 : Math.min(0x7fffffff, Math.floor(1000 / percent));
  const reserve = minimum * Math.floor(ttl / 1000) * withdrawal;
  const sliceMs = ttl / 10;
  const slices = new Map<number, number>();
  function update(amount: number, withdraw: boolean): boolean {
    const slice = Math.floor(monotonicNow() / sliceMs);
    let balance = reserve;
    for (const [at, value] of slices) {
      if (at <= slice - 10) slices.delete(at);
      else balance += value;
    }
    if (withdraw && balance < withdrawal) return false;
    slices.set(slice, (slices.get(slice) ?? 0) + amount);
    return true;
  }
  return {
    deposit() {
      update(deposit, false);
    },
    tryWithdraw: () => update(-withdrawal, true),
  };
}
