import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  serializeCatalog,
  serializeReference,
  serializeSummaries,
} from "./api-model";
import type { ApiReferenceEntry } from "./api-model";
import {
  ambientDeclaration,
  assertSignatureSyntax,
  declarationCategory,
  fumadocsEntry,
  functionTypeOf,
  specifierIsTypeOnly,
  syntaxOffender,
  SyntaxKind,
  outputDirectory,
  resolveAlias,
  syntheticQuery,
  typeAliasHasMembers,
  typeTableQuery,
  writeExtractedApi,
} from "./extract-api";

const entry: ApiReferenceEntry = {
  package: "@defjs/core",
  name: "Client",
  kind: "type",
  slug: "core/client-type",
  source: "packages/core/src/client/client.ts",
  group: "client",
  description: "A client.",
  signatures: ["type Client = { readonly id: string; };"],
  related: [],
  exampleFiles: [],
  returns: [],
  throws: [],
  tags: [],
  typeTable: null,
  parameters: [],
  overloads: [
    {
      signature: "type Client = { readonly id: string; };",
      parameters: [],
      returns: [],
    },
  ],
};

test("declaration category follows the syntax kind", () => {
  expect(declarationCategory(SyntaxKind.FunctionDeclaration)).toBe("function");
  expect(declarationCategory(SyntaxKind.ClassDeclaration)).toBe("class");
  expect(declarationCategory(SyntaxKind.VariableDeclaration)).toBe("variable");
  expect(declarationCategory(SyntaxKind.InterfaceDeclaration)).toBe("type");
});

test("type-only exports are recognized from the specifier or its declaration", () => {
  expect(specifierIsTypeOnly({ kind: SyntaxKind.FunctionDeclaration })).toBe(
    false,
  );
  expect(
    specifierIsTypeOnly({ kind: SyntaxKind.ExportSpecifier, isTypeOnly: true }),
  ).toBe(true);
  expect(specifierIsTypeOnly({ kind: SyntaxKind.ExportSpecifier })).toBe(false);
  expect(
    specifierIsTypeOnly({
      kind: SyntaxKind.ExportSpecifier,
      parent: { kind: SyntaxKind.FunctionDeclaration },
    }),
  ).toBe(false);
  expect(
    specifierIsTypeOnly({
      kind: SyntaxKind.ExportSpecifier,
      parent: { kind: SyntaxKind.NamedExports },
    }),
  ).toBe(false);
  expect(
    specifierIsTypeOnly({
      kind: SyntaxKind.ExportSpecifier,
      parent: {
        kind: SyntaxKind.NamedExports,
        parent: { kind: SyntaxKind.FunctionDeclaration, isTypeOnly: true },
      },
    }),
  ).toBe(false);
  expect(
    specifierIsTypeOnly({
      kind: SyntaxKind.ExportSpecifier,
      parent: {
        kind: SyntaxKind.NamedExports,
        parent: { kind: SyntaxKind.ExportDeclaration, isTypeOnly: true },
      },
    }),
  ).toBe(true);
  expect(
    specifierIsTypeOnly({
      kind: SyntaxKind.ExportSpecifier,
      parent: {
        kind: SyntaxKind.NamedExports,
        parent: { kind: SyntaxKind.ExportDeclaration, isTypeOnly: false },
      },
    }),
  ).toBe(false);
});

test("function types unwrap parentheses and ignore other types", () => {
  const fn = { kind: SyntaxKind.FunctionType };
  expect(
    functionTypeOf({
      kind: SyntaxKind.ParenthesizedType,
      type: { kind: SyntaxKind.ParenthesizedType, type: fn },
    }),
  ).toBe(fn);
  expect(
    functionTypeOf({ kind: SyntaxKind.ParenthesizedType }),
  ).toBeUndefined();
  expect(functionTypeOf(fn)).toBe(fn);
  expect(functionTypeOf({ kind: SyntaxKind.ConstructorType })).toEqual({
    kind: SyntaxKind.ConstructorType,
  });
  expect(functionTypeOf({ kind: SyntaxKind.TypeLiteral })).toBeUndefined();
});

test("fumadocs entries keep a type link only when one was generated", () => {
  const base = {
    name: "id",
    description: "Identifier.",
    type: "string",
    simplifiedType: "string",
    required: true,
    deprecated: false,
    tags: [{ name: "example", text: "n" }],
  };
  expect(fumadocsEntry(base).typeHref).toBeUndefined();
  expect(fumadocsEntry({ ...base, typeHref: "#id" }).typeHref).toBe("#id");
});

test("empty parameter lists, hidden tables, and non-aliases stay inert", async () => {
  const build = () => "built";
  expect(syntheticQuery(0, build)).toBe("");
  expect(syntheticQuery(1, build)).toBe("built");
  expect(typeTableQuery(false, "a.ts", "Client")).toBeNull();
  expect(typeTableQuery(true, "a.ts", "Client")).toEqual({
    file: "a.ts",
    query: "Client",
  });
  const plain = { flags: 0 };
  const resolve = async (symbol: { flags: number }) => ({
    flags: symbol.flags + 1,
  });
  expect(await resolveAlias(plain, 1, resolve)).toBe(plain);
  expect(await resolveAlias({ flags: 1 }, 1, resolve)).toEqual({ flags: 2 });
  expect(outputDirectory(undefined, "fallback")).toBe("fallback");
  expect(outputDirectory("dir", "fallback")).toBe("dir");
});

