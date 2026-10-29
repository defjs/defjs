import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadExample, readExampleRegion, readText } from "./api-examples";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("example regions keep their body and reject a missing marker", async () => {
  const docRoot = join(import.meta.dirname, "..");
  const loaded = await loadExample(
    docRoot,
    "examples/api/create-client.ts#example",
  );
  expect(loaded.code).toContain("createClient");
  expect(loaded.code.endsWith("\n")).toBe(false);
  expect(() => readExampleRegion("const n = 1;\n", "example")).toThrow(
    "missing #region example",
  );
  expect(() => readExampleRegion("// #region example", "example")).toThrow(
    "missing #region example body",
  );
  expect(() =>
    readExampleRegion("// #region example\nconst n = 1;\n", "example"),
  ).toThrow("missing #endregion");
  const root = await mkdtemp(join(tmpdir(), "defjs-example-"));
  roots.push(root);
  await expect(readText(join(root, "missing.ts"))).rejects.toThrow(
    "missing example file",
  );
  await expect(
    loadExample(docRoot, "examples/api/create-client.ts#example", () =>
      Promise.reject(new Error("disk")),
    ),
  ).rejects.toThrow(
    "failed to read @exampleFile examples/api/create-client.ts#example: disk",
  );
  await expect(
    loadExample(docRoot, "examples/api/create-client.ts#example", () =>
      Promise.reject("disk"),
    ),
  ).rejects.toThrow("disk");
  await writeFile(
    join(root, "sample.ts"),
    "// #region example\nconst n = 1;\n// #endregion\n",
  );
  await expect(readText(join(root, "sample.ts"))).resolves.toContain(
    "const n = 1;",
  );
});
