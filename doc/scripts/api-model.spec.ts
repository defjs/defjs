import { expect, test } from "vitest";
import {
  catalogKind,
  defined,
  expandParameterList,
  isBindingPattern,
  lookupDescription,
  memberDescription,
  namedParameterType,
  parameterRequired,
  requireNode,
  formatJsonDocument,
  preferredParameterType,
  serializeCatalog,
  serializeReference,
  serializeSummaries,
  stableMemberName,
  storedEntry,
  typeOnlyExport,
  visibleMembers,
} from "./api-model";
import type { ApiReferenceEntry, StoredEntry } from "./api-model";

const row = (name: string, typeHref?: string): StoredEntry => ({
  name,
  description: "Field.",
  type: "string",
  simplifiedType: "string",
  required: true,
  deprecated: false,
  tags: [{ name: "example", text: "n" }],
  typeHref,
});

test("model helpers keep stable names, kinds, and parameter rows", () => {
  expect(defined("ok", "value")).toBe("ok");
  expect(() => defined(undefined, "value")).toThrow("missing value");
  expect(
    catalogKind({ typeOnlyExport: true, declarationKind: "function" }),
  ).toBe("type");
  expect(catalogKind({ typeOnlyExport: false, declarationKind: "class" })).toBe(
    "type",
  );
  expect(catalogKind({ typeOnlyExport: false, declarationKind: "type" })).toBe(
    "type",
  );
  expect(
    catalogKind({ typeOnlyExport: false, declarationKind: "function" }),
  ).toBe("function");
  expect(
    catalogKind({ typeOnlyExport: false, declarationKind: "variable" }),
  ).toBe("constant");
  expect(
    parameterRequired({ rest: true, optional: false, initialized: false }),
  ).toBe(false);
  expect(
    parameterRequired({ rest: false, optional: true, initialized: false }),
  ).toBe(false);
  expect(
    parameterRequired({ rest: false, optional: false, initialized: true }),
  ).toBe(false);
  expect(
    parameterRequired({ rest: false, optional: false, initialized: false }),
  ).toBe(true);
  expect(typeOnlyExport([])).toBe(false);
  expect(typeOnlyExport([true, true])).toBe(true);
  expect(typeOnlyExport([true, false])).toBe(false);
  const isNamed = (node: { name?: string }): node is { name: string } =>
    node.name !== undefined;
  const named = { name: "x" };
  expect(requireNode(named, isNamed, "not named")).toBe(named);
  expect(() => requireNode({}, isNamed, "not named")).toThrow("not named");
  expect(() => stableMemberName("__@CLIENT@1")).toThrow("unstable member name");
  expect(() => stableMemberName("__#CLIENT")).toThrow("unstable member name");
  expect(stableMemberName("[CLIENT]")).toBe("[CLIENT]");
  expect(lookupDescription(null, "any")).toBe("");
  expect(lookupDescription(new Map([["any", "Any value."]]), "missing")).toBe(
    "",
  );
  expect(lookupDescription(new Map([["any", "Any value."]]), "any")).toBe(
    "Any value.",
  );
  expect(memberDescription(" from the table ", "from the target")).toBe(
    "from the table",
  );
  expect(memberDescription(" ", "from the target")).toBe("from the target");
  expect(isBindingPattern("{ client, children }")).toBe(true);
  expect(isBindingPattern("[first]")).toBe(true);
  expect(isBindingPattern("options")).toBe(false);
  expect(namedParameterType(" ClientProviderProps ")).toBe(
    "ClientProviderProps",
  );
  expect(namedParameterType("{ client: Client }")).toBeUndefined();
  const props = new Map([
    [
      "ClientProviderProps",
      [row("client"), { ...row("children", "#children"), required: false }],
    ],
  ]);
  const expanded = expandParameterList(
    [
      {
        ...row("options"),
        name: "{ client, children }",
        type: "ClientProviderProps",
      },
      row("options"),
      { ...row("pair"), name: "{ left, right }", type: "{ left: string }" },
    ],
    props,
  );
  expect(expanded.map((item) => item.name)).toEqual([
    "client",
    "children",
    "options",
    "{ left, right }",
  ]);
  expect(defined(expanded[1], "children").required).toBe(false);
  expect(defined(expanded[1], "children").typeHref).toBe("#children");
  expect(defined(expanded[0], "client").typeHref).toBeUndefined();
  expect(() =>
    expandParameterList(
      [{ ...row("props"), name: "{ value }", type: "Missing" }],
      props,
    ),
  ).toThrow("binding parameter type has no member table: Missing");
  expect(() =>
    expandParameterList(
      [{ ...row("props"), name: "{ value }", type: "Empty" }],
      new Map([["Empty", []]]),
    ),
  ).toThrow("binding parameter type has no member table: Empty");
  expect(
    storedEntry({ ...row("id"), typeHref: undefined }).typeHref,
  ).toBeUndefined();
  expect(storedEntry({ ...row("id"), typeHref: "#id" }).typeHref).toBe("#id");
});

