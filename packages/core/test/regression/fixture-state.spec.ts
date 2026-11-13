import { expect, test } from "vitest";
import {
  createFixtureRegistry,
  type LiveConnection,
} from "../fixture/state.ts";

function stub(request: number, log: string[] = []): LiveConnection {
  return {
    request,
    apply() {
      return Promise.resolve(true);
    },
    release() {
      log.push("release");
      return Promise.resolve();
    },
  };
}

function logged(endpoint: string) {
  return { endpoint, method: "GET", path: "/", headers: {} };
}

test("create returns a fresh state that get can find", () => {
  const registry = createFixtureRegistry();
  const state = registry.create("a");

  expect(state.id).toBe("a");
  expect(state.requests).toEqual([]);
  expect(registry.get("a")).toBe(state);
  expect(registry.get("b")).toBeUndefined();
});

test("create rejects a duplicate id", () => {
  const registry = createFixtureRegistry();
  registry.create("a");

  expect(() => registry.create("a")).toThrow('Fixture "a" already exists');
});

test("record appends and returns a per-endpoint zero-based sequence", () => {
  const registry = createFixtureRegistry();
  const state = registry.create("a");

  expect(state.record(logged("x"))).toBe(0);
  expect(state.record(logged("y"))).toBe(0);
  expect(state.record(logged("x"))).toBe(1);
  expect(state.requests.map((request) => request.endpoint)).toEqual([
    "x",
    "y",
    "x",
  ]);
});

test("whenLogged stays pending until enough requests are logged", async () => {
  const registry = createFixtureRegistry();
  const state = registry.create("a");
  await expect(state.whenLogged(0)).resolves.toBeUndefined();

  let settled = false;
  const pending = state.whenLogged(2).then(() => {
    settled = true;
  });
  state.record(logged("x"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  state.record(logged("x"));
  await pending;
  expect(settled).toBe(true);
});

test("whenLogged resolves when the state is deleted", async () => {
  const registry = createFixtureRegistry();
  const state = registry.create("a");
  const pending = state.whenLogged(5);

  await registry.delete("a");
  await expect(pending).resolves.toBeUndefined();
});

test("live returns the highest-numbered tracked connection unless a request is given", () => {
  const registry = createFixtureRegistry();
  const state = registry.create("a");
  state.track("e", stub(0));
  const untrack = state.track("e", stub(1));

  expect(state.live("e")?.request).toBe(1);
  expect(state.live("e", 0)?.request).toBe(0);
  untrack();
  expect(state.live("e")?.request).toBe(0);
  expect(state.live("other")).toBeUndefined();
});

test("delete runs disposers newest first, then releases connections, then settles waiters", async () => {
  const registry = createFixtureRegistry();
  const state = registry.create("a");
  const order: string[] = [];
  state.onDispose(() => {
    order.push("dispose:first");
  });
  state.onDispose(() => {
    order.push("dispose:second");
  });
  state.track("e", stub(0, order));
  const pending = state.whenLogged(9).then(() => {
    order.push("waiter");
  });

  await registry.delete("a");
  await pending;
  expect(order).toEqual([
    "dispose:second",
    "dispose:first",
    "release",
    "waiter",
  ]);
  expect(registry.get("a")).toBeUndefined();
});

test("delete is idempotent and resolves for an unknown id", async () => {
  const registry = createFixtureRegistry();
  const state = registry.create("a");
  const order: string[] = [];
  state.onDispose(() => {
    order.push("dispose");
  });

  await registry.delete("a");
  await registry.delete("a");
  expect(order).toEqual(["dispose"]);
  await expect(registry.delete("missing")).resolves.toBeUndefined();
});

test("closeAll deletes every state", async () => {
  const registry = createFixtureRegistry();
  const calls: string[] = [];
  registry.create("a").onDispose(() => {
    calls.push("a");
  });
  registry.create("b").onDispose(() => {
    calls.push("b");
  });

  await registry.closeAll();
  expect(calls).toEqual(["a", "b"]);
  expect(registry.get("a")).toBeUndefined();
  expect(registry.get("b")).toBeUndefined();
});
