import type { Context, MiddlewareHandler } from "hono";
import {
  defineWebSocketHelper,
  type UpgradeWebSocket,
  type WSEvents,
} from "hono/ws";
import { expect, test } from "vitest";
import { createFixtureApp } from "../fixture/app.ts";
import {
  createFixtureRegistry,
  type FixtureRegistry,
} from "../fixture/state.ts";

const upgradeCalls: unknown[] = [];
const helper = defineWebSocketHelper((c) => c.text("upgraded"));

function upgradeWebSocket(
  createEvents: (c: Context) => WSEvents | Promise<WSEvents>,
): MiddlewareHandler;
function upgradeWebSocket(
  c: Context,
  events: WSEvents,
): ReturnType<UpgradeWebSocket>;
function upgradeWebSocket(
  first: Context | ((c: Context) => WSEvents | Promise<WSEvents>),
  second?: WSEvents,
): MiddlewareHandler | ReturnType<UpgradeWebSocket> {
  upgradeCalls.push(first);
  if (typeof first === "function") {
    return helper(first);
  }
  if (second === undefined) {
    throw new Error("websocket events are required");
  }
  return helper(first, second);
}

function createApp(registry: FixtureRegistry = createFixtureRegistry()) {
  const app = createFixtureApp({
    upgradeWebSocket,
    rawOrigin: () => "http://127.0.0.1:9",
    registry,
    token: "token",
  });
  return { app, registry };
}

test("serves the plain routes", async () => {
  const { app } = createApp();

  expect(await (await app.request("/text")).text()).toBe("Hello World!");
  const json: unknown = await (await app.request("/json")).json();
  expect(json).toEqual({ id: 1 });
  expect((await app.request("/500")).statusText).toBe("");
  expect((await app.request("/json/malformed-error")).statusText).toBe("");
  expect((await app.request("/head", { method: "HEAD" })).statusText).toBe("");
});

test("redirects /body/truncated to the legacy raw scenario", async () => {
  const { app } = createApp();
  const response = await app.request("/body/truncated");

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "http://127.0.0.1:9/__fixture/legacy/raw/truncated",
  );
});

test("routes every WebSocket path through the injected upgradeWebSocket", async () => {
  upgradeCalls.length = 0;
  const { app } = createApp();

  expect(upgradeCalls).toHaveLength(16);
  expect(await (await app.request("/ws/echo")).text()).toBe("upgraded");
  expect(await (await app.request("/e2e/ws/room1")).text()).toBe("upgraded");
  expect(upgradeCalls).toHaveLength(16);
});

test("disposing the legacy fixture errors open SSE drop streams", async () => {
  const { app, registry } = createApp();
  const response = await app.request("/sse/drop?key=k");
  const body = response.body;
  if (body === null) {
    throw new Error("expected a response body");
  }
  const reader = body.getReader();
  const first = await reader.read();
  if (first.value === undefined) {
    throw new Error("expected a first SSE chunk");
  }

  expect(new TextDecoder().decode(first.value)).toBe(
    "event: message\ndata: partial\nid: 1\n\n",
  );

  await registry.delete("legacy");
  await expect(reader.read()).rejects.toThrow("test server stopped");
});

test("keeps attempt counters per app instance", async () => {
  const first = createApp();
  const second = createApp();

  expect((await first.app.request("/sse/500-once?key=a")).status).toBe(500);
  expect((await second.app.request("/sse/500-once?key=a")).status).toBe(500);
});
