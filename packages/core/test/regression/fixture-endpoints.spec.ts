import { expect, inject, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  roundRobinBalancer,
  struct,
  withBalancer,
  withEndpoint,
} from "../../src";
import { fixture } from "../fixture/client-auto.ts";

test("two path prefixes on one origin are independent balancer endpoints", async () => {
  const f = fixture(inject("testServerHost"), inject("fixtureToken"));
  const primaryUrl = await f.endpoint("primary", "script", {
    plan: [
      {
        status: 200,
        headers: { "content-type": "application/json" },
        chunks: ['{"who":'],
        then: "drop",
      },
    ],
  });
  const secondaryUrl = await f.endpoint("secondary", "respond", {
    status: 200,
    contentType: "application/json",
    body: '{"who":"secondary"}',
  });
  // Unweighted round-robin starts at a random index. Zero selects primaryUrl.
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  const client = createClient(
    withEndpoint(primaryUrl, secondaryUrl),
    withBalancer(
      roundRobinBalancer({ outlierDetection: { consecutiveFailures: 1 } }),
    ),
  );
  random.mockRestore();
  const read = defineRequest({
    method: "GET",
    path: "/",
    output: struct.object({ who: struct.string() }),
  });
  await read(client);
  const first = await f.log({ wait: 1 });
  expect(
    first.requests.filter((request) => request.endpoint === "primary"),
  ).toHaveLength(1);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [fault, data] = await read(client);
    expect(fault).toBeNull();
    expect(data).toEqual({ who: "secondary" });
  }
  const logged = await f.log({ wait: 5 });
  expect(
    logged.requests.filter((request) => request.endpoint === "primary"),
  ).toHaveLength(1);
  expect(
    logged.requests.filter((request) => request.endpoint === "secondary")
      .length,
  ).toBeGreaterThanOrEqual(4);
});
