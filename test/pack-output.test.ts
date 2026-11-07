import { expect, test } from "bun:test";
import { parsePackedFiles } from "./pack-output";

const files = [
  { path: "LICENSE" },
  { path: "README.md" },
  { path: "package.json" },
  { path: "index.js" },
];
const expected = ["LICENSE", "README.md", "package.json", "index.js"].sort();

test("npm 11 array output lists every packed file", () => {
  expect([...parsePackedFiles(JSON.stringify([{ files }]))].sort()).toEqual(
    expected,
  );
});

test("npm 12 keyed output lists every packed file", () => {
  const stdout = `\n${JSON.stringify({ "@defjs/core": { files } })}\n`;
  expect([...parsePackedFiles(stdout)].sort()).toEqual(expected);
});

test("the package/ prefix is removed", () => {
  const prefixed = files.map((file) => ({ path: `package/${file.path}` }));
  expect(
    [
      ...parsePackedFiles(
        JSON.stringify({ "defjs-pack-fixture": { files: prefixed } }),
      ),
    ].sort(),
  ).toEqual(expected);
});

test("output without a package yields no files", () => {
  expect(parsePackedFiles("[]").size).toBe(0);
  expect(parsePackedFiles("{}").size).toBe(0);
});

test("a package without a file list is rejected", () => {
  expect(() => parsePackedFiles('[{"name":"x"}]')).toThrow(
    "npm pack output has no list of packed files",
  );
  expect(() => parsePackedFiles('[{"files":[{"size":1}]}]')).toThrow(
    "npm pack output has no list of packed files",
  );
});