test("extracted JSON is written as catalog, reference and summary files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "defjs-api-"));
  await writeExtractedApi([entry], directory);
  expect(await Bun.file(join(directory, "api-entries.json")).text()).toBe(
    serializeCatalog([entry]),
  );
  expect(await Bun.file(join(directory, "api-reference.json")).text()).toBe(
    serializeReference([entry]),
  );
  expect(await Bun.file(join(directory, "api-summaries.json")).text()).toBe(
    serializeSummaries([entry]),
  );
  await rm(directory, { recursive: true });
});

test("generation fails when a signature is not valid TypeScript", async () => {
  await assertSignatureSyntax([]);
  await assertSignatureSyntax([
    { package: "@defjs/core", name: "struct", signatures: [] },
  ]);
  await assertSignatureSyntax([
    {
      package: "@defjs/core",
      name: "ClientWebSocketOptions",
      signatures: [
        "interface ClientWebSocketOptions {\n  message?: <T = unknown>() => T | unknown;\n}",
      ],
    },
    {
      package: "@defjs/core",
      name: "StructError",
      signatures: [
        "class StructError extends Error {\n  readonly issues: StructIssue[];\n  constructor(issues: StructIssue[]);\n}",
      ],
    },
    {
      package: "@defjs/core",
      name: "executeHttpCommand",
      signatures: [
        "function executeHttpCommand(clientConfig: HttpClientConfig): Promise<void>;",
      ],
    },
    {
      package: "@defjs/core",
      name: "STRUCT",
      signatures: ["const STRUCT: unique symbol;"],
    },
    {
      package: "@defjs/core",
      name: "HttpMeta",
      signatures: ["type HttpMeta = {\n  readonly ok: boolean;\n};"],
    },
    {
      package: "@defjs/core",
      name: "struct.enum",
      signatures: ["function enum<const T>(value: T): Struct<T, T>;"],
    },
    {
      package: "@defjs/core",
      name: "struct.null",
      signatures: ["function null(): Struct<null, null>;"],
    },
  ]);
  let caught = "";
  try {
    await assertSignatureSyntax([
      {
        package: "@defjs/core",
        name: "Ok",
        signatures: ["function ok(x: string): void;"],
      },
      {
        package: "@defjs/core",
        name: "StructError",
        signatures: ["class StructError extends Error;"],
      },
      {
        package: "@defjs/core",
        name: "Broken",
        signatures: ["function broken(x: ): void;"],
      },
      {
        package: "@defjs/core",
        name: "struct.enum",
        signatures: ["function enum(x: ): void;"],
      },
    ]);
  } catch (error) {
    caught = error instanceof Error ? error.message : String(error);
  }
  expect(caught).toContain("@defjs/core:StructError");
  expect(caught).toContain("@defjs/core:Broken");
  expect(caught).toContain("@defjs/core:struct.enum");
  expect(caught.includes("@defjs/core:Ok")).toBe(false);
  expect(
    syntaxOffender(["/a.d.ts"], ["@defjs/core:Ok"], {
      fileName: "/a.d.ts",
      text: "bad",
    }),
  ).toBe("@defjs/core:Ok (bad)");
  expect(
    syntaxOffender(["/a.d.ts"], ["@defjs/core:Ok"], {
      fileName: "/missing.d.ts",
      text: "bad",
    }),
  ).toBe("/missing.d.ts (bad)");
  expect(syntaxOffender(["/a.d.ts"], ["@defjs/core:Ok"], { text: "bad" })).toBe(
    "signature (bad)",
  );
  expect(ambientDeclaration("type Foo = string;")).toBe("type Foo = string;");
  expect(ambientDeclaration("interface Foo {}")).toBe("interface Foo {}");
  expect(ambientDeclaration("function f(): void;")).toBe(
    "declare function f(): void;",
  );
  expect(ambientDeclaration("function enum<const T>(value: T): void;")).toBe(
    "declare function enumMember<const T>(value: T): void;",
  );
  expect(ambientDeclaration("function null(): void;")).toBe(
    "declare function nullMember(): void;",
  );
  expect(ambientDeclaration("  class Foo {}")).toBe("declare class Foo {}");
  expect(ambientDeclaration("const x: string;")).toBe(
    "declare const x: string;",
  );
});

test("only object-shaped aliases keep a member table", () => {
  expect(typeAliasHasMembers({ kind: SyntaxKind.TypeAliasDeclaration })).toBe(
    false,
  );
  expect(
    typeAliasHasMembers({
      kind: SyntaxKind.TypeAliasDeclaration,
      type: { kind: SyntaxKind.TypeLiteral },
    }),
  ).toBe(true);
  expect(
    typeAliasHasMembers({
      kind: SyntaxKind.TypeAliasDeclaration,
      type: { kind: SyntaxKind.IntersectionType },
    }),
  ).toBe(true);
  expect(
    typeAliasHasMembers({
      kind: SyntaxKind.TypeAliasDeclaration,
      type: { kind: SyntaxKind.UnionType },
    }),
  ).toBe(false);
  expect(
    typeAliasHasMembers({
      kind: SyntaxKind.TypeAliasDeclaration,
      type: {
        kind: SyntaxKind.ParenthesizedType,
        type: { kind: SyntaxKind.TypeLiteral },
      },
    }),
  ).toBe(true);
  expect(
    typeAliasHasMembers({
      kind: SyntaxKind.TypeAliasDeclaration,
      type: { kind: SyntaxKind.ParenthesizedType },
    }),
  ).toBe(false);
});
