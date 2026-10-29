import { expect, test } from "vitest";
import type { ApiReferenceEntry } from "../../scripts/api-model";
import { apiEntryView, buildApiEntryView } from "./api-entry-view";

const targets = new Map([["Client", "core/client-type"]]);

function entry(overrides: Partial<ApiReferenceEntry> = {}): ApiReferenceEntry {
  return {
    package: "@defjs/core",
    name: "createClient",
    kind: "function",
    slug: "core/createclient",
    source: "packages/core/src/client/client.ts",
    group: "client",
    description: "Creates a {@link Client}.\n\nSee {@link Client} again.",
    signatures: ["function createClient(): Client;"],
    related: ["@defjs/core:Client"],
    exampleFiles: [
      {
        path: "examples/react/client-provider.tsx",
        region: "example",
        code: "export const view = 1;",
      },
    ],
    returns: ["A client.", " "],
    throws: [],
    tags: [
      { name: "EXAMPLE", text: "```ts\nconst live = true;\n```" },
      { name: "internal", text: "hidden" },
    ],
    typeTable: [],
    parameters: [],
    overloads: [
      {
        signature: "function createClient(): Client;",
        parameters: [
          {
            name: "...options",
            description: "",
            type: "ClientOption[]",
            simplifiedType: "array",
            required: false,
            deprecated: false,
            tags: [],
          },
        ],
        returns: [],
      },
    ],
    ...overrides,
  };
}

test("the page view resolves links, examples and the owning overview", () => {
  const view = buildApiEntryView(entry(), "en-US", targets);
  expect(view.summary).toBe("Creates a Client.");
  expect(view.source).toBe("packages/core/src/client/client.ts");
  expect(view.group).toBe("client");
  expect(view.description).toContain("[Client](/api/core/client-type)");
  expect(view.description).not.toContain("Creates a");
  expect(
    buildApiEntryView(
      entry({ description: "Only {@link Client}." }),
      "en-US",
      targets,
    ).description,
  ).toBe("");
  expect(view.parameterTables).toEqual([
    {
      rows: [
        {
          name: "...options",
          type: "ClientOption[]",
          required: false,
          deprecated: false,
          description: "",
        },
      ],
    },
  ]);
  expect(view.members).toEqual([]);
  expect(
    buildApiEntryView(entry({ typeTable: null }), "en-US", targets).members,
  ).toEqual([]);
  expect(view.returns).toEqual(["A client."]);
  expect(view.throws).toEqual([]);
  expect(view.examples).toEqual([
    { type: "markdown", text: "```ts\nconst live = true;\n```", lang: "" },
    { type: "code", text: "export const view = 1;", lang: "tsx" },
  ]);
  expect(view.related).toEqual([
    { name: "Client", href: "/api/core/client-type" },
  ]);
  expect(view.overviewHref).toBe("/api/client");
});

test("a type page lists members and a missing relation or slug fails", () => {
  const view = buildApiEntryView(
    entry({
      kind: "type",
      typeTable: [
        {
          name: "client",
          description: "The {@link Client}.",
          type: "Client",
          simplifiedType: "Client",
          required: true,
          deprecated: false,
          tags: [],
        },
      ],
      related: [],
      overloads: [],
      exampleFiles: [],
      tags: [{ name: "example", text: "" }],
    }),
    "ar",
    targets,
  );
  expect(view.members[0]?.description).toContain(
    "[Client](/ar/api/core/client-type)",
  );
  expect(view.parameterTables).toEqual([]);
  expect(view.examples).toEqual([]);
  expect(() =>
    buildApiEntryView(
      entry({ related: ["@defjs/core:Missing"] }),
      "en-US",
      targets,
    ),
  ).toThrow("Unknown related API");
  expect(apiEntryView("core/withendpoint", "fr-FR").overviewHref).toBe(
    "/fr-FR/api/client",
  );
  expect(() => apiEntryView("missing", "en-US")).toThrow("Unknown API slug");
});
