import { afterEach, expect, inject, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  roundRobinBalancer,
  withEndpoint,
  withRetry,
  withBalancer,
  withHTTPHandle,
} from "../src";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
test("three rolling two-second outages recover at the next one-second expiry without thirty-second slots", async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
  const host = inject("testServerHost");
  const endpoints = ["a", "b", "c"].map((s) => `${host}/${s}`);
  const windows = [
    [1000, 3000],
    [5000, 7000],
    [9000, 11000],
  ];
  const resumed = new Map<string, number>();
  let attempts = 0;
  const client = createClient(
    withEndpoint(...endpoints),
    withBalancer(roundRobinBalancer({ outlierDetection: {} })),
    withRetry({ delayMs: 0 }),
    withHTTPHandle((input) => {
      const req = new Request(input);
      const index = endpoints.findIndex((endpoint) =>
        req.url.startsWith(endpoint + "/"),
      );
      const window = windows[index];
      const endpoint = endpoints[index];
      if (!window || !endpoint)
        return Promise.reject(new Error("unknown replica"));
      attempts++;
      const [from = 0, until = 0] = window;
      const now = Date.now();
      if (now >= from && now < until)
        return Promise.reject(new TypeError("replica stopped"));
      if (now >= until && !resumed.has(endpoint)) resumed.set(endpoint, now);
      return Promise.resolve(new Response("ok"));
    }),
  );
  const read = defineRequest({ method: "GET", path: "/replica" });
  for (let i = 0; i < 2880; i++) {
    vi.advanceTimersByTime(i * 10 - performance.now());
    expect((await read(client))[0]).toBeNull();
  }
  expect(attempts - 2880).toBeLessThan(100);
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i] ?? "";
    expect(resumed.get(endpoint)).toBeLessThan((windows[i]?.[1] ?? 0) + 2000);
  }
});
