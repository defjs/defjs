import { describe, expect, test } from "vitest";
import { matchesRuntimeValue } from "./match";
import { struct } from "./index";
import { assertStruct } from "./shape";
import type { RuntimeStruct } from "./definition";

function runtimeOf(value: unknown): RuntimeStruct {
  assertStruct(value, "struct");
  return value;
}

describe("matchesRuntimeValue discriminated unions", () => {
  const schema = runtimeOf(
    struct.discriminatedUnion("type", [
      struct.object({ type: struct.literal("text") }),
    ]),
  );

  test("matches an object whose tag selects an option", () => {
    expect(matchesRuntimeValue(schema, { type: "text" })).toBe(true);
  });

  test("rejects a value that is not an object or has no tag", () => {
    expect(matchesRuntimeValue(schema, "text")).toBe(false);
    expect(matchesRuntimeValue(schema, {})).toBe(false);
  });

  test("rejects a tag no option declares", () => {
    expect(matchesRuntimeValue(schema, { type: "other" })).toBe(false);
  });
});

describe("matchesRuntimeValue null", () => {
  test("is decided by the members of a union or an intersection", () => {
    const union = runtimeOf(struct.or(struct.string(), struct.number()));
    const both = runtimeOf(
      struct.intersection(struct.literal(null), struct.null()),
    );

    expect(matchesRuntimeValue(union, null)).toBe(false);
    expect(matchesRuntimeValue(both, null)).toBe(true);
  });
});
