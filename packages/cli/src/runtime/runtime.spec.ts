import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, onTestFinished, test, vi } from "vitest";
import {
  createUniqueNamer,
  escapeIdentifier,
  toCamelCase,
  toKebabCase,
  toPascalCase,
} from "../codegen/naming.ts";
import { generateOpenApi, runCli } from "../index.ts";
import { CLI_VERSION } from "../version.ts";
import {
  createIoRecorder,
  createTempDir,
  repoRoot,
} from "../../test/helpers.ts";
import { normalizeExitCode } from "./app.ts";
import {
  errorMessage,
  formatDiagnostic,
  isRecord,
  requireRecord,
} from "./diagnostics.ts";

describe("@defjs/cli command tree and diagnostics", () => {
  test("matches package.json version", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8"),
    );
    expect(isRecord(raw) ? raw["version"] : undefined).toBe(CLI_VERSION);
  });

  test("handles help, version, and invalid CLI commands/flags cleanly", async () => {
    const tmp = createTempDir("defjs-cli-help-");

    for (const argv of [[], ["-h"], ["--help"]]) {
      const rec = createIoRecorder(tmp);
      const code = await runCli(argv, rec.io);
      expect(code).toBe(0);
      expect(rec.stdout).toContain("USAGE");
      expect(rec.stdout).toContain("defjs openapi");
      expect(rec.stderr).toBe("");
    }

    {
      const rec = createIoRecorder(tmp);
      const code = await runCli(["-v"], rec.io);
      expect(code).toBe(0);
      expect(rec.stdout.trim()).toBe(CLI_VERSION);
    }

    for (const argv of [
      ["openapi"],
      ["openapi", "-h"],
      ["openapi", "--help"],
    ]) {
      const rec = createIoRecorder(tmp);
      const code = await runCli(argv, rec.io);
      expect(code).toBe(0);
      expect(rec.stdout).toContain("USAGE");
      expect(rec.stdout).toContain("defjs openapi generate");
      expect(rec.stderr).toBe("");
    }

    {
      const rec = createIoRecorder(tmp);
      const code = await runCli(["openapi", "generate", "--help"], rec.io);
      expect(code).toBe(0);
      expect(rec.stdout).toContain("USAGE");
      expect(rec.stdout).toContain("defjs openapi generate");
    }

    {
      const rec = createIoRecorder(tmp);
      const code = await runCli(["unknown"], rec.io);
      expect(code).toBe(2);
      expect(rec.stderr).toContain("No command registered for `unknown`");
    }

    for (const [argv, expectedCode] of [
      [["unknown"], 2],
      [["openapi", "unknown"], 2],
      [["openapi", "generate", "extra"], 2],
      [["openapi", "generate", "--unknown-flag"], 2],
      [
        ["openapi", "generate", "-i", "a.yaml", "-o", "out", "--format", "cjs"],
        2,
      ],
      [
        ["openapi", "generate", "-i", "a.yaml", "-o", "out", "--mode", "bad"],
        2,
      ],
      [
        [
          "openapi",
          "generate",
          "-i",
          "a.yaml",
          "-o",
          "out",
          "--error-strategy",
          "bad",
        ],
        2,
      ],
      [
        [
          "openapi",
          "generate",
          "-i",
          "a.yaml",
          "-o",
          "out",
          "--mixed-2xx",
          "bad",
        ],
        2,
      ],
      [["openapi", "generate", "--input", "a.yaml"], 2],
      [["openapi", "generate", "--output", "out"], 2],
      [["openapi", "generate"], 2],
    ] as const) {
      const rec = createIoRecorder(tmp);
      const code = await runCli([...argv], rec.io);
      expect(code).toBe(expectedCode);
      expect(rec.stderr.length).toBeGreaterThan(0);
    }

    // Exercise default process argv and DEFAULT_IO writers
    const origArgv = process.argv;
    onTestFinished(() => {
      process.argv = origArgv;
    });
    const outSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const errSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    onTestFinished(() => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    });
    process.argv = [process.argv[0] ?? "node", "defjs", "--version"];
    expect(await runCli()).toBe(0);
    expect(outSpy).toHaveBeenCalledWith(`${CLI_VERSION}\n`);
    expect(await runCli(["unknown-cmd"])).toBe(2);
    expect(errSpy).toHaveBeenCalled();

    // Also runCli openapi generate with default io (cwd defaults to process.cwd())
    const cwdSpecPath = join(tmp, "cwd-default.yaml");
    writeFileSync(
      cwdSpecPath,
      'openapi: 3.1.0\ninfo:\n  title: CwdDefault\n  version: "1.0"\npaths: {}\n',
    );
    expect(
      await runCli([
        "openapi",
        "generate",
        "-i",
        cwdSpecPath,
        "-o",
        join(tmp, "cwd-default-out"),
      ]),
    ).toBe(0);

    // Invalid spec through runCli prints formatted diagnostics via CliError.diagnostics
    const badSpecPath = join(tmp, "bad-openapi.yaml");
    writeFileSync(badSpecPath, "openapi: 3.1.0\ninfo:\n  title: Bad\n");
    const invalidRec = createIoRecorder(tmp);
    expect(
      await runCli(
        ["openapi", "generate", "-i", badSpecPath, "-o", join(tmp, "bad-out")],
        invalidRec.io,
      ),
    ).toBe(1);
    expect(invalidRec.stderr).toContain("Invalid OpenAPI specification");

    // Direct --input / --output without config + warning output via runCli stderr
    const warnSpecPath = join(tmp, "warn-spec.yaml");
    writeFileSync(
      warnSpecPath,
      `openapi: 3.1.0
info: { title: Warn, version: "1.0" }
webhooks:
  hook:
    post:
      responses: { "200": { description: ok } }
paths: {}
`,
    );
    const warnRec = createIoRecorder(tmp);
    expect(
      await runCli(
        [
          "openapi",
          "generate",
          "--input",
          warnSpecPath,
          "--output",
          join(tmp, "warn-out"),
        ],
        warnRec.io,
      ),
    ).toBe(0);
    expect(warnRec.stderr).toContain("CLI_UNSUPPORTED_WEBHOOKS");

    // generateOpenApi with omitted cwd
    const noCwdRes = await generateOpenApi({
      target: {
        input: {
          openapi: "3.1.0",
          info: { title: "NoCwd", version: "1.0.0" },
          paths: {},
        },
        output: { dir: join(tmp, "no-cwd-out") },
      },
    });
    expect(noCwdRes.operationCount).toBe(0);
  });

  test("handles non-CliError thrown from unexpected IO errors", async () => {
    const tmp = createTempDir("defjs-cli-err-");
    expect(normalizeExitCode(undefined)).toBe(0);

    const helpCode = await runCli(["--help"], {
      cwd: tmp,
      stdout: () => {
        throw new Error("stdout broken");
      },
      stderr: () => {},
    });
    expect(helpCode).toBe(1);

    const specPath = join(tmp, "io-err.yaml");
    writeFileSync(
      specPath,
      'openapi: 3.1.0\ninfo:\n  title: IoErr\n  version: "1.0"\npaths: {}\n',
    );
    let errOutput = "";
    const genCode = await runCli(
      ["openapi", "generate", "-i", specPath, "-o", join(tmp, "io-err-out")],
      {
        cwd: tmp,
        stdout: () => {
          throw new Error("stdout broken in command");
        },
        stderr: (chunk) => {
          errOutput += chunk;
        },
      },
    );
    expect(genCode).toBe(1);
    expect(errOutput).toContain("stdout broken in command");
  });

  test("diagnostic and naming helpers handle edge inputs", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(() => requireRecord(null, "bad rec")).toThrow("bad rec");
    expect(errorMessage("plain")).toBe("plain");
    expect(
      formatDiagnostic({
        code: "E1",
        severity: "error",
        message: "bad",
      }),
    ).toBe("error [E1]: bad");
    expect(
      formatDiagnostic({
        code: "W1",
        severity: "warning",
        message: "warn",
        location: "GET /a",
      }),
    ).toBe("warning [W1] (GET /a): warn");

    expect(escapeIdentifier("", "fallback")).toBe("fallback");
    expect(toCamelCase("---", "empty")).toBe("empty");
    expect(toCamelCase("123_abc", "v")).toBe("_123Abc");
    expect(toCamelCase("default", "v")).toBe("default_");
    expect(toPascalCase("---", "FallbackSchema")).toBe("FallbackSchema");
    expect(toKebabCase("---", "default")).toBe("default");

    const unique = createUniqueNamer(["seed"]);
    expect(unique("seed")).toBe("seed2");
    expect(unique("order")).toBe("order");
    expect(unique("order")).toBe("order2");
    expect(unique("order")).toBe("order3");
  });
});
