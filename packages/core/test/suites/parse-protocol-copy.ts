import { expect, test, vi } from "vitest";
import type { ErrorMap } from "../../src/struct/index.ts";
import { parseStructTuple as parse } from "../../src/struct/introspection.ts";
import { struct } from "../../src/struct/index.ts";
import type {
  ParseResult,
  StructIssue,
  StructLike,
} from "../../src/struct/types.ts";

const ISO = "2026-01-01T00:00:00.000Z";

function firstIssue(result: ParseResult<unknown>): StructIssue {
  const first = result[0]?.issues[0];
  if (!first) {
    throw new Error("expected a parse failure");
  }
  return first;
}

// A bundler can leave two copies of the package in one application. Structs are recognised by registered symbols, so
// a struct from one copy is accepted by the other and its decode hooks run inside the parser that is parsing.
async function otherCopy(): Promise<{ struct: typeof struct }> {
  vi.resetModules();
  const copy = await import("../../src/struct/index.ts");
  expect(copy.struct).not.toBe(struct);
  return copy;
}

export function registerParseProtocolCopySuite(): void {
  test("optional and nullish fields use the parsing copy's omission sentinel in both directions", async () => {
    const other = await otherCopy();
    const token = Symbol.for("defjs.struct.omit");
    for (const [parser, owner] of [
      [struct, other.struct],
      [other.struct, struct],
    ] as const) {
      const Schema = owner.object({
        required: owner.unknown(),
        optional: owner.any().optional(),
        absent: owner.unknown().optional(),
        skipped: owner.any().optional(),
        nullable: owner.unknown().nullish(),
      });
      const [error, value] = parser.parse(Schema, {
        required: token,
        optional: token,
        skipped: undefined,
        nullable: null,
      });
      expect(error).toBeNull();
      expect(value).toEqual({
        required: token,
        optional: token,
        nullable: null,
      });
      expect(Object.keys(value ?? {})).toEqual([
        "required",
        "optional",
        "nullable",
      ]);
      expect(
        parser.parse(owner.record(owner.unknown().nullish()), {
          kept: token,
          skipped: undefined,
          nullable: null,
        }),
      ).toEqual([null, { kept: token, nullable: null }]);
    }
  });

  test("decode hooks accept and reject exactly like the hooks of this copy", async () => {
    const other = await otherCopy();

    expect(parse(other.struct.date(), ISO)).toEqual([null, new Date(ISO)]);
    expect(parse(other.struct.bigint(), "12")).toEqual([null, 12n]);
    expect(parse(other.struct.bigint(), 7n)).toEqual([null, 7n]);

    const rejected: [StructLike, StructLike, unknown][] = [
      [other.struct.date(), struct.date(), "not a date"],
      [other.struct.bigint(), struct.bigint(), "x1"],
    ];
    for (const [foreign, own, input] of rejected) {
      const [error, value] = parse(foreign, input);
      expect(value).toBeUndefined();
      expect(error?.issues).toHaveLength(1);
      expect(error?.issues).toEqual(parse(own, input)[0]?.issues);
    }

    // The parsing copy's error map applies to conversion failures raised by the other copy's decode hooks.
    const seen: string[] = [];
    const errorMap: ErrorMap = (item) => {
      seen.push(item.message);
      return "redacted";
    };
    const mappedCases: [StructLike, string, string][] = [
      [other.struct.bigint(), "x1", "bigint"],
      [other.struct.date(), "not a date", "Date"],
    ];
    for (const [foreign, input, expected] of mappedCases) {
      seen.length = 0;
      const [mapped, mappedValue] = parse(foreign, input, { errorMap });
      expect(mappedValue).toBeUndefined();
      expect(seen).toEqual([`Expected ${expected} at <root>, received string`]);
      expect(seen[0]).not.toContain(input);
      expect(mapped?.issues[0]?.message).toBe("redacted");
      expect(mapped?.issues[0]?.received).toBe(input);
      expect(String(mapped)).not.toContain(input);
    }
  });

  test("failures keep their place in the document and a union moves on to its next candidate", async () => {
    const other = await otherCopy();
    const Doc = struct.object({
      events: struct.array(
        struct.object({ at: other.struct.date(), id: other.struct.bigint() }),
      ),
    });

    expect(
      firstIssue(
        parse(Doc, {
          events: [
            { at: ISO, id: "1" },
            { at: "never", id: "2" },
          ],
        }),
      ),
    ).toMatchObject({
      code: "invalid_type",
      expected: "Date",
      path: ["events", 1, "at"],
      received: "never",
    });
    expect(
      firstIssue(parse(Doc, { events: [{ at: ISO, id: "one" }] })).path,
    ).toEqual(["events", 0, "id"]);

    const Either = struct.or(other.struct.date(), struct.string());
    expect(parse(Either, "plain")).toEqual([null, "plain"]);
    expect(parse(Either, ISO)).toEqual([null, new Date(ISO)]);

    // The parser of the other copy runs a struct of this one the same way.
    expect(
      firstIssue(
        other.struct.parse(struct.array(struct.date()), [ISO, "never"]),
      ),
    ).toMatchObject({ path: [1], received: "never" });
  });
}
