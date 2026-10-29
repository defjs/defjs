import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createStringifier } from "fumadocs-core/mdx-plugins/stringifier";
import { readableMarkdown } from "./markdown";
import {
  apiReferenceFile,
  expandApiSignatureTags,
  handCopiedGeneratedNames,
  readSignatureCatalog,
  remarkApiSignatures,
  replaceApiSignatures,
  signatureCatalog,
  signatureFile,
  signatureText,
  type SignatureCatalog,
  type SignatureEntry,
} from "./api-signatures";

const entries: SignatureEntry[] = [
  {
    name: "withEndpoint",
    signatures: ["function withEndpoint(endpoint: string): ClientOption;"],
  },
  {
    name: "struct.enum",
    signatures: [
      "function enum<T>(value: T): Struct;",
      "function enum<T>(value: T): Other;",
    ],
  },
  { name: "ERR_ABORTED", signatures: [" const ERR_ABORTED: Error; "] },
];
const catalog: SignatureCatalog = signatureCatalog(entries);

function tag(name: string) {
  return {
    type: "mdxJsxFlowElement",
    name: "ApiSignature",
    attributes: [{ type: "mdxJsxAttribute", name: "name", value: name }],
    children: [],
  };
}

test("signature text joins overloads and names, and rejects unknown or empty names", () => {
  expect(
    signatureText(catalog, " withEndpoint , struct.enum ", "page.mdx"),
  ).toBe(
    "function withEndpoint(endpoint: string): ClientOption;\n\nfunction enum<T>(value: T): Struct;\nfunction enum<T>(value: T): Other;",
  );
  expect(signatureText(catalog, "ERR_ABORTED", "page.mdx")).toBe(
    "const ERR_ABORTED: Error;",
  );
  expect(() => signatureText(catalog, " , ", "page.mdx")).toThrow(
    "Missing API signature name in page.mdx",
  );
  expect(() => signatureText(catalog, "Missing", "a.mdx")).toThrow(
    'Unknown API signature "Missing" in a.mdx',
  );
  expect(() =>
    signatureCatalog([
      { name: "A", signatures: ["type A = 1;"] },
      { name: "A", signatures: ["type A = 2;"] },
    ]),
  ).toThrow('Ambiguous API signature "A"');
  const empty = signatureCatalog([{ name: "A", signatures: [] }]);
  expect(() => signatureText(empty, "A", "page.mdx")).toThrow(
    'API signature "A" has no text in page.mdx',
  );
});

test("the remark plugin replaces signature tags and leaves other nodes", () => {
  const tree = {
    type: "root",
    children: [
      undefined,
      { type: "paragraph", children: [tag("withEndpoint")] },
      { type: "mdxJsxTextElement", name: "Other", children: [] },
      {
        type: "mdxJsxTextElement",
        name: "ApiSignature",
        attributes: [
          { type: "mdxJsxAttribute", name: "name", value: "ERR_ABORTED" },
        ],
      },
    ],
  };
  replaceApiSignatures(
    tree as never,
    { path: "doc/content/en-US/api/http.mdx" },
    catalog,
  );
  const paragraph = tree.children[1];
  expect(
    paragraph && "children" in paragraph && paragraph.children?.[0],
  ).toMatchObject({
    type: "code",
    lang: "ts",
    value: "function withEndpoint(endpoint: string): ClientOption;",
  });
  expect(tree.children[3]).toMatchObject({
    type: "code",
    value: "const ERR_ABORTED: Error;",
  });
  replaceApiSignatures({ type: "text" }, {}, catalog);
  const source = '<ApiSignature name="withEndpoint" />\n';
  const authored = {
    path: "page.mdx",
    toString() {
      return source;
    },
  };
  const signature = tag("withEndpoint");
  const root = {
    type: "root",
    position: { start: { offset: 0 }, end: { offset: source.length } },
    children: [signature],
  };
  Object.assign(signature, {
    position: { start: { offset: 0 }, end: { offset: source.length } },
  });
  replaceApiSignatures(root, authored, catalog);
  const processed = createStringifier(authored as never).stringify(
    root as never,
  );
  expect(processed).toContain(
    "function withEndpoint(endpoint: string): ClientOption;",
  );
  expect(processed).not.toContain("ApiSignature");
  const markdown = {
    path: "interceptors.md",
    toString() {
      return '<ApiSignature name="withEndpoint" />\n';
    },
  };
  const markdownRoot = {
    type: "root",
    children: [
      {
        type: "html",
        value: '<ApiSignature name="withEndpoint" />',
        position: { start: { offset: 0 }, end: { offset: 40 } },
      },
      { type: "html", value: "<div>keep</div>" },
    ],
  };
  replaceApiSignatures(markdownRoot, markdown, catalog);
  expect(markdownRoot.children[0]).toMatchObject({
    type: "code",
    value: "function withEndpoint(endpoint: string): ClientOption;",
  });
  expect(markdownRoot.children[1]).toMatchObject({ value: "<div>keep</div>" });
  replaceApiSignatures(
    { type: "root", children: [{ type: "html", value: "" }] },
    { path: "interceptors.md" },
    catalog,
  );
  expect(() =>
    replaceApiSignatures(
      {
        type: "root",
        children: [{ type: "html", value: "<ApiSignature />" }],
      },
      { path: "interceptors.md" },
      catalog,
    ),
  ).toThrow("API signature name in interceptors.md must be a string");
  expect(signatureFile({ path: "a.mdx" })).toBe("a.mdx");
  expect(signatureFile({ history: ["older", "newer.mdx"] })).toBe("newer.mdx");
  expect(signatureFile({})).toBe("unknown file");
  expect(() =>
    replaceApiSignatures(
      {
        type: "root",
        children: [{ type: "mdxJsxFlowElement", name: "ApiSignature" }],
      },
      { history: ["only.mdx"] },
      catalog,
    ),
  ).toThrow("API signature name in only.mdx must be a string");
  expect(() =>
    replaceApiSignatures(
      {
        type: "root",
        children: [
          {
            type: "mdxJsxFlowElement",
            name: "ApiSignature",
            attributes: [
              { type: "mdxJsxAttribute", name: "name", value: null },
            ],
          },
        ],
      },
      {},
      catalog,
    ),
  ).toThrow("API signature name in unknown file must be a string");
});

