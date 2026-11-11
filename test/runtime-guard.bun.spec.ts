import { describe, expect, test, vi } from "vitest";
import { createBrowserApiSetup } from "./browser-api-server-setup.ts";
import { setup as setupCore } from "../packages/core/test/setup.ts";
import { setup as setupOtel } from "../packages/opentelemetry-server/test/setup.ts";
import { assertRuntime, expectedRuntime } from "./runtime-guard.ts";
import { setup } from "./runtime-guard-setup.ts";

const nodeMessage =
  'This project must run on Node.js; use "node --run unit:node".';
const bunMessage = "This project must run on Bun (main process).";

test.each([
  ["core-node", "node"],
  ["core-bun", "bun"],
  ["root-bun", "bun"],
  ["core-chrome", "browser-main"],
  ["react-firefox", "browser-main"],
  ["opentelemetry-server-node", "node"],
  ["core-plain", "any"],
] as const)("expectedRuntime(%s) is %s", (name, runtime) => {
  expect(expectedRuntime(name)).toBe(runtime);
});

test("rejects an unknown suffix", () => {
  expect(() => expectedRuntime("core-deno")).toThrow(
    "Unknown project runtime: core-deno",
  );
});

test("rejects node when Bun is present", () => {
  expect(() => assertRuntime("node", { bun: "1.4.4" })).toThrow(nodeMessage);
});

test("accepts node when Bun is absent", () => {
  expect(() => assertRuntime("node", {})).not.toThrow();
});

test.each(["bun", "browser-main"] as const)(
  "rejects %s when Bun is absent",
  (value) => {
    expect(() => assertRuntime(value, {})).toThrow(bunMessage);
  },
);

test.each(["bun", "browser-main"] as const)(
  "accepts %s when Bun is present",
  (value) => {
    expect(() => assertRuntime(value, { bun: "1.4.4" })).not.toThrow();
  },
);

test("reads process.versions by default", () => {
  expect(() => assertRuntime("bun")).not.toThrow();
  expect(() => assertRuntime("node")).toThrow(nodeMessage);
});

test("accepts any on Bun and on Node", () => {
  expect(() => assertRuntime("any", { bun: "1.4.4" })).not.toThrow();
  expect(() => assertRuntime("any", {})).not.toThrow();
});

describe("setup", () => {
  test("accepts a bun project", () => {
    expect(() => setup({ name: "core-bun" })).not.toThrow();
  });

  test("accepts a browser project", () => {
    expect(() => setup({ name: "core-chrome" })).not.toThrow();
  });

  test("rejects a node project under Bun", () => {
    expect(() => setup({ name: "core-node" })).toThrow(nodeMessage);
  });
});

describe("globalSetup wiring", () => {
  test("core setup rejects a node project under Bun before providing", async () => {
    const provide = vi.fn();
    await expect(
      setupCore({
        name: "core-node",
        provide(key, value) {
          provide(key, value);
        },
      }),
    ).rejects.toThrow(nodeMessage);
    expect(provide).not.toHaveBeenCalled();
  });

  test("otel setup rejects a node project under Bun before providing", async () => {
    const provide = vi.fn();
    await expect(
      setupOtel({
        name: "opentelemetry-server-node",
        provide(key, value) {
          provide(key, value);
        },
      }),
    ).rejects.toThrow(nodeMessage);
    expect(provide).not.toHaveBeenCalled();
  });

  test("browser api setup refuses a non-Bun main process before selecting a startup layer", async () => {
    const selectStartup = vi.fn(() =>
      Promise.reject(new Error("startup selected")),
    );
    const provide = vi.fn();
    const setup = createBrowserApiSetup(selectStartup, {});
    await expect(
      setup({
        provide(key, value) {
          provide(key, value);
        },
      }),
    ).rejects.toThrow(bunMessage);
    expect(selectStartup).not.toHaveBeenCalled();
    expect(provide).not.toHaveBeenCalled();
  });
});
