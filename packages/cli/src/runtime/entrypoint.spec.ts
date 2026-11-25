import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { createTempDir } from "../../test/helpers.ts";
import { isDirectExecution } from "./entrypoint.ts";

describe("@defjs/cli entrypoint execution guard", () => {
  test("detects direct invocation and symlink aliases accurately", () => {
    const tmp = createTempDir("defjs-cli-entry-");
    const targetFile = join(tmp, "cli.js");
    const otherFile = join(tmp, "other.js");
    const symlinkFile = join(tmp, "bin-link");
    writeFileSync(targetFile, "// entry\n");
    writeFileSync(otherFile, "// other\n");
    symlinkSync(targetFile, symlinkFile);

    const targetUrl = pathToFileURL(targetFile).href;

    expect(isDirectExecution(undefined, targetUrl)).toBe(false);
    expect(isDirectExecution("", targetUrl)).toBe(false);
    expect(isDirectExecution(join(tmp, "missing.js"), targetUrl)).toBe(false);
    expect(isDirectExecution(otherFile, targetUrl)).toBe(false);
    expect(isDirectExecution(targetFile, targetUrl)).toBe(true);
    expect(isDirectExecution(symlinkFile, targetUrl)).toBe(true);
  });
});
