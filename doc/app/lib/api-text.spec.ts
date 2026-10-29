import { expect, test } from "vitest";
import {
  apiPageHref,
  codeLanguage,
  firstParagraph,
  linkTargets,
  localeHref,
  parameterSections,
  resolveDocLinks,
  withoutFirstParagraph,
  type ApiField,
} from "./api-text";

const targets = new Map([
  ["Client", "core/client-type"],
  ["struct.unknown", "core/struct-unknown"],
]);

function field(name: string, description = ""): ApiField {
  return {
    name,
    type: "string",
    required: true,
    description,
    deprecated: false,
  };
}

test("the first paragraph is plain text and later paragraphs stay out of the summary", () => {
  expect(
    firstParagraph(
      "Creates a {@link Client | client} from `options`.\n\nSecond paragraph.",
    ),
  ).toBe("Creates a client from options.");
  expect(firstParagraph("**Bold**   name.\n\nMore")).toBe("Bold name.");
  expect(firstParagraph("See [Client](/api/client) now.")).toBe(
    "See Client now.",
  );
  expect(firstParagraph("")).toBe("");
  expect(withoutFirstParagraph("One.\n\nTwo.")).toBe("Two.");
  expect(withoutFirstParagraph("One.\n\n\nTwo.")).toBe("Two.");
  expect(withoutFirstParagraph("Only.")).toBe("");
});

test("locale links keep the default locale at the root", () => {
  expect(localeHref("en-US", "/api/client")).toBe("/api/client");
  expect(apiPageHref("zh-Hans", "core/client-type")).toBe(
    "/zh-Hans/api/core/client-type",
  );
  expect(() => localeHref("en-US", "api/client")).toThrow("absolute");
});

test("doc links resolve outside code and keep unknown names as text", () => {
  const text = resolveDocLinks(
    "Use {@link Client} and {@link struct.unknown | unknown} plus {@link Missing}.\n\n```ts\n{@link Client}\n```\n\n`{@link Client}` {@link Client | [Client]}",
    "ja-JP",
    targets,
  );
  expect(text).toContain("[Client](/ja-JP/api/core/client-type)");
  expect(text).toContain("[unknown](/ja-JP/api/core/struct-unknown)");
  expect(text).toContain("plus Missing.");
  expect(text).toContain("```ts\n{@link Client}\n```");
  expect(text).toContain("`{@link Client}`");
  expect(text).toContain("[Client](/ja-JP/api/core/client-type)");
  expect(resolveDocLinks("{@link }", "en-US", targets)).toBe("{@link }");
  expect(resolveDocLinks("{@link Client", "en-US", targets)).toBe(
    "{@link Client",
  );
  expect(resolveDocLinks("`{@link Client", "en-US", targets)).toBe(
    "`{@link Client",
  );
  expect(resolveDocLinks("{@link Client | }", "en-US", targets)).toContain(
    "[Client](/api/core/client-type)",
  );
  expect(
    resolveDocLinks("Value {@link Client}<TErr> and <div>", "en-US", targets),
  ).toBe("Value [Client](/api/core/client-type)`<TErr>` and <div>");
  expect(resolveDocLinks("Use Foo<Bar<Baz>>.", "en-US", targets)).toBe(
    "Use Foo`<Bar<Baz>>`.",
  );
  expect(resolveDocLinks("Open <Type", "en-US", targets)).toBe("Open <Type");
  expect(resolveDocLinks("`Client<TErr>`", "en-US", targets)).toBe(
    "`Client<TErr>`",
  );
  expect(resolveDocLinks("`Client<TErr", "en-US", targets)).toBe(
    "`Client<TErr",
  );
  expect(resolveDocLinks("end <", "en-US", targets)).toBe("end <");
});

test("names are unique and code files keep their extension", () => {
  expect([
    ...linkTargets([{ name: "Client", slug: "core/client-type" }]),
  ]).toEqual([["Client", "core/client-type"]]);
  expect(() =>
    linkTargets([
      { name: "Client", slug: "a" },
      { name: "Client", slug: "b" },
    ]),
  ).toThrow("Duplicate API name: Client");
  expect(codeLanguage("examples/react/client-provider.tsx")).toBe("tsx");
  expect(codeLanguage("examples/api/create-client.ts")).toBe("ts");
});

test("identical overloads share one parameter table and different ones stay separate", () => {
  const shared = field("value");
  expect(parameterSections([])).toEqual([]);
  expect(
    parameterSections([{ signature: "function a();", parameters: [] }]),
  ).toEqual([]);
  expect(
    parameterSections([
      { signature: "function a(value: string);", parameters: [shared] },
      { signature: "function b(value: string);", parameters: [shared] },
    ]),
  ).toEqual([{ rows: [shared] }]);
  const other = { ...shared, description: "other" };
  expect(
    parameterSections([
      { signature: "function a(value: string);", parameters: [shared] },
      { signature: "function b(value: number);", parameters: [other] },
    ]),
  ).toEqual([
    { signature: "function a(value: string);", rows: [shared] },
    { signature: "function b(value: number);", rows: [other] },
  ]);
});
