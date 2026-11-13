import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFixtureClient } from "../fixture/client.ts";
import { createHarness, type Harness } from "./fixture-app-harness.ts";

const calls: Request[] = [];
let harness: Harness;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

beforeEach(() => {
  harness = createHarness();
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

test("endpoint() returns the base URL; control calls carry token and JSON type", async () => {
  const f = createFixtureClient("http://127.0.0.1:4000", harness.token);
  expect(f.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  await expect(
    f.endpoint("primary", "respond", { status: 200, body: "hi" }),
  ).resolves.toBe(`http://127.0.0.1:4000/__fixture/${f.id}/e/primary`);
  const call = calls[0];
  if (call === undefined) throw new Error("missing endpoint request");
  expect(call.method).toBe("PUT");
  expect(new URL(call.url).pathname).toBe(
    `/__fixture/${f.id}/endpoints/primary`,
  );
  expect(call.headers.get("x-fixture-token")).toBe("test-token");
  expect(call.headers.get("content-type")).toBe("application/json");
});

test("act and log use the documented routes", async () => {
  const f = createFixtureClient("http://127.0.0.1:4000", harness.token);
  const state = harness.registry.create(f.id);
  state.endpoints.set("primary", {
    name: "primary",
    scenario: "hang",
    params: {},
  });
  state.track("primary", {
    request: 0,
    apply: () => Promise.resolve(true),
    release: () => Promise.resolve(),
  });

  await f.act("primary", "end", { request: 0 });
  const actCall = calls[0];
  if (actCall === undefined) throw new Error("missing act request");
  expect(actCall.method).toBe("POST");
  expect(new URL(actCall.url).pathname).toBe(`/__fixture/${f.id}/actions`);
  const actBody: unknown = await actCall.json();
  expect(actBody).toEqual({ target: "primary", request: 0, action: "end" });

  state.record({
    endpoint: "primary",
    method: "GET",
    path: "/one",
    headers: {},
  });
  state.record({
    endpoint: "primary",
    method: "GET",
    path: "/two",
    headers: {},
  });
  const logged = await f.log({ wait: 2 });
  const logCall = calls[1];
  if (logCall === undefined) throw new Error("missing log request");
  expect(logCall.method).toBe("GET");
  const logUrl = new URL(logCall.url);
  expect(`${logUrl.pathname}${logUrl.search}`).toBe(
    `/__fixture/${f.id}/log?wait=2`,
  );
  expect(logged.requests.length).toBe(2);
});

test("non-2xx answers reject with METHOD path -> status", async () => {
  const f = createFixtureClient("http://127.0.0.1:4000", harness.token);
  harness.registry.create(f.id);
  await expect(f.act("ghost", "end")).rejects.toThrow(
    `POST /__fixture/${f.id}/actions -> 404`,
  );
});

test("rawUrl composes origin, id, scenario and encoded segments; delete() is idempotent", async () => {
  const f = createFixtureClient("http://127.0.0.1:4000", harness.token);
  const origin = "http://127.0.0.1:5000";
  expect(f.rawUrl(origin, "truncated")).toBe(
    `${origin}/__fixture/${f.id}/raw/truncated`,
  );
  expect(f.rawUrl(origin, "utf8-last-event-id", "events", "猫")).toMatch(
    /\/raw\/utf8-last-event-id\/events\/%E7%8C%AB$/,
  );

  harness.registry.create(f.id);
  await f.delete();
  expect(harness.registry.get(f.id)).toBeUndefined();
  await f.delete();
});
