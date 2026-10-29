import { expect, test } from "vitest";
import { dirname, resolve } from "node:path";
import { apiEntries } from "./api-catalog";
import { extractApiData } from "../../scripts/extract-api";
import {
  serializeCatalog,
  serializeReference,
  serializeSummaries,
} from "../../scripts/api-model";
import { assertDescribed } from "../../scripts/api-validate";

const packages = ["core", "react", "vue", "opentelemetry-server"];
const entryOf = (pkg: string) =>
  resolve(import.meta.dirname, `../../../packages/${pkg}/src/index.ts`);

const understoodExport =
  /^export\s+(?:type\s+)?\{[^}]*\}(?:\s+from\s+['"][^'"]+['"])?|^export\s+\*\s+from\s+['"][^'"]+['"]|^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:type|interface|class|enum|function|const)\s+\w+/;

/**
 * Every name a module exports. Type-only exports have no runtime presence, so their names are read from the source
 * (`export { a }`, `export type { a } from`, `export type|interface|class|enum|function|const a`, and `export *` followed
 * recursively). Any other `export` statement is rejected, so an unread form cannot pass the catalog check.
 */
async function sourceExports(
  file: string,
  visited = new Set<string>(),
): Promise<Set<string>> {
  if (visited.has(file)) return new Set();
  visited.add(file);
  const text = (await Bun.file(file).text()).replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      "",
    ),
    names = new Set<string>();
  for (const match of text.matchAll(/(?:^|[;\n])[ \t]*export\b/g)) {
    const statement = text.slice(
      (match.index ?? 0) + match[0].length - "export".length,
    );
    if (!understoodExport.test(statement))
      throw new Error(
        `Unrecognized export in ${file}: ${statement.split("\n", 1)[0]}`,
      );
  }
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g))
    for (const name of (match[1] ?? "").split(",")) {
      const clean = name
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1);
      if (clean) names.add(clean);
    }
  for (const match of text.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:type|interface|class|enum|function|const)\s+(\w+)/g,
  ))
    if (match[1]) names.add(match[1]);
  for (const match of text.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const base = resolve(dirname(file), match[1] ?? "");
    const target = (await Bun.file(base + ".ts").exists())
      ? base + ".ts"
      : resolve(base, "index.ts");
    for (const name of await sourceExports(target, visited)) names.add(name);
  }
  return names;
}

/** A class declares a type, and the catalog has no separate class kind. */
function runtimeKind(value: unknown): string {
  if (typeof value !== "function") return "constant";
  return /^class\b/.test(Function.prototype.toString.call(value))
    ? "type"
    : "function";
}

test.each(packages)(
  "@defjs/%s catalog matches its public exports, in both directions, with the right kind",
  async (pkg) => {
    const runtime: Record<string, unknown> = await import(entryOf(pkg)),
      names = await sourceExports(entryOf(pkg)),
      catalog = new Map(
        apiEntries
          .filter(
            (entry) =>
              entry.package === `@defjs/${pkg}` &&
              !entry.name.startsWith("struct."),
          )
          .map((entry) => [entry.name, entry.kind]),
      );
    expect(Object.keys(runtime).filter((name) => !names.has(name))).toEqual([]);
    expect([...names].filter((name) => !catalog.has(name))).toEqual([]);
    expect([...catalog.keys()].filter((name) => !names.has(name))).toEqual([]);
    const wrongKinds = [...catalog].filter(
      ([name, kind]) =>
        kind !== (name in runtime ? runtimeKind(runtime[name]) : "type"),
    );
    expect(wrongKinds).toEqual([]);
  },
);

test("struct.* catalog entries are exactly the struct facade members", async () => {
  const { struct } = await import(entryOf("core")),
    members = apiEntries.filter(
      (entry) =>
        entry.package === "@defjs/core" && entry.name.startsWith("struct."),
    );
  expect(
    members.map((entry) => entry.name.slice("struct.".length)).sort(),
  ).toEqual(Object.keys(struct).sort());
  expect(members.filter((entry) => entry.kind !== "function")).toEqual([]);
});

test("regenerating the API data matches the committed JSON", async () => {
  const entries = await extractApiData();
  const directory = import.meta.dirname;
  expect(serializeCatalog(entries)).toBe(
    await Bun.file(resolve(directory, "api-entries.json")).text(),
  );
  expect(serializeReference(entries)).toBe(
    await Bun.file(resolve(directory, "api-reference.json")).text(),
  );
  expect(serializeSummaries(entries)).toBe(
    await Bun.file(resolve(directory, "api-summaries.json")).text(),
  );
}, 180_000);

test("generation lists public exports that have no description", () => {
  expect(() =>
    assertDescribed([
      { package: "@defjs/core", name: "Missing", description: " " },
    ]),
  ).toThrow("public exports missing a description:\n@defjs/core:Missing");
});
