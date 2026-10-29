import { expect, test } from "vitest";
import {
  firstProse,
  jsDocOffset,
  jsDocProse,
  lastDocProse,
  paramDescription,
  parseExampleFile,
  seeTarget,
  splitDoc,
  storedTags,
  textsFor,
} from "./api-tags";

const comment = `/**
 * Summary line.
 *
 * More detail.
 * {@link Client}
 * @param options - the options
 * @returns A value.
 */`;

test("JSDoc prose keeps every paragraph and stops at the first block tag", () => {
  expect(jsDocProse(comment)).toBe(
    "Summary line.\n\nMore detail.\n{@link Client}",
  );
  expect(splitDoc("/** Summary */")).toEqual({ prose: "Summary", tags: "" });
  expect(splitDoc(comment).tags.startsWith("@param options")).toBe(true);
  expect(() => splitDoc("not a comment")).toThrow("not a JSDoc comment");
  expect(jsDocOffset("/** Summary */")).toBe(0);
  expect(jsDocOffset("// banner\n/** Summary */")).toBe("// banner\n".length);
  expect(() => jsDocOffset("// banner only")).toThrow("not a JSDoc comment");
  expect(jsDocProse("// banner\n/** Summary\n * @internal\n */")).toBe(
    "Summary",
  );
  expect(lastDocProse(undefined)).toBe("");
  expect(lastDocProse([])).toBe("");
  expect(
    lastDocProse([
      { getText: () => "/** First */" },
      { getText: () => "/** Second */" },
    ]),
  ).toBe("Second");
  expect(firstProse([undefined, [{ getText: () => "/** Kept */" }]])).toBe(
    "Kept",
  );
  expect(
    firstProse([
      [{ getText: () => "/** First */" }],
      [{ getText: () => "/** Second */" }],
    ]),
  ).toBe("First");
  expect(firstProse([undefined, []])).toBe("");
});

test("custom tags keep their text and hoisted tags are stored separately", () => {
  const tags = [
    { name: "param", text: "options - the options" },
    { name: "return", text: "A value." },
    { name: "throws", text: "  " },
    { name: "example", text: "const n = 1" },
    { name: "See", text: "{@link Client}" },
  ];
  expect(textsFor(tags, ["returns", "return"])).toEqual(["A value."]);
  expect(
    textsFor([{ name: "return" }, { name: "return", text: "  " }], ["return"]),
  ).toEqual([]);
  expect(storedTags(tags)).toEqual([{ name: "example", text: "const n = 1" }]);
  expect(paramDescription(tags, "...options")).toBe("the options");
  expect(
    paramDescription(
      [{ name: "param", text: "...options - rest" }],
      "...options",
    ),
  ).toBe("rest");
  expect(
    paramDescription([{ name: "param", text: "other - no" }], "options"),
  ).toBe("");
  expect(paramDescription([{ name: "param" }], "options")).toBe("");
  expect(
    paramDescription(
      [{ name: "param", text: "props - client and children" }],
      "{ client, children }",
    ),
  ).toBe("client and children");
  expect(paramDescription([{ name: "param" }], "{ client }")).toBe("");
  expect(
    paramDescription(
      [
        { name: "param", text: "left - a" },
        { name: "param", text: "right - b" },
      ],
      "{ client, children }",
    ),
  ).toBe("");
});

test("@see and @exampleFile accept the documented forms", () => {
  expect(seeTarget("{@link Client}")).toBe("Client");
  expect(seeTarget("{@link Client | the client}")).toBe("Client");
  expect(seeTarget("@defjs/core:Client")).toBe("Client");
  expect(seeTarget("struct.parse")).toBe("struct.parse");
  expect(() => seeTarget("not a target")).toThrow("invalid @see");
  expect(parseExampleFile("examples/api/create-client.ts#example")).toEqual({
    path: "examples/api/create-client.ts",
    region: "example",
  });
  expect(() => parseExampleFile("../secret.ts#example")).toThrow(
    "invalid @exampleFile",
  );
  expect(() => parseExampleFile("examples/api/create-client.ts")).toThrow(
    "invalid @exampleFile",
  );
});
