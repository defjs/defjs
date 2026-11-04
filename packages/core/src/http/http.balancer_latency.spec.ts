import { afterEach, expect, test, vi } from "vitest";
import { p2cBalancer } from "../balancer/p2c";
import { createClient } from "../client/client";
import {
  withEndpoint,
  withEndpointBalancer,
  withHTTPHandle,
  withInterceptors,
} from "../client/option";
import { defineRequest } from "./http";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("80 ms of interceptor work on either side does not contaminate p2c HTTP latency", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
  const balancer = p2cBalancer({
    defaultRttMs: 1,
    decayMs: 1000000,
    outlierDetection: false,
  });
  const [, slower] = balancer.pick({
    endpoints: ["https://slower.test"],
    transport: "http",
  });
  slower?.start?.();
  vi.setSystemTime(50);
  slower?.end?.({ attempted: true, status: 200 });
  slower?.done?.({ attempted: true, status: 200 });
  const client = createClient(
    withEndpoint("https://fast.test"),
    withEndpointBalancer(balancer),
    withHTTPHandle(() => {
      vi.setSystemTime(Date.now() + 10);
      return Promise.resolve(new Response(null));
    }),
    withInterceptors({
      kind: "http",
      async fn(request, next) {
        vi.setSystemTime(Date.now() + 80);
        const response = await next(request);
        vi.setSystemTime(Date.now() + 80);
        return response;
      },
    }),
  );
  expect(
    (await defineRequest({ method: "GET", path: "/" })(client))[0],
  ).toBeNull();
  expect(
    balancer.pick({
      endpoints: ["https://fast.test", "https://slower.test"],
      transport: "http",
    })[1]?.endpoint,
  ).toBe("https://fast.test");
});

test("p2c slow-host traffic stays close to baseline with 80ms before and after interceptors", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(Math, "random").mockReturnValue(0);
  async function run(interceptorMs: number) {
    vi.setSystemTime(0);
    let slow = 0;
    const b = p2cBalancer({ defaultRttMs: 1, outlierDetection: false });
    const client = createClient(
      withEndpoint("https://slow.test", "https://fast.test"),
      withEndpointBalancer(b),
      withHTTPHandle((input) => {
        const isSlow = new Request(input).url.startsWith("https://slow.test");
        if (isSlow) slow++;
        vi.setSystemTime(Date.now() + (isSlow ? 30 : 10));
        return Promise.resolve(new Response(null));
      }),
      withInterceptors({
        kind: "http",
        async fn(req, next) {
          vi.setSystemTime(Date.now() + interceptorMs);
          const response = await next(req);
          vi.setSystemTime(Date.now() + interceptorMs);
          return response;
        },
      }),
    );
    const read = defineRequest({ method: "GET", path: "/" });
    for (let i = 0; i < 120; i++) expect((await read(client))[0]).toBeNull();
    return slow;
  }
  const baseline = await run(0);
  const intercepted = await run(80);
  expect(baseline).toBeLessThan(24);
  expect(intercepted).toBeLessThan(24);
  expect(Math.abs(intercepted - baseline)).toBeLessThanOrEqual(6);
});
