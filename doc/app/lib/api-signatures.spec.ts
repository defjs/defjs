import { expect, test } from "vitest";
import { structure } from "fumadocs-core/mdx-plugins/remark-structure";
import { createStringifier } from "fumadocs-core/mdx-plugins/stringifier";
import {
  apiReferenceFile,
  handCopiedGeneratedNames,
  readSignatureCatalog,
  remarkApiSignatures,
  replaceApiSignatures,
  signatureCatalog,
  signatureFile,
  signatureText,
  type SignatureCatalog,
  type SignatureContent,
  type SignatureEntry,
  type SignatureRoot,
  type SignatureSourceFile,
} from "./api-signatures";

const entries: SignatureEntry[] = [
  {
    name: "withEndpoint",
    overloads: [
      { signature: "function withEndpoint(endpoint: string): ClientOption;" },
    ],
  },
  {
    name: "struct.enum",
    overloads: [
      { signature: "function enum<T>(value: T): Struct;" },
      { signature: "function enum<T>(value: T): Other;" },
    ],
  },
  {
    name: "ERR_ABORTED",
    overloads: [{ signature: " const ERR_ABORTED: Error; " }],
  },
];
const catalog: SignatureCatalog = signatureCatalog(entries);

function tag(
  name: string,
): Extract<SignatureContent, { type: "mdxJsxFlowElement" }> {
  return {
    type: "mdxJsxFlowElement",
    name: "ApiSignature",
    attributes: [{ type: "mdxJsxAttribute", name: "name", value: name }],
    children: [],
  };
}

function inlineTag(
  name: string,
): Extract<SignatureContent, { type: "mdxJsxTextElement" }> {
  return {
    type: "mdxJsxTextElement",
    name: "ApiSignature",
    attributes: [{ type: "mdxJsxAttribute", name: "name", value: name }],
    children: [],
  };
}

/** The VFile remark hands to a plugin, so fixtures are real files without a direct vfile dependency. */
function sourceFile(path?: string, value = ""): SignatureSourceFile {
  const files: SignatureSourceFile[] = [];
  structure(value, [
    () => (_root: SignatureRoot, file: SignatureSourceFile) => {
      files.push(file);
    },
  ]);
  const [file] = files;
  if (!file) throw new Error("remark passed no file to the plugin");
  if (path !== undefined) file.path = path;
  return file;
}

function span(end: number) {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 2, column: 1, offset: end },
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
      { name: "A", overloads: [{ signature: "type A = 1;" }] },
      { name: "A", overloads: [{ signature: "type A = 2;" }] },
    ]),
  ).toThrow('Ambiguous API signature "A"');
  const empty = signatureCatalog([{ name: "A", overloads: [] }]);
  expect(() => signatureText(empty, "A", "page.mdx")).toThrow(
    'API signature "A" has no text in page.mdx',
  );
});

test("the remark plugin replaces signature tags and leaves other nodes", () => {
  const tree = {
    type: "root",
    children: [
      undefined,
      {
        type: "paragraph",
        children: [inlineTag("withEndpoint")],
      } satisfies SignatureContent,
      {
        type: "mdxJsxTextElement",
        name: "Other",
        attributes: [],
        children: [],
      } satisfies SignatureContent,
      inlineTag("ERR_ABORTED"),
    ],
  };
  replaceApiSignatures(
    // @ts-expect-error the sparse fixture deliberately tests a missing child node
    tree,
    sourceFile("doc/content/en-US/api/http.mdx"),
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
  const source = '<ApiSignature name="withEndpoint" />\n';
  const authored = sourceFile("page.mdx", source);
  const signature = {
    ...tag("withEndpoint"),
    position: span(source.length),
  };
  const root: SignatureRoot = {
    type: "root",
    position: span(source.length),
    children: [signature],
  };
  replaceApiSignatures(root, authored, catalog);
  const processed = createStringifier(authored).stringify(root);
  expect(processed).toContain(
    "function withEndpoint(endpoint: string): ClientOption;",
  );
  expect(processed).not.toContain("ApiSignature");
  const markdown = sourceFile(
    "interceptors.md",
    '<ApiSignature name="withEndpoint" />\n',
  );
  const markdownRoot: SignatureRoot = {
    type: "root",
    children: [
      {
        type: "html",
        value: '<ApiSignature name="withEndpoint" />',
        position: span(40),
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
  expect(() =>
    replaceApiSignatures(
      {
        type: "root",
        children: [{ type: "html", value: "<ApiSignature />" }],
      },
      sourceFile("interceptors.md"),
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
        children: [
          {
            type: "mdxJsxFlowElement",
            name: "ApiSignature",
            attributes: [],
            children: [],
          },
        ],
      },
      sourceFile("only.mdx"),
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
              { type: "mdxJsxExpressionAttribute", value: "...props" },
              { type: "mdxJsxAttribute", name: "name", value: null },
            ],
            children: [],
          },
        ],
      },
      sourceFile(),
      catalog,
    ),
  ).toThrow("API signature name in unknown file must be a string");
});

