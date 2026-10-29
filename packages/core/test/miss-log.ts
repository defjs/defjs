import { expect } from "vitest";
import type { Client } from "../src/client";
import { defineRequest } from "../src/http";
import { struct } from "../src/struct";

const MissLog = struct.object({
  hits: struct.array(struct.string()),
});

export async function missHits(
  client: Client,
  path: string,
): Promise<readonly string[]> {
  const readMissLog = defineRequest({
    method: "GET",
    output: MissLog,
    path: "/e2e/miss-log",
  });
  const [error, log] = await client.execute(readMissLog());
  expect(error?.code ?? null).toBeNull();
  return (log?.hits ?? []).filter((hit) => hit.endsWith(` ${path}`));
}
