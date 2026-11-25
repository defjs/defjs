import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createTempDir, createIoRecorder } from "../../test/helpers.ts";
import { requireOpenApiTargets } from "../commands/openapi/config.ts";
import { defineConfig, runCli } from "../index.ts";
import { CliError, isRecord } from "../runtime/diagnostics.ts";
import {
  loadDefjsConfig,
  loadModuleDefaultExport,
  extractModuleDefault,
} from "./loader.ts";
import { parseDefjsConfig } from "./schema.ts";

describe("@defjs/cli config loading", () => {
  test("discovers defjs.config.ts with direct JSON import and runs --check", async () => {
    const tmp = createTempDir("defjs-cli-config-");
    writeFileSync(
      join(tmp, "spec.json"),
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Imported", version: "1.0.0" },
        paths: {
          "/ping": {
            get: {
              operationId: "ping",
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": { schema: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      }),
    );

    writeFileSync(
      join(tmp, "defjs.config.ts"),
      `import spec from "./spec.json" with { type: "json" };
export default {
  openapi: {
    input: spec,
    output: { dir: "./generated", format: "ts" },
  },
};
`,
    );

    const checkMissing = createIoRecorder(tmp);
    expect(
      await runCli(["openapi", "generate", "--check"], checkMissing.io),
    ).toBe(1);
    expect(checkMissing.stderr).toContain("Out of sync");

    const gen = createIoRecorder(tmp);
    expect(await runCli(["openapi", "generate"], gen.io)).toBe(0);
    expect(gen.stdout).toContain("Generated 1 operations");

    const sampleCfg = {
      openapi: { input: "./spec.json", output: { dir: "./generated" } },
    };
    expect(defineConfig(sampleCfg)).toBe(sampleCfg);

    const checkSynced = createIoRecorder(tmp);
    expect(
      await runCli(["openapi", "generate", "--check"], checkSynced.io),
    ).toBe(0);
    expect(checkSynced.stdout).toContain("Up to date");

    // Verify explicit --config + config defaults (no CLI flag overrides) + explicit --config with overrides
    writeFileSync(
      join(tmp, "full.config.ts"),
      `import spec from "./spec.json" with { type: "json" };
export default {
  openapi: {
    input: spec,
    output: { dir: "./full-out", format: "ts" },
    mode: "sync",
    errorStrategy: "none",
    mixed2xxStrategy: "omit",
  },
};
`,
    );
    const fullRec = createIoRecorder(tmp);
    expect(
      await runCli(
        ["openapi", "generate", "--config", "./full.config.ts"],
        fullRec.io,
      ),
    ).toBe(0);

    const overrideRec = createIoRecorder(tmp);
    expect(
      await runCli(
        [
          "openapi",
          "generate",
          "--config",
          "./defjs.config.ts",
          "--output",
          "./override-out",
          "--format",
          "tsx",
          "--mode",
          "scaffold",
          "--error-strategy",
          "union",
          "--mixed-2xx",
          "split",
        ],
        overrideRec.io,
      ),
    ).toBe(0);
    expect(existsSync(join(tmp, "override-out/index.tsx"))).toBe(true);

    // Config without an `openapi` section parses as valid DefjsConfig, but `openapi generate` rejects it clearly
    expect(parseDefjsConfig({})).toEqual({});
    expect(() => requireOpenApiTargets({})).toThrow(
      'does not define an "openapi" section',
    );
    writeFileSync(join(tmp, "empty.config.ts"), "export default {};\n");
    const emptyCfgRec = createIoRecorder(tmp);
    expect(
      await runCli(
        ["openapi", "generate", "--config", "./empty.config.ts"],
        emptyCfgRec.io,
      ),
    ).toBe(1);
    expect(emptyCfgRec.stderr).toContain(
      'does not define an "openapi" section',
    );
  });

  test("validates config shapes and loads native TypeScript modules", async () => {
    const tmp = createTempDir("defjs-cli-native-loader-");

    // Config validation errors
    for (const bad of [
      null,
      { openapi: [] },
      { openapi: [123] },
      { openapi: { input: 123, output: { dir: "x" } } },
      { openapi: { input: "a.yaml", output: "bad" } },
      { openapi: { input: "a.yaml", output: { dir: "" } } },
      { openapi: { input: "a.yaml", output: { dir: "x", format: 1 } } },
      { openapi: { input: "a.yaml", output: { dir: "x", format: "cjs" } } },
      { openapi: { input: "a.yaml", output: { dir: "x", coreImport: "" } } },
      { openapi: { input: "a.yaml", output: { dir: "x" }, mode: 1 } },
      { openapi: { input: "a.yaml", output: { dir: "x" }, mode: "bad" } },
      { openapi: { input: "a.yaml", output: { dir: "x" }, errorStrategy: 1 } },
      {
        openapi: {
          input: "a.yaml",
          output: { dir: "x" },
          errorStrategy: "bad",
        },
      },
      {
        openapi: { input: "a.yaml", output: { dir: "x" }, mixed2xxStrategy: 1 },
      },
      {
        openapi: {
          input: "a.yaml",
          output: { dir: "x" },
          mixed2xxStrategy: "bad",
        },
      },
      { openapi: { input: "a.yaml", output: { dir: "x" }, include: [1] } },
      { openapi: { input: "a.yaml", output: { dir: "x" }, exclude: "str" } },
    ]) {
      expect(() => parseDefjsConfig(bad)).toThrow(CliError);
    }

    // Valid full config options + sync/async loaders (object & string)
    const validCfg = parseDefjsConfig({
      openapi: [
        {
          input: () =>
            Promise.resolve({
              openapi: "3.1.0",
              info: { title: "Ok", version: "1.0" },
              paths: {},
            }),
          output: {
            dir: "x",
            format: "mjs",
            coreImport: "@defjs/core",
          },
          mode: "scaffold",
          errorStrategy: "union",
          mixed2xxStrategy: "split",
          include: ["a"],
          exclude: ["b"],
        },
        {
          input: () =>
            Promise.resolve(
              'openapi: 3.1.0\ninfo:\n  title: OkStr\n  version: "1.0"\npaths: {}',
            ),
          output: { dir: "y" },
        },
      ],
    });
    const validFull = requireOpenApiTargets(validCfg);
    expect(validFull).toHaveLength(2);
    const okLoader = validFull[0]?.input;
    const strLoader = validFull[1]?.input;
    if (typeof okLoader !== "function" || typeof strLoader !== "function") {
      throw new Error("Expected loader");
    }
    expect(isRecord(await okLoader())).toBe(true);
    expect(typeof (await strLoader())).toBe("string");

    // Async loader validation failure inside parseDefjsConfig
    const parsedLoader = requireOpenApiTargets(
      parseDefjsConfig({
        openapi: {
          input: () => Promise.resolve(123),
          output: { dir: "x" },
        },
      }),
    );
    const loaderFn = parsedLoader[0]?.input;
    if (typeof loaderFn !== "function") {
      throw new Error("Expected loader function");
    }
    await expect(loaderFn()).rejects.toThrow(
      "must resolve to a string or document",
    );

    // Namespace export without default + function default export config
    writeFileSync(
      join(tmp, "fn-config.mts"),
      `export default () => ({
  openapi: { input: "inline", output: { dir: "./fn-out" } },
});
`,
    );
    const loadedFn = await loadModuleDefaultExport(join(tmp, "fn-config.mts"));
    expect(typeof loadedFn).toBe("function");
    const fnTargets = requireOpenApiTargets(
      await loadDefjsConfig(join(tmp, "fn-config.mts")),
    );
    expect(fnTargets).toHaveLength(1);

    writeFileSync(join(tmp, "named-only.mts"), `export const value = 42;\n`);
    const namedOnly = await loadModuleDefaultExport(
      join(tmp, "named-only.mts"),
    );
    expect(isRecord(namedOnly) && namedOnly["value"]).toBe(42);

    await expect(
      loadModuleDefaultExport(join(tmp, "missing-config.ts")),
    ).rejects.toThrow("Module file not found");

    // Syntax error
    writeFileSync(join(tmp, "broken-syntax.mts"), `export default = ;\n`);
    await expect(
      loadModuleDefaultExport(join(tmp, "broken-syntax.mts")),
    ).rejects.toThrow("Failed to load module");

    // Extract default helper branches
    expect(extractModuleDefault(null)).toBeNull();
    expect(extractModuleDefault(42)).toBe(42);
    expect(extractModuleDefault({ named: 1 })).toEqual({ named: 1 });
    expect(extractModuleDefault({ default: "ok" })).toBe("ok");

    // Erasable TypeScript syntax + import attribute with { type: "json" } via native import()
    writeFileSync(
      join(tmp, "enum-spec.json"),
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "NativeTsSpec", version: "1.0.0" },
        paths: {},
      }),
    );
    writeFileSync(
      join(tmp, "ts-native.config.ts"),
      `import spec from "./enum-spec.json" with { type: "json" };
interface ModeMap {
  readonly sync: "sync";
}
const modes: ModeMap = { sync: "sync" } as const;
export default {
  openapi: {
    input: spec,
    output: { dir: "./native-out" },
    mode: modes.sync,
  },
};
`,
    );
    const nativeTargets = requireOpenApiTargets(
      await loadDefjsConfig(join(tmp, "ts-native.config.ts")),
    );
    expect(nativeTargets).toHaveLength(1);
    expect(nativeTargets[0]?.mode).toBe("sync");

    // Missing imported module reports load failure cleanly
    const missingImportFile = join(tmp, "needs-missing.mjs");
    writeFileSync(
      missingImportFile,
      `import x from "./does-not-exist-anywhere.mjs"; export default x;\n`,
    );
    await expect(loadModuleDefaultExport(missingImportFile)).rejects.toThrow(
      "Failed to load module",
    );
  });
});