test("a code fence keeps an unknown signature tag literal", () => {
  const root: SignatureRoot = {
    type: "root",
    children: [
      {
        type: "code",
        lang: "ts",
        value: '<ApiSignature name="Missing" />',
      },
    ],
  };
  replaceApiSignatures(root, sourceFile("http.mdx"), catalog);
  expect(root.children[0]).toEqual({
    type: "code",
    lang: "ts",
    value: '<ApiSignature name="Missing" />',
  });
});

test("the documentation catalog loads from disk and renders a real signature", async () => {
  const transform = remarkApiSignatures();
  await transform({ type: "root", children: [] }, sourceFile("overview.mdx"));
  const tree: SignatureRoot = { type: "root", children: [tag("createClient")] };
  await transform(tree, sourceFile("overview.mdx"));
  const rendered = tree.children[0];
  if (!rendered || !("value" in rendered) || typeof rendered.value !== "string")
    throw new Error("expected a rendered signature");
  expect(rendered.value).toContain("function createClient");
  await expect(
    transform(
      { type: "root", children: [tag("NotAnExport")] },
      sourceFile("overview.mdx"),
    ),
  ).rejects.toThrow('Unknown API signature "NotAnExport" in overview.mdx');
});

test("catalog lookup follows the documentation workspace or the repository root", async () => {
  const workspace = `${Bun.env["TMPDIR"] ?? "/tmp"}/defjs-signatures-${crypto.randomUUID()}`;
  try {
    expect(() => apiReferenceFile(workspace)).toThrow(
      `Cannot find api-reference.json from ${workspace}`,
    );
    const nested = `${workspace}/doc/app/data`;
    await Bun.write(`${nested}/.keep`, "");
    await Bun.write(
      `${nested}/api-reference.json`,
      JSON.stringify([
        { name: "FromRoot", overloads: [{ signature: "type FromRoot = 1;" }] },
      ]),
    );
    expect(
      (await readSignatureCatalog(apiReferenceFile(workspace))).get("FromRoot"),
    ).toEqual(["type FromRoot = 1;"]);
    // A separate file: a version of a file is told apart by its modification time, which two writes in a row can share.
    const docRoot = `${workspace}/inside-doc`;
    await Bun.write(`${docRoot}/app/data/.keep`, "");
    await Bun.write(
      `${docRoot}/app/data/api-reference.json`,
      JSON.stringify([
        { name: "FromDoc", overloads: [{ signature: "type FromDoc = 2;" }] },
      ]),
    );
    const fromDoc = apiReferenceFile(docRoot);
    expect((await readSignatureCatalog(fromDoc)).get("FromDoc")).toEqual([
      "type FromDoc = 2;",
    ]);
    // One file per content, for the same reason.
    const notJson = `${workspace}/not-json.json`;
    await Bun.write(notJson, "not json");
    await expect(readSignatureCatalog(notJson)).rejects.toThrow(
      `Cannot read API signatures from ${notJson}`,
    );
    // A failed read is not cached: the same file is read again once it is fixed.
    await Bun.write(
      notJson,
      JSON.stringify([
        { name: "Fixed", overloads: [{ signature: "type Fixed = 3;" }] },
      ]),
    );
    expect((await readSignatureCatalog(notJson)).get("Fixed")).toEqual([
      "type Fixed = 3;",
    ]);
  } finally {
    Bun.spawnSync(["rm", "-rf", workspace]);
  }
});

test("fences keep example code and reject a hand-copied generated entry", async () => {
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
  const root = `${import.meta.dirname}/../../content`;
  const hits: string[] = [];
  const generatedNames = new Set(
    (await readSignatureCatalog(apiReferenceFile())).keys(),
  );
  for (const locale of new Bun.Glob("*").scanSync(root)) {
    const dir = `${root}/${locale}/api`;
    for (const file of new Bun.Glob("*").scanSync(dir)) {
      if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;
      const path = `${dir}/${file}`;
      for (const hit of handCopiedGeneratedNames(
        await Bun.file(path).text(),
        generatedNames,
      ))
        hits.push(
          `hand-copied signature of a generated entry: ${locale}/api/${file} ${hit.name}`,
        );
    }
  }
  if (hits.length > 0) throw new Error(hits.join("\n"));
});