test("authored tags expand outside fences and unknown components never reach readable markdown", () => {
  const markdown = [
    '<ApiSignature name="withEndpoint" />',
    "",
    "```ts",
    '<ApiSignature name="Missing" />',
    "```",
    "",
  ].join("\n");
  const expanded = expandApiSignatureTags(markdown, catalog, "http.mdx");
  expect(expanded).toContain(
    "```ts\nfunction withEndpoint(endpoint: string): ClientOption;\n```",
  );
  expect(expanded).toContain('<ApiSignature name="Missing" />');
  expect(readableMarkdown(expanded, "en-US")).toContain(
    "function withEndpoint",
  );
  expect(() =>
    expandApiSignatureTags("<ApiSignature />", catalog, "http.mdx"),
  ).toThrow("Missing API signature name in http.mdx");
});

test("the documentation catalog loads from disk and renders a real signature", () => {
  const transform = remarkApiSignatures();
  transform({ type: "root" });
  const tree = { type: "root", children: [tag("createClient")] };
  transform(tree, { path: "overview.mdx" });
  expect((tree.children[0] as { value?: string } | undefined)?.value).toContain(
    "function createClient",
  );
  expect(() =>
    transform(
      { type: "root", children: [tag("NotAnExport")] },
      { path: "overview.mdx" },
    ),
  ).toThrow('Unknown API signature "NotAnExport" in overview.mdx');
});

test("catalog lookup follows the documentation workspace or the repository root", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "defjs-signatures-"));
  try {
    expect(() => apiReferenceFile(workspace)).toThrow(
      `Cannot find api-reference.json from ${workspace}`,
    );
    const nested = join(workspace, "doc/app/data");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, "api-reference.json"),
      JSON.stringify([
        { name: "FromRoot", signatures: ["type FromRoot = 1;"] },
      ]),
    );
    expect(
      readSignatureCatalog(apiReferenceFile(workspace)).get("FromRoot"),
    ).toEqual(["type FromRoot = 1;"]);
    const docRoot = join(workspace, "doc");
    mkdirSync(join(docRoot, "app/data"), { recursive: true });
    writeFileSync(
      join(docRoot, "app/data/api-reference.json"),
      JSON.stringify([{ name: "FromDoc", signatures: ["type FromDoc = 2;"] }]),
    );
    const fromDoc = apiReferenceFile(docRoot);
    expect(readSignatureCatalog(fromDoc).get("FromDoc")).toEqual([
      "type FromDoc = 2;",
    ]);
    expect(readSignatureCatalog(fromDoc).get("FromDoc")).toEqual([
      "type FromDoc = 2;",
    ]);
    writeFileSync(fromDoc, "{}");
    expect(() => readSignatureCatalog(fromDoc)).toThrow(
      "API reference is not a list",
    );
    writeFileSync(fromDoc, "not json");
    expect(() => readSignatureCatalog(fromDoc)).toThrow(
      `Cannot read API signatures from ${fromDoc}`,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("fences keep example code and reject a hand-copied generated entry", () => {
  const names = new Set(["createClient", "ERR_ABORTED"]);
  expect(
    handCopiedGeneratedNames(
      "function createClient(): Client;\n\n~~~ts\nfunction consume(): void;\n~~~\n\n````ts\n```\nconst ERR_ABORTED: Error;\n````\n\n```ts\nfunction createClient(): Client;\n```\n",
      names,
    ),
  ).toEqual([
    { name: "ERR_ABORTED", line: 9 },
    { name: "createClient", line: 13 },
  ]);
  const root = fileURLToPath(new URL("../../content", import.meta.url));
  const hits: string[] = [];
  for (const locale of readdirSync(root)) {
    const dir = join(root, locale, "api");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;
      const path = join(dir, file);
      const catalog = readSignatureCatalog(apiReferenceFile());
      for (const hit of handCopiedGeneratedNames(
        readFileSync(path, "utf8"),
        new Set(catalog.keys()),
      ))
        hits.push(
          `hand-copied signature of a generated entry: ${locale}/api/${file} ${hit.name}`,
        );
    }
  }
  if (hits.length > 0) throw new Error(hits.join("\n"));
});

test("overview pages expand every signature tag before readable markdown", () => {
  const root = fileURLToPath(new URL("../../content", import.meta.url));
  const loaded = readSignatureCatalog(apiReferenceFile());
  for (const locale of readdirSync(root)) {
    const dir = join(root, locale, "api");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;
      const path = `${locale}/api/${file}`;
      const source = readFileSync(join(dir, file), "utf8");
      const expanded = expandApiSignatureTags(source, loaded, path);
      expect(expanded).not.toContain("<ApiSignature");
      expect(readableMarkdown(expanded, locale)).not.toContain("<ApiSignature");
    }
  }
});
