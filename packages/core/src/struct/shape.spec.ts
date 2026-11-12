import { describe, expect, test } from "vitest";
import { struct } from "./index";
import { parseStructTuple as parse } from "./parse";
import { assertStruct } from "./shape";
import type { StructLike } from "./types";

describe("shape.ts getter-recursive structures", () => {
  test("parses getter-recursive objects without an explicit recursive constructor", () => {
    type Category = {
      children: Category[];
      id: string;
    };

    const category: StructLike = struct.object({
      get children() {
        return struct.array(category);
      },
      id: struct.string(),
    });

    const [err, value] = parse(category, {
      children: [{ children: [], id: "child" }],
      id: "root",
    });
    if (err) {
      throw err;
    }

    expect(value).toEqual({
      children: [{ children: [], id: "child" }],
      id: "root",
    } satisfies Category);
  });

  test("reports getter-recursive errors with nested paths", () => {
    const comment: StructLike = struct.object({
      id: struct.string(),
      get replies() {
        return struct.array(comment);
      },
    });

    const [err] = parse(comment, {
      id: "root",
      replies: [{ id: 1, replies: [] }],
    });

    expect(err?.issues[0]?.path).toEqual(["replies", 0, "id"]);
  });
});

describe("shape.ts assertStruct", () => {
  test("narrows a value that is not known to be a struct, or throws a TypeError", () => {
    expect(() => assertStruct(struct.string(), "value")).not.toThrow();
    expect(() => assertStruct({}, "value")).toThrow(
      new TypeError("value must be a struct"),
    );
  });
});
