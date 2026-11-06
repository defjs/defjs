import { afterEach, expect, test, vi } from "vitest";
import { createClient } from "../client/client";
import {
  withBalancer,
  withEndpoint,
  withHTTPHandle,
  withRetry,
} from "../client/option";
import type { ClientOption } from "../client/option";
import type { ClientConfig } from "../client/config";
import { defineRequest } from "./http";
import { ERR_TIMEOUT } from "../error";

function retry(options: unknown): ClientOption {
  // @ts-expect-error invalid runtime options are checked during HTTP execution
  return withRetry(options);
}
const op = defineRequest({ method: "GET", path: "/" });
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function fixture(options: unknown, count = 8, signal?: AbortSignal) {
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
    retry(options),
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

test("retry waits 25, 50, 100, 200, 250 milliseconds before successive attempts", async () => {
  clock();
  const timer = vi.spyOn(globalThis, "setTimeout");
  const h = fixture({ maxAttempts: 7, jitter: 0, budget: false });
  await h.first;
  expect(h.handle).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  for (const [index, delay] of [25, 50, 100, 200, 250, 250].entries()) {
    await waiting(h.handle, index + 1);
    expect(timer.mock.calls.filter((call) => call[1] !== 1).at(-1)?.[1]).toBe(
      delay,
    );
    expect(h.handle).toHaveBeenCalledTimes(index + 1);
    await vi.advanceTimersToNextTimerAsync();
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
    const h = fixture({}, 2);
    await waiting(h.handle, 1);
    const delay = timer.mock.calls.find((call) => call[1] !== 1)?.[1];
    expect(delay).toBeGreaterThanOrEqual(20);
    expect(delay).toBeLessThanOrEqual(30);
    expect(delay).toBe(random === 0 ? 20 : 30);
    await vi.advanceTimersByTimeAsync(30);
    await h.pending;
  },
);

test.each([
  { delayMs: 0 },
  { maxAttempts: 1 },
  { methods: [] },
  { on: [] },
  { budget: { percentCanRetry: 0, minRetriesPerSecond: 0 } },
])("retry creates no timer when no wait is needed: %j", async (options) => {
  clock();
  const timer = vi.spyOn(globalThis, "setTimeout");
  const h = fixture(options, 2);
  await h.pending;
  expect(h.handle).toHaveBeenCalledTimes("delayMs" in options ? 2 : 1);
  expect(timer).not.toHaveBeenCalled();
});

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
  vi.spyOn(
    await import("../balancer/retry_budget"),
    "retryBudgetFor",
  ).mockReturnValue(budget);
  const h = fixture({ jitter: 0 }, 2);
  await waiting(h.handle, 1);
  expect(budget.deposit).toHaveBeenCalledTimes(1);
  expect(budget.tryWithdraw).toHaveBeenCalledTimes(1);
  expect(h.pick).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(25);
  await h.pending;
});

test.each([
  { delayMs: -1 },
  { delayMs: Infinity },
  { delayMs: NaN },
  { delayMs: "25" },
  { factor: 0 },
  { factor: -1 },
  { factor: Infinity },
  { factor: NaN },
  { jitter: -0.1 },
  { jitter: 1.1 },
  { jitter: Infinity },
  { jitter: NaN },
  { maxDelayMs: -1 },
  { maxDelayMs: -Infinity },
  { maxDelayMs: NaN },
])("invalid retry backoff %j fails before picking", async (options) => {
  const h = fixture(options);
  expect((await h.pending)[0]?.code).toBe("REQ_OPTIONS_INVALID");
  expect(h.pick).not.toHaveBeenCalled();
});

test.each([
  ["no arguments", () => withRetry()],
  ["undefined", () => withRetry(undefined)],
  ["an empty object", () => withRetry({})],
])(
  "withRetry with %s enables default GET connection failover",
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
    await vi.advanceTimersByTimeAsync(30);
    expect((await pending)[0]).toBeNull();
    expect(seen).toEqual(["https://a.test/", "https://b.test/"]);
  },
);

test("withRetry maxAttempts 1 replaces an enabled policy with one attempt", async () => {
  const handle = vi.fn(() => Promise.reject(new TypeError("refused")));
  const client = createClient(
    withEndpoint("https://a.test", "https://b.test"),
    withRetry(),
    withRetry({ maxAttempts: 1 }),
    withHTTPHandle(handle),
  );
  expect((await op(client))[0]?.code).toBe("NET_UNREACHABLE");
  expect(handle).toHaveBeenCalledTimes(1);
});

test("withRetry null stays invalid when HTTP runs", async () => {
  const handle = vi.fn(() => Promise.resolve(new Response("ok")));
  const client = createClient(
    withEndpoint("https://a.test"),
    // @ts-expect-error null is not a retry policy
    withRetry(null),
    withHTTPHandle(handle),
  );
  const [fault] = await op(client);
  expect(fault?.code).toBe("REQ_OPTIONS_INVALID");
  expect(fault?.cause).toEqual(new RangeError("Invalid retry options"));
  expect(handle).not.toHaveBeenCalled();
});

test("retry snapshots owned fields, arrays and budget only when applied", () => {
  const on = ["connect-failure"];
  const methods = ["get"];
  const budget = { percentCanRetry: 0, minRetriesPerSecond: 1, ttlMs: 1000 };
  const reads: string[] = [];
  const original = {
    maxAttempts: 3,
    on,
    methods,
    attemptTimeoutMs: 100,
    delayMs: 0,
    factor: 3,
    jitter: 0.1,
    maxDelayMs: Infinity,
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
  const option = retry(Object.defineProperties({}, captured));
  expect(reads).toEqual([]);
  let config: ClientConfig | undefined;
  createClient(option, (value) => {
    config = value;
  });
  expect(reads).toEqual(Object.keys(original));
  on.length = 0;
  methods.length = 0;
  budget.minRetriesPerSecond = 999;
  expect(config?.http.retry).toEqual({
    ...original,
    on: ["connect-failure"],
    methods: ["get"],
    budget: { percentCanRetry: 0, minRetriesPerSecond: 1, ttlMs: 1000 },
  });
});

test("retry getter errors escape createClient while applying the option", () => {
  const error = new Error("getter");
  const option = retry({
    get delayMs() {
      throw error;
    },
  });
  expect(() => createClient(option)).toThrow(error);
});
