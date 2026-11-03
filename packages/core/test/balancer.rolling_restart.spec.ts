import { afterEach, expect, inject, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  roundRobinBalancer,
  withEndpoint,
  withEndpointBalancer,
  withHTTPHandle,
} from "../src";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
test("three rolling two-second outages recover at the next one-second probe without thirty-second slots", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
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
    withEndpointBalancer(roundRobinBalancer()),
    withHTTPHandle(async (input) => {
      const req = new Request(input);
      const index = endpoints.findIndex((endpoint) =>
        req.url.startsWith(endpoint + "/"),
      );
      const window = windows[index];
      const endpoint = endpoints[index];
      if (!window || !endpoint) throw new Error("unknown replica");
      attempts++;
      const [from = 0, until = 0] = window;
      const now = Date.now();
      if (now >= from && now < until) throw new TypeError("replica stopped");
      if (now >= until && !resumed.has(endpoint)) resumed.set(endpoint, now);
      return new Response("ok");
    }),
  );
  const read = defineRequest({ method: "GET", path: "/replica" });
  for (let i = 0; i < 2880; i++) {
    vi.setSystemTime(i * 10);
    expect((await read(client))[0]).toBeNull();
  }
  expect(attempts - 2880).toBeLessThan(100);
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i] ?? "";
    expect(resumed.get(endpoint)).toBeLessThan((windows[i]?.[1] ?? 0) + 2000);
  }
});
