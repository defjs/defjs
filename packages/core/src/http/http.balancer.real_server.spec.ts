import { describe, expect, inject, test } from "vitest";
import type { Balancer, DoneInfo, PickInfo } from "../balancer";
import {
  createClient,
  withEndpoint,
  withBalancer,
  withInterceptors,
} from "../client";
import { createHttpInterceptor } from "../interceptor";
import { makeResponse } from "../internal/http_response";
import { defineRequest } from "./index";

const getJson = defineRequest({ method: "GET", path: "/json" });

function recordingBalancer(): {
  balancer: Balancer;
  dones: DoneInfo[];
  picks: PickInfo[];
} {
  const picks: PickInfo[] = [];
  const dones: DoneInfo[] = [];
  const balancer: Balancer = {
    pick(info) {
      picks.push(info);
      const endpoint = info.endpoints[0];
      if (endpoint === undefined) {
        return [new Error("no endpoint"), undefined];
      }
      return [
        null,
        {
          done(report) {
            dones.push(report);
          },
          endpoint,
        },
      ];
    },
  };
  return { balancer, dones, picks };
}

describe("http balancer against the fixture server", () => {
  test("reports a 200 attempt without transport metadata after a successful response", async () => {
    const watched = recordingBalancer();
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withBalancer(watched.balancer),
    );

    const [error] = await getJson(client);

    expect(error).toBeNull();
    expect(watched.picks[0]).not.toHaveProperty("transport");
    expect(watched.dones).toEqual([{ attempted: true, status: 200 }]);
  });

  test("reports an unattempted pick when an interceptor returns makeResponse", async () => {
    const watched = recordingBalancer();
    const client = createClient(
      withEndpoint(inject("testServerHost")),
      withBalancer(watched.balancer),
      withInterceptors(
        createHttpInterceptor(() =>
          Promise.resolve(makeResponse({ status: 204 })),
        ),
      ),
    );

    const [error] = await getJson(client);

    expect(error).toBeNull();
    expect(watched.dones).toEqual([{ attempted: false }]);
  });
});

test("health-filtered round robin stops selecting the 503 browser fixture", async () => {
  const { roundRobinBalancer } = await import("../balancer");
  const fixture = inject("testServerHost");
  const good = `${fixture}/balancer/good`;
  const bad = `${fixture}/balancer/bad`;
  const hits: string[] = [];
  const client = createClient(
    withEndpoint(bad, good),
    // A penalty longer than the test keeps the ejected replica out regardless of machine speed.
    withBalancer(
      roundRobinBalancer({
        outlierDetection: {
          minPenaltyMs: 60_000,
          maxPenaltyMs: 60_000,
          jitterRatio: 0,
        },
      }),
    ),
    withInterceptors(
      createHttpInterceptor(async (request, next) => {
        hits.push(request.baseEndpoint ?? "");
        return next(request);
      }),
    ),
  );
  const read = defineRequest({ method: "GET", path: "/replica" });
  for (let i = 0; i < 13; i += 1) await read(client);
  expect(hits.filter((endpoint) => endpoint === bad)).toHaveLength(5);
  expect(hits.slice(-3)).toEqual([good, good, good]);
});
