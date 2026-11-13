import { expect, onTestFinished, test } from "vitest";
import { createRawHandler, rawArguments } from "../fixture/raw-scenarios.ts";
import { createFixtureRegistry } from "../fixture/state.ts";
import { selectStartup } from "../fixture/startup.ts";
import type { RawScenarioName } from "../fixture/types.ts";

const cases: ReadonlyArray<
  readonly [string, RawScenarioName, readonly string[]]
> = [
  ["/__fixture/a1/raw/truncated", "truncated", []],
  ["/__fixture/a1/raw/truncated/", "truncated", []],
  ["/__fixture/a1/raw/truncated/503/", "truncated", ["503"]],
  ["/__fixture/a1/raw/truncated/503?x=1", "truncated", ["503"]],
  [
    "/__fixture/a1/raw/utf8-last-event-id/events/%E7%8C%AB",
    "utf8-last-event-id",
    ["events", "猫"],
  ],
  [
    "/__fixture/a1/raw/utf8-last-event-id/events/%C3%A9t%C3%A9",
    "utf8-last-event-id",
    ["events", "été"],
  ],
];

async function serve(): Promise<
  (path: string, init?: RequestInit) => Promise<Response>
> {
  const registry = createFixtureRegistry();
  registry.create("a1");
  const server = await (
    await selectStartup()
  ).startRaw(createRawHandler(registry));
  onTestFinished(async () => {
    await registry.delete("a1");
    await server.close();
  });
  return (path, init) =>
    fetch(`${server.origin}/__fixture/a1/raw/${path}`, init);
}

async function firstChunk(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) throw new Error("response has no body");
  const reader = body.getReader();
  const next = await reader.read();
  if (next.done || next.value === undefined) {
    throw new Error("expected a body chunk");
  }
  const text = new TextDecoder().decode(next.value);
  await reader.cancel();
  return text;
}

export function registerRawScenarioArgumentsSuite(): void {
  test.each(cases)("rawArguments %s", (target, scenario, expected) => {
    expect(rawArguments(target, scenario)).toEqual(expected);
  });

  test("truncated serves the status of the first path segment", async () => {
    const request = await serve();
    const response = await request("truncated/503/");
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.text()).rejects.toThrow();
  });

  test("truncated defaults to status 200 without a segment", async () => {
    const request = await serve();
    const response = await request("truncated");
    expect(response.status).toBe(200);
  });

  test("utf8-last-event-id sends the decoded last segment as the first event id", async () => {
    const request = await serve();
    const response = await request("utf8-last-event-id/events/%E7%8C%AB");
    expect(await firstChunk(response)).toContain("id: 猫\ndata: first\n\n");
  });

  test("utf8-last-event-id without a segment sends an empty id", async () => {
    const request = await serve();
    const response = await request("utf8-last-event-id");
    expect(await firstChunk(response)).toContain("id: \ndata: first\n\n");
  });

  test("utf8-last-event-id answers a reconnect with the second event and a clean end", async () => {
    const request = await serve();
    const response = await request("utf8-last-event-id/events/x", {
      headers: { "last-event-id": "x" },
    });
    expect(await response.text()).toBe("data: second\n\n");
  });
}
