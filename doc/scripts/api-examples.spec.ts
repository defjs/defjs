import { afterEach, expect, test } from "vitest";
import { loadExample, readExampleRegion, readText } from "./api-examples";
import { joinPath } from "./paths";
import { removeDirectory, tempDirectory } from "./tmp";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) removeDirectory(root);
});

test("example regions keep their body and reject a missing marker", async () => {
  const docRoot = joinPath(import.meta.dirname, "..");
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
  const root = tempDirectory("defjs-example");
  roots.push(root);
  await expect(readText(joinPath(root, "missing.ts"))).rejects.toThrow(
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
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the value under test is thrown or rejected unchanged
      Promise.reject("disk"),
    ),
  ).rejects.toThrow("disk");
  await Bun.write(
    joinPath(root, "sample.ts"),
    "// #region example\nconst n = 1;\n// #endregion\n",
  );
  await expect(readText(joinPath(root, "sample.ts"))).resolves.toContain(
    "const n = 1;",
  );
});
