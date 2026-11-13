import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "../fixture/client-auto.ts";
import { createHarness } from "./fixture-app-harness.ts";

// Shared so the following test can observe onTestFinished deleting this id.
const harness = createHarness();
const calls: Request[] = [];
let leakedId = "";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input));
    const headers = new Headers(init?.headers);
    headers.set("host", url.host);
    const request = new Request(url, {
      method: init?.method,
      headers,
      body: init?.body,
      signal: init?.signal,
    });
    calls.push(request.clone());
    return Promise.resolve(harness.app.request(request));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

test("fixture() registers cleanup for the test", async () => {
  const f = fixture("http://127.0.0.1:4000", harness.token);
  await expect(
    f.endpoint("primary", "respond", { status: 200, body: "hi" }),
  ).resolves.toBe(`http://127.0.0.1:4000/__fixture/${f.id}/e/primary`);
  leakedId = f.id;
  expect(harness.registry.get(leakedId)).toBeDefined();
});

test("the previous test's state was deleted when it finished", () => {
  expect(harness.registry.get(leakedId)).toBeUndefined();
});
