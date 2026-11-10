import { afterEach, expect, test, vi } from "vitest";

vi.mock("../balancer/retry_budget", { spy: true });

import { retryBudgetFor } from "../balancer/retry_budget";
import { createClient } from "../client/client";
import {
  withBalancer,
  withEndpoint,
  withHTTPHandle,
  withRetry,
} from "../client/option";
import type { ClientConfig, RetryOptions } from "../client/config";
import { defineRequest } from "./http";
import { ERR_TIMEOUT } from "../error";

const op = defineRequest({ method: "GET", path: "/" });
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(retryBudgetFor).mockRestore();
  vi.restoreAllMocks();
});
function fixture(options: RetryOptions, count = 8, signal?: AbortSignal) {
  const pick = vi.fn(
    (info: { endpoints: readonly string[] }) =>
      [null, { endpoint: info.endpoints[0] ?? "" }] as const,
  );
  const first = Promise.withResolvers<void>();
  const handle = vi.fn(() => {
    first.resolve();
    return Promise.reject(new TypeError("refused"));
  });
  const client = createClient(
    withEndpoint(
      ...Array.from({ length: count }, (_, i) => `https://a${i}.test`),
    ),
    withBalancer({ pick }),
    withRetry(options),
    withHTTPHandle(handle),
  );
  return {
    pick,
    handle,
    first: first.promise,
    pending: op(client({ signal })),
  };
}
function clock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}
async function waiting(handle: ReturnType<typeof vi.fn>, count: number) {
  await vi.waitFor(
    () => {
      expect(handle).toHaveBeenCalledTimes(count);
      expect(vi.getTimerCount()).toBe(1);
    },
    { interval: 1 },
  );
}

