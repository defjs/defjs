import { expect, test } from "vitest";
import {
  assertDescribed,
  assertNoSiteLinks,
  identityIndex,
  resolveSee,
  singleGroup,
  validateReference,
} from "./api-validate";
import type { ApiReferenceEntry, StoredEntry } from "./api-model";

const client: ApiReferenceEntry = {
  package: "@defjs/core",
  name: "Client",
  kind: "type",
  slug: "core/client-type",
  source: "packages/core/src/client/client.ts",
  group: "client",
  description: "A client.",
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

function row(description: string): StoredEntry {
  return {
    name: "value",
    description,
    type: "string",
    simplifiedType: "string",
    required: true,
    deprecated: false,
    tags: [],
  };
}

test("a public export without a description lists every offender", () => {
  expect(singleGroup(["client"])).toBe("client");
  expect(singleGroup([])).toBe("");
  expect(singleGroup(["client", "http"])).toBe("");
  expect(() => assertDescribed([client])).not.toThrow();
  expect(() =>
    assertDescribed([
      { package: "@defjs/core", name: "Missing", description: " " },
      { package: "@defjs/core", name: "Also", description: "" },
    ]),
  ).toThrow(
    "public exports missing a description:\n@defjs/core:Also\n@defjs/core:Missing",
  );
});

test("related targets, groups, and slugs are checked after descriptions", () => {
  const identities = identityIndex([
    client,
    { package: "@defjs/core", name: "Client" },
  ]);
  expect(identities.get("Client")).toBe("@defjs/core:Client");
  expect(() =>
    identityIndex([
      { package: "@defjs/core", name: "Client" },
      { package: "@defjs/react", name: "Client" },
    ]),
  ).toThrow("duplicate API name: Client");
  expect(resolveSee("{@link Client}", identities)).toBe("@defjs/core:Client");
  expect(
    resolveSee(
      "@defjs/core:Client",
      new Map([["@defjs/core:Client", "@defjs/core:Client"]]),
    ),
  ).toBe("@defjs/core:Client");
  expect(() => resolveSee("{@link Absent}", identities)).toThrow(
    "Unknown @see target",
  );
  expect(() =>
    validateReference(
      [
        {
          ...client,
          description: "",
          group: "nope",
          slug: "wrong",
          related: ["@defjs/core:Absent"],
        },
      ],
      identities,
    ),
  ).toThrow("public exports missing a description");
  expect(() =>
    validateReference(
      [
        {
          ...client,
          group: "nope",
          slug: "wrong",
          related: ["@defjs/core:Absent"],
        },
      ],
      identities,
    ),
  ).toThrow(/invalid @group:[\s\S]*unknown @see target:[\s\S]*slug mismatch/);
  expect(() =>
    validateReference([{ ...client, group: "" }], identities),
  ).toThrow("@group (missing)");
  expect(() => validateReference([client], identities)).not.toThrow();
  for (const link of [
    "[Errors guide](/docs/errors)",
    "[SSE](/api/sse)",
    "[Consume an SSE stream](/recipes/consume-sse)",
  ])
    expect(() =>
      validateReference(
        [{ ...client, description: `See ${link}.` }],
        identities,
      ),
    ).toThrow("root-relative site links in TSDoc:\n@defjs/core:Client");
});

test("site-link checks walk tags, parameters, tables, and overloads", () => {
  expect(() =>
    assertNoSiteLinks([
      {
        ...client,
        returns: ["ok"],
        throws: ["Error"],
        tags: [{ name: "example", text: "n" }],
        parameters: [row("value")],
        typeTable: [row("id")],
        overloads: [
          {
            signature: "function f(): void;",
            returns: ["ok"],
            parameters: [row("value")],
          },
        ],
      },
    ]),
  ).not.toThrow();
  expect(() =>
    assertNoSiteLinks([
      {
        ...client,
        name: "Fault",
        parameters: [row("See [HTTP](/docs/http).")],
      },
    ]),
  ).toThrow("@defjs/core:Fault");
  expect(() => assertNoSiteLinks([])).not.toThrow();
});
