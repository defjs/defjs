import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
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
  ["doc-e2e", "browser-main"],
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
    expect(() => setup({ name: "doc-e2e" })).not.toThrow();
  });

  test("rejects a node project under Bun", () => {
    expect(() => setup({ name: "core-node" })).toThrow(nodeMessage);
  });
});

function firstBrowserApiSetupStatement(source: string): string {
  const factory = "function createBrowserApiSetup";
  const factoryAt = source.indexOf(factory);
  if (factoryAt < 0) {
    throw new Error(`missing ${factory}`);
  }
  const returned = source.indexOf("return async function", factoryAt);
  if (returned < 0) {
    throw new Error("missing function returned by createBrowserApiSetup");
  }
  return firstFunctionStatement(source, returned);
}

function firstFunctionStatement(source: string, headerAt: number): string {
  const openParen = source.indexOf("(", headerAt);
  if (openParen < 0) {
    throw new Error("missing setup parameter list");
  }
  let depth = 0;
  let closeParen = -1;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        closeParen = index;
        break;
      }
    }
  }
  if (closeParen < 0) {
    throw new Error("missing setup parameter list");
  }
  const openBrace = source.indexOf("{", closeParen);
  if (openBrace < 0) {
    throw new Error("missing setup body");
  }
  let cursor = openBrace + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char !== undefined && /\s/.test(char)) {
      cursor += 1;
      continue;
    }
    if (source.startsWith("//", cursor)) {
      const newline = source.indexOf("\n", cursor);
      cursor = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    break;
  }
  const semicolon = source.indexOf(";", cursor);
  if (semicolon < 0) {
    throw new Error("missing first setup statement");
  }
  return source.slice(cursor, semicolon).trim();
}

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

  test("browser api setup guards the runtime first", () => {
    const source = readFileSync(
      `${import.meta.dirname}/browser-api-server-setup.ts`,
      "utf8",
    );
    expect(firstBrowserApiSetupStatement(source)).toMatch(
      /assertRuntime\("browser-main"\)/,
    );
  });
});