test("retry waits 1, 2, 4, 8, 16, 30 seconds, then 30 seconds, before successive attempts", async () => {
  clock();
  const h = fixture({ maxRetries: 7, jitter: 0, budget: false });
  await h.first;
  expect(h.handle).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  for (const [index, delay] of [
    1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
  ].entries()) {
    await vi.advanceTimersByTimeAsync(0);
    expect(h.handle).toHaveBeenCalledTimes(index + 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(h.handle).toHaveBeenCalledTimes(index + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.handle).toHaveBeenCalledTimes(index + 2);
  }
  expect((await h.pending)[0]?.code).toBe("NET_UNREACHABLE");
  expect(vi.getTimerCount()).toBe(0);
});

test.each([0, 1])(
  "default retry jitter at random %s stays within twenty percent",
  async (random) => {
    clock();
    vi.spyOn(Math, "random").mockReturnValue(random);
    const timer = vi.spyOn(globalThis, "setTimeout");
    const h = fixture({ maxRetries: 1 }, 2);
    await waiting(h.handle, 1);
    const delay = timer.mock.calls.find((call) => call[1] !== 1)?.[1];
    expect(delay).toBe(random === 0 ? 800 : 1200);
    await vi.advanceTimersByTimeAsync(1200);
    await h.pending;
  },
);

test.each([
  ["a zero delay", { delayMs: 0, maxRetries: 1 }, 2],
  ["no retries", { maxRetries: 0 }, 1],
  ["no allowed method", { methods: [] }, 1],
  ["a policy that declines", { shouldRetry: () => false }, 1],
  [
    "an empty budget",
    { budget: { percentCanRetry: 0, minRetriesPerSecond: 0 } },
    1,
  ],
] as const)(
  "retry creates no timer when no wait is needed: %s",
  async (_label, options, calls) => {
    clock();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const h = fixture(options, 2);
    await h.pending;
    expect(h.handle).toHaveBeenCalledTimes(calls);
    expect(timer).not.toHaveBeenCalled();
  },
);

test.each([undefined, ERR_TIMEOUT])(
  "caller cancellation while waiting returns its fault without another pick: %s",
  async (reason) => {
    clock();
    const controller = new AbortController();
    const h = fixture({ jitter: 0 }, 3, controller.signal);
    await waiting(h.handle, 1);
    controller.abort(reason);
    expect((await h.pending)[0]?.code).toBe(
      reason === ERR_TIMEOUT ? "NET_TIMEOUT" : "NET_ABORTED",
    );
    expect(h.pick).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test("retry withdraws its budget before entering backoff", async () => {
  clock();
  const budget = { deposit: vi.fn(), tryWithdraw: vi.fn(() => true) };
  const spy = vi.mocked(retryBudgetFor);
  spy.mockClear();
  spy.mockReturnValue(budget);
  const h = fixture({ jitter: 0, maxRetries: 1 }, 2);
  await waiting(h.handle, 1);
  expect(budget.deposit).toHaveBeenCalledTimes(1);
  expect(budget.tryWithdraw).toHaveBeenCalledTimes(1);
  expect(h.pick).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  await h.pending;
});

test.each([
  ["no arguments", () => withRetry()],
  ["undefined", () => withRetry(undefined)],
  ["an empty object", () => withRetry({})],
])(
  "withRetry with %s enables the default GET connection retry",
  async (_label, option) => {
    clock();
    const seen: string[] = [];
    const handle = vi.fn((input: RequestInfo | URL) => {
      const url = new Request(input).url;
      seen.push(url);
      if (url.startsWith("https://a.test"))
        return Promise.reject(new TypeError("refused"));
      return Promise.resolve(new Response("ok"));
    });
    const client = createClient(
      withEndpoint("https://a.test", "https://b.test"),
      option(),
      withHTTPHandle(handle),
    );
    const pending = op(client);
    await vi.waitFor(
      () => {
        expect(handle).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
      },
      { interval: 1 },
    );
    await vi.advanceTimersByTimeAsync(1200);
    expect((await pending)[0]).toBeNull();
    expect(seen).toEqual(["https://a.test/", "https://b.test/"]);
  },
);

test("withRetry maxRetries 0 replaces an enabled policy with one attempt", async () => {
  const handle = vi.fn(() => Promise.reject(new TypeError("refused")));
  const client = createClient(
    withEndpoint("https://a.test", "https://b.test"),
    withRetry(),
    withRetry({ maxRetries: 0 }),
    withHTTPHandle(handle),
  );
  expect((await op(client))[0]?.code).toBe("NET_UNREACHABLE");
  expect(handle).toHaveBeenCalledTimes(1);
});

test("retry snapshots owned fields, arrays and budget only when applied", () => {
  const methods = ["get"];
  const budget = { percentCanRetry: 0, minRetriesPerSecond: 1, ttlMs: 1000 };
  const shouldRetry = () => true;
  const reads: string[] = [];
  const original = {
    maxRetries: 3,
    delayMs: 0,
    factor: 3,
    maxDelayMs: Infinity,
    jitter: 0.1,
    attemptTimeoutMs: 100,
    methods,
    shouldRetry,
    budget,
  };
  const captured = Object.fromEntries(
    Object.entries(original).map(([key, value]) => [
      key,
      {
        enumerable: true,
        get() {
          reads.push(key);
          return value;
        },
      },
    ]),
  );
  const option = withRetry(Object.defineProperties({}, captured));
  expect(reads).toEqual([]);
  let config: ClientConfig | undefined;
  createClient(option, (value) => {
    config = value;
  });
  expect(reads).toEqual(Object.keys(original));
  methods.length = 0;
  budget.minRetriesPerSecond = 999;
  expect(config?.retry).toEqual({
    ...original,
    methods: ["get"],
    budget: { percentCanRetry: 0, minRetriesPerSecond: 1, ttlMs: 1000 },
  });
  expect(config?.retry?.shouldRetry).toBe(shouldRetry);
});

test("retry getter errors escape createClient while applying the option", () => {
  const error = new Error("getter");
  const option = withRetry({
    get delayMs(): number {
      throw error;
    },
  });
  expect(() => createClient(option)).toThrow(error);
});

test("attemptTimeoutMs accepts the platform timer upper bound", async () => {
  clock();
  const timer = vi.spyOn(globalThis, "setTimeout");
  const h = fixture({ attemptTimeoutMs: 2_147_483_647, maxRetries: 0 });
  expect((await h.pending)[0]?.code).toBe("NET_UNREACHABLE");
  expect(h.handle).toHaveBeenCalledTimes(1);
  expect(timer.mock.calls.some((call) => call[1] === 2_147_483_647)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
