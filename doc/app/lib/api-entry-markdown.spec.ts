import { expect, test } from "vitest";
import type { ApiReferenceEntry } from "../../scripts/api-model";
import { apiReference } from "../data/api-reference";
import { readableMarkdown } from "./markdown";
import {
  entrySummary,
  renderApiEntryMarkdown,
  renderApiEntryMarkdownBySlug,
} from "./api-entry-markdown";

const targets = new Map([
  ["Client", "core/client-type"],
  ["FetchHandle", "core/fetchhandle-type"],
]);

function entry(overrides: Partial<ApiReferenceEntry> = {}): ApiReferenceEntry {
  return {
    package: "@defjs/core",
    name: "createClient",
    kind: "function",
    slug: "core/createclient",
    source: "packages/core/src/client/client.ts",
    group: "client",
    description: "Creates a {@link Client}.\n\nMore.",
    signatures: ["function createClient(): Client;"],
    related: ["@defjs/core:Client"],
    exampleFiles: [
      {
        path: "examples/api/create-client.ts",
        region: "example",
        code: "const n = 1;",
      },
    ],
    returns: ["A {@link Client}."],
    throws: ["", "An error."],
    tags: [
      { name: "example", text: "```ts\nconst live = true;\n```" },
      { name: "example", text: "   " },
      { name: "typeParam", text: "ignored" },
    ],
    typeTable: null,
    parameters: [],
    overloads: [
      {
        signature: "function createClient(): Client;",
        parameters: [
          {
            name: "options",
            description: "Helpers.",
            type: "ClientOption[]",
            simplifiedType: "array",
            required: false,
            deprecated: false,
            tags: [],
          },
        ],
        returns: ["A {@link Client}."],
      },
    ],
    ...overrides,
  };
}

test("markdown includes the signature, fields, prose, examples, related pages and overview", () => {
  const text = renderApiEntryMarkdown(entry(), "en-US", targets);
  expect(text).toContain("@defjs/core · function");
  expect(text).toContain("```ts\nfunction createClient(): Client;\n```");
  expect(text).toContain("## Parameters");
  expect(text).toContain(
    "| options | `ClientOption[]` | optional | Helpers. |",
  );
  expect(text).toContain("[Client](/api/core/client-type)");
  expect(text).toContain("## Returns");
  expect(text).toContain("## Throws");
  expect(text).not.toContain("## Throws\n\n\n");
  expect(text).toContain("## Examples");
  expect(text).toContain("const live = true;");
  expect(text).toContain("const n = 1;");
  expect(text).toContain("## See also");
  expect(text).toContain("[Overview](/api/client)");
  expect(entrySummary(entry())).toBe("Creates a Client.");
});

test("members, a broken code fence and a deprecated field stay readable", () => {
  const text = renderApiEntryMarkdown(
    entry({
      signatures: ["const raw = ```;"],
      typeTable: [
        {
          name: "old",
          description: "Gone | away.",
          type: "string",
          simplifiedType: "string",
          required: true,
          deprecated: true,
          tags: [],
        },
      ],
      overloads: [],
      related: [],
      exampleFiles: [
        {
          path: "examples/react/client-provider.tsx",
          region: "example",
          code: "const view = <button />;",
        },
      ],
      returns: [],
      throws: [" "],
      tags: [],
      description: "",
    }),
    "zh-Hans",
    targets,
  );
  expect(text).toContain("## Members");
  expect(text).toContain("deprecated. Gone \\| away.");
  expect(text).toContain("```tsx\nconst view = <button />;\n```");
  expect(text).toContain("````ts\nconst raw = ```;\n````");
  expect(text).not.toContain("## See also");
  expect(text).not.toContain("## Returns");
  expect(text).not.toContain("## Parameters");
  expect(text).toContain("[Overview](/zh-Hans/api/client)");
});

test("different overloads each keep a parameter table and a missing related target fails", () => {
  const text = renderApiEntryMarkdown(
    entry({
      related: [],
      typeTable: [],
      overloads: [
        {
          signature: "function enum(value: string): void;",
          parameters: [
            {
              name: "value",
              description: "A string.",
              type: "string",
              simplifiedType: "string",
              required: true,
              deprecated: false,
              tags: [],
            },
          ],
          returns: [],
        },
        {
          signature: "function enum(value: number): void;",
          parameters: [
            {
              name: "value",
              description: "A number.",
              type: "number",
              simplifiedType: "number",
              required: true,
              deprecated: false,
              tags: [],
            },
          ],
          returns: [],
        },
      ],
    }),
    "en-US",
    targets,
  );
  expect(text.match(/## Parameters/g)?.length).toBe(2);
  expect(text).toContain("function enum(value: string): void;");
  expect(text).toContain("A number.");
  expect(() =>
    renderApiEntryMarkdown(
      entry({
        related: ["@defjs/core:Missing"],
        exampleFiles: [],
        tags: [],
      }),
      "en-US",
      targets,
    ),
  ).toThrow("Unknown related API: @defjs/core:Missing");
});

test("every published entry renders Markdown that search can index", () => {
  expect(renderApiEntryMarkdownBySlug("core/createclient", "en-US")).toContain(
    "function createClient",
  );
  expect(() => renderApiEntryMarkdownBySlug("missing", "en-US")).toThrow(
    "Unknown API slug: missing",
  );
  for (const item of apiReference)
    expect(() =>
      readableMarkdown(
        renderApiEntryMarkdownBySlug(item.slug, "de-DE"),
        "de-DE",
      ),
    ).not.toThrow();
});
