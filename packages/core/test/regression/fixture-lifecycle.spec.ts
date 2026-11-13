import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { expect, test, vi } from "vitest";
import type { FixtureAppDeps } from "../fixture/app.ts";
import {
  createFixtureLifecycle,
  type FixtureLifecycle,
} from "../fixture/lifecycle.ts";
import type { StartedServer, StartupLayer } from "../fixture/startup.ts";

const upgradeWebSocket: UpgradeWebSocket = () => {
  throw new Error("upgradeWebSocket sentinel");
};

interface CloseHooks {
  httpClose?: () => Promise<void>;
  rawClose?: () => Promise<void>;
}

function fakeStartup(hooks: CloseHooks = {}): {
  lifecycle: FixtureLifecycle;
  httpClose: ReturnType<typeof vi.fn<() => Promise<void>>>;
  rawClose: ReturnType<typeof vi.fn<() => Promise<void>>>;
  created: { deps?: FixtureAppDeps };
} {
  const httpClose = vi.fn(hooks.httpClose ?? (() => Promise.resolve()));
  const rawClose = vi.fn(hooks.rawClose ?? (() => Promise.resolve()));
  const created: { deps?: FixtureAppDeps } = {};
  const lifecycle = createFixtureLifecycle({
    selectStartup() {
      const http: StartedServer = {
        origin: "http://127.0.0.1:31000",
        close: httpClose,
      };
      const raw: StartedServer = {
        origin: "http://127.0.0.1:31001",
        close: rawClose,
      };
      const layer: StartupLayer = {
        runtime: "bun",
        upgradeWebSocket,
        startHttp() {
          return Promise.resolve(http);
        },
        startRaw() {
          return Promise.resolve(raw);
        },
        reserveRefusedOrigin() {
          return Promise.resolve("http://127.0.0.1:31002");
        },
      };
      return Promise.resolve(layer);
    },
    createApp(deps) {
      created.deps = deps;
      return new Hono();
    },
    createToken: () => "token-1",
    closeTimeoutMs: 500,
  });
  return { lifecycle, httpClose, rawClose, created };
}

function messages(failure: AggregateError | undefined): string[] {
  return (failure?.errors ?? []).map((error: Error) => error.message);
}

function causeOf(failure: AggregateError | undefined): unknown {
  if (!(failure instanceof AggregateError)) return undefined;
  const first: unknown = failure.errors[0];
  if (typeof first !== "object" || first === null || !("cause" in first)) {
    return undefined;
  }
  return first.cause;
}

async function failedTeardown(
  lifecycle: FixtureLifecycle,
): Promise<AggregateError | undefined> {
  try {
    await lifecycle.teardown();
    return undefined;
  } catch (error) {
    if (error instanceof AggregateError) return error;
    throw error;
  }
}

test("setup provides the four keys once and teardown closes each server once", async () => {
  const { lifecycle, httpClose, rawClose, created } = fakeStartup();
  const calls: Array<readonly [string, unknown]> = [];

  await lifecycle.setup({
    name: "core-test",
    provide(key, value) {
      calls.push([key, value]);
    },
  });

  expect(calls).toEqual([
    ["testServerHost", "http://127.0.0.1:31000"],
    ["rawServerOrigin", "http://127.0.0.1:31001"],
    ["refusedOrigin", "http://127.0.0.1:31002"],
    ["fixtureToken", "token-1"],
  ]);
  expect(created.deps?.token).toBe("token-1");
  expect(created.deps?.rawOrigin()).toBe("http://127.0.0.1:31001");
  expect(created.deps?.upgradeWebSocket).toBe(upgradeWebSocket);

  await lifecycle.teardown();
  await lifecycle.teardown();
  expect(httpClose).toHaveBeenCalledTimes(1);
  expect(rawClose).toHaveBeenCalledTimes(1);
});

test("teardown releases registry state before closing the servers", async () => {
  const order: string[] = [];
  const { lifecycle, created } = fakeStartup({
    httpClose: () => {
      order.push("http");
      return Promise.resolve();
    },
    rawClose: () => {
      order.push("raw");
      return Promise.resolve();
    },
  });
  await lifecycle.setup({
    name: "core-test",
    provide() {
      return undefined;
    },
  });
  const registry = created.deps?.registry;
  if (registry === undefined) {
    throw new Error("createApp was not called");
  }
  registry.create("x").onDispose(() => {
    order.push("dispose");
  });

  await lifecycle.teardown();
  expect(order).toEqual(["dispose", "http", "raw"]);
});

test("teardown without setup does nothing", async () => {
  const { lifecycle } = fakeStartup();
  await expect(lifecycle.teardown()).resolves.toBeUndefined();
});

test("a failed HTTP close is reported with its labeled cause and the raw server is still closed", async () => {
  const injected = new Error("injected close failure");
  const { lifecycle, httpClose, rawClose } = fakeStartup({
    httpClose: () => Promise.reject(injected),
  });
  await lifecycle.setup({
    name: "core-test",
    provide() {
      return undefined;
    },
  });

  const failure = await failedTeardown(lifecycle);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure?.message).toBe("Test server teardown failed");
  expect(messages(failure)).toEqual([
    "HTTP server close failed: injected close failure",
  ]);
  expect(causeOf(failure)).toBe(injected);
  expect(rawClose).toHaveBeenCalledTimes(1);

  expect(await failedTeardown(lifecycle)).toBeUndefined();
  expect(httpClose).toHaveBeenCalledTimes(1);
});

test("a failed raw close is reported as Raw server close failed", async () => {
  const { lifecycle } = fakeStartup({
    rawClose: () => Promise.reject(new Error("injected raw failure")),
  });
  await lifecycle.setup({
    name: "core-test",
    provide() {
      return undefined;
    },
  });

  const failure = await failedTeardown(lifecycle);
  expect(messages(failure)).toEqual([
    "Raw server close failed: injected raw failure",
  ]);
});

test("a close that never settles becomes a labeled timeout", async () => {
  const { lifecycle } = fakeStartup({
    httpClose: () => new Promise<void>(() => undefined),
  });
  await lifecycle.setup({
    name: "core-test",
    provide() {
      return undefined;
    },
  });
  try {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = failedTeardown(lifecycle);
    // closeAll settles before the HTTP close arms its timer.
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    const failure = await pending;
    expect(messages(failure)).toEqual([
      "HTTP server close failed: HTTP server close timed out",
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  { order: "normal", reverse: false },
  { order: "reverse", reverse: true },
])(
  "two lifecycles close only their own servers in $order order",
  async ({ reverse }) => {
    const closed: string[] = [];
    function tracked(name: string): CloseHooks {
      return {
        httpClose: () => {
          closed.push(name);
          return Promise.resolve();
        },
        rawClose: () => {
          closed.push(name);
          return Promise.resolve();
        },
      };
    }
    const first = fakeStartup(tracked("first")).lifecycle;
    const second = fakeStartup(tracked("second")).lifecycle;
    const project = {
      name: "core-test",
      provide() {
        return undefined;
      },
    };
    await first.setup(project);
    await second.setup(project);
    expect(closed).toEqual([]);

    await (reverse ? second : first).teardown();
    const afterFirst = [...closed];
    await (reverse ? first : second).teardown();
    const own = reverse ? "second" : "first";
    const other = reverse ? "first" : "second";
    expect([afterFirst, closed]).toEqual([
      [own, own],
      [own, own, other, other],
    ]);
  },
);