test("serialized reference JSON uses a fixed field order", () => {
  const entry: ApiReferenceEntry = {
    package: "@defjs/core",
    name: "Client",
    kind: "type",
    slug: "core/client-type",
    source: "packages/core/src/client/client.ts",
    group: "client",
    description: "A client.",
    signatures: ["interface Client {}"],
    related: ["@defjs/core:HttpAwaitResult"],
    exampleFiles: [
      {
        path: "examples/api/create-client.ts",
        region: "example",
        code: "const n = 1;",
      },
    ],
    returns: [],
    throws: ["Error"],
    tags: [{ name: "example", text: "n" }],
    typeTable: null,
    parameters: [],
    overloads: [],
  };
  const withTable = serializeReference([
    {
      ...entry,
      typeTable: [row("id", "#id"), row("name")],
      parameters: [row("options")],
      overloads: [
        {
          signature: "function f(): void;",
          parameters: [row("options")],
          returns: [],
        },
      ],
    },
  ]);
  expect(withTable.match(/"typeHref"/g)?.length).toBe(1);
  expect(withTable).toContain('"typeHref": "#id"');
  expect(serializeReference([entry]).endsWith("\n")).toBe(true);
  expect(serializeCatalog([entry])).toContain('"slug": "core/client-type"');
  expect(serializeCatalog([entry])).toContain(
    '"related": ["@defjs/core:HttpAwaitResult"]',
  );
  expect(serializeCatalog([{ ...entry, related: [] }])).toContain(
    '"related": []',
  );
  expect(serializeCatalog([entry])).not.toContain("description");
  const wide = serializeCatalog([
    {
      ...entry,
      related: [
        "@defjs/opentelemetry-server:OpenTelemetryServerHttpOptions",
        "@defjs/opentelemetry-server:OpenTelemetryServerSSEOptions",
      ],
    },
  ]);
  expect(wide).toContain(
    '"related": [\n      "@defjs/opentelemetry-server:OpenTelemetryServerHttpOptions",\n      "@defjs/opentelemetry-server:OpenTelemetryServerSSEOptions"\n    ]',
  );
});

test("bun fmt failures name the document", () => {
  const fail = (stderr: string, stdout: string) => () =>
    formatJsonDocument("[]\n", "api-entries.json", () => ({
      status: 1,
      stdout,
      stderr,
    }));
  expect(fail("bad json", "")).toThrow(
    "bun fmt failed for api-entries.json: bad json",
  );
  expect(fail(" ", "stdout says why")).toThrow("stdout says why");
  expect(fail(" ", " ")).toThrow(
    "bun fmt failed for api-entries.json: no output",
  );
});

test("parameter types prefer the declaration when the generated form is a helper expansion", () => {
  expect(preferredParameterType("Declared", "{ output?: never }")).toBe(
    "Declared",
  );
  expect(preferredParameterType("short", "x".repeat(90))).toBe("short");
  expect(preferredParameterType("unknown", "string")).toBe("string");
  expect(preferredParameterType("", "string")).toBe("string");
  expect(preferredParameterType("string", "string")).toBe("string");
});

test("member tables drop tuple indexes, undocumented symbols and internal rows", () => {
  const kept = row("id");
  expect(
    visibleMembers([
      { ...kept, name: "0" },
      { ...kept, name: "1" },
      { ...kept, name: "length" },
      kept,
    ]).map((item) => item.name),
  ).toEqual(["id"]);
  expect(
    visibleMembers([
      { ...kept, name: "length", description: "real" },
      {
        ...kept,
        name: "[COMMAND_EXECUTE]",
        description: "",
      },
      {
        ...kept,
        name: "[CLIENT]",
        description: "Internal symbol key.",
      },
      {
        ...kept,
        name: "secret",
        tags: [{ name: "internal", text: "" }],
      },
    ]).map((item) => item.name),
  ).toEqual(["length", "[CLIENT]"]);
});

test("summaries keep the first paragraph and the reference records its source file", () => {
  const entry: ApiReferenceEntry = {
    package: "@defjs/core",
    name: "Client",
    kind: "type",
    slug: "core/client-type",
    source: "packages/core/src/client/client.ts",
    group: "client",
    description: "A client.\n\nMore.",
    signatures: [],
    related: [],
    exampleFiles: [],
    returns: [],
    throws: [],
    tags: [],
    typeTable: null,
    parameters: [],
    overloads: [],
  };
  expect(serializeSummaries([entry])).toContain('"description": "A client."');
  expect(serializeSummaries([entry])).not.toContain("More");
  expect(serializeReference([entry])).toContain(
    '"source": "packages/core/src/client/client.ts"',
  );
  expect(serializeCatalog([entry])).not.toContain("source");
});
