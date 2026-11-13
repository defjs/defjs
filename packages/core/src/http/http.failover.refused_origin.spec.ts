import { expect, inject, test } from "vitest";
import { createClient, withEndpoint, withBalancer, withRetry } from "../client";
import { pickFirstBalancer } from "../balancer";
import { struct } from "../struct";
import { defineRequest } from "./http";

test("opted-in GET fails over from a refused origin", async () => {
  const client = createClient(
    withEndpoint(inject("refusedOrigin"), inject("testServerHost")),
    withBalancer(pickFirstBalancer()),
    withRetry({ delayMs: 0 }),
  );
  const [error, result] = await defineRequest({
    method: "GET",
    path: "/json",
    output: struct.object({ id: struct.number() }),
  })(client);
  expect(error).toBeNull();
  expect(result).toEqual({ id: 1 });
});
