import { onTestFinished } from "vitest";
import { createFixtureClient, type FixtureClient } from "./client.ts";

export function fixture(
  host: string,
  token: string,
  options?: { autoDelete?: boolean },
): FixtureClient {
  const client = createFixtureClient(host, token);
  if (options?.autoDelete !== false) {
    onTestFinished(() => client.delete());
  }
  return client;
}
