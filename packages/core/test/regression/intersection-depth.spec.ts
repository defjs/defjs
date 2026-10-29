import { describe, expect, test } from "vitest";
import { parseEndpointInput } from "../../src/internal/endpoint_input";
import { encodeOutbound } from "../../src/internal/outbound_request";
import { StructError, struct } from "../../src/struct";
import { encodeJson } from "../../src/struct/codec/json";
import { encodeStructValue } from "../../src/struct/introspection";

const Left = struct.object({ value: struct.any().alias("left") });
const Right = struct.object({ value: struct.any().alias("right") });
const Both = struct.intersection(Left, Right);

function nest(
  depth: number,
  array = false,
): string | unknown[] | { child: unknown } {
  let value: string | unknown[] | { child: unknown } = "leaf";
  for (let index = 0; index < depth; index += 1)
    value = array ? [value] : { child: value };
  return value;
}

function cyclic(array: boolean): unknown {
  if (array) {
    const value: unknown[] = [];
    value.push(value);
    return value;
  }
  const value: { child?: unknown } = {};
  value.child = value;
  return value;
}

describe("intersection merge depth", () => {
  test.each([false, true])(
    "rejects distinct cyclic opaque leaves (array=%s) as an intersection failure",
    (array) => {
      const [error, value] = struct.parse(
        Both,
        { left: cyclic(array), right: cyclic(array) },
        { aliases: true },
      );
      expect(value).toBeUndefined();
      expect(error).toBeInstanceOf(StructError);
      expect(error?.issues).toHaveLength(1);
      expect(error?.issues[0]).toMatchObject({
        code: "invalid_intersection",
        expected: "compatible intersection value",
        path: [
          "value",
          ...Array.from({ length: 255 }, () => (array ? 0 : "child")),
        ],
      });
    },
  );

  test.each([Both, struct.intersection(struct.or(Left, struct.null()), Right)])(
    "shares the total path budget with its parser instead of restarting at each merge (%#)",
    (intersection) => {
      const Wrapped = struct.object({ wrapper: intersection });
      expect(
        struct.parse(
          Wrapped,
          { wrapper: { left: nest(254), right: nest(254) } },
          { aliases: true },
        )[0],
      ).toBeNull();
      const [error, value] = struct.parse(
        Wrapped,
        { wrapper: { left: nest(255), right: nest(255) } },
        { aliases: true },
      );
      expect(value).toBeUndefined();
      expect(error?.issues[0]).toMatchObject({
        code: "invalid_intersection",
        path: [
          "wrapper",
          "value",
          ...Array.from({ length: 254 }, () => "child"),
        ],
      });
    },
  );

  test("does not traverse identical references or reject shared acyclic children", () => {
    const cycle = cyclic(false);
    const [cycleError, cycleValue] = struct.parse(
      Both,
      { left: cycle, right: cycle },
      { aliases: true },
    );
    expect(cycleError).toBeNull();
    expect(cycleValue?.value).toBe(cycle);
    const left = { n: 1 },
      right = { n: 1 };
    const [error, value] = struct.parse(
      Both,
      { left: { a: left, b: left }, right: { a: right, b: right } },
      { aliases: true },
    );
    expect(error).toBeNull();
    expect(value).toEqual({ value: { a: { n: 1 }, b: { n: 1 } } });
    expect(left).toEqual({ n: 1 });
    expect(right).toEqual({ n: 1 });
  });

  test("preserves caller exceptions raised while merging opaque fields", () => {
    const original = new RangeError("caller getter");
    let thrown: unknown;
    try {
      struct.parse(
        Both,
        {
          left: {
            get child(): unknown {
              throw original;
            },
          },
          right: { child: 1 },
        },
        { aliases: true },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(original);
    expect(
      struct.parse(
        Both,
        { left: { child: 1 }, right: { child: 1 } },
        { aliases: true },
      )[0],
    ).toBeNull();
  });

  test("carries alias encoder depth into an overlapping wire field merge", () => {
    const Wire = struct.object({
      wrapper: struct.intersection(
        struct.object({ left: struct.any().alias("value") }),
        struct.object({ right: struct.any().alias("value") }),
      ),
    });
    expect(() =>
      encodeJson(Wire, { wrapper: { left: nest(254), right: nest(254) } }),
    ).not.toThrow();
    expect(() =>
      encodeJson(Wire, { wrapper: { left: nest(255), right: nest(255) } }),
    ).toThrow(TypeError);
    expect(() =>
      encodeJson(Wire, { wrapper: { left: nest(255), right: nest(255) } }),
    ).toThrow(/invalid intersection encode/);
  });

  test("carries ordinary encoder depth into a general intersection merge", () => {
    const Schema = struct.object({
      wrapper: struct.intersection(
        struct.record(struct.any()),
        struct.object({ value: struct.any() }),
      ),
    });
    const input = (depth: number) => ({
      wrapper: {
        get value(): unknown {
          return nest(depth);
        },
      },
    });
    expect(() => encodeStructValue(Schema, input(254))).not.toThrow();
    expect(() => encodeStructValue(Schema, input(255))).toThrow(TypeError);
    expect(() => encodeStructValue(Schema, input(255))).toThrow(
      /invalid intersection encode/,
    );
  });

  test("carries outbound logical field depth into an opaque array wire merge", async () => {
    const Schema = struct.object({
      wrapper: struct.intersection(
        struct.object({ left: struct.any().alias("value") }),
        struct.object({ right: struct.any().alias("value") }),
      ),
    });
    const accepted = await parseEndpointInput(Schema, {
      wrapper: { left: nest(254, true), right: nest(254, true) },
    });
    const rejected = await parseEndpointInput(Schema, {
      wrapper: { left: nest(255, true), right: nest(255, true) },
    });
    expect(() => encodeOutbound(accepted)).not.toThrow();
    expect(() => encodeOutbound(rejected)).toThrow(TypeError);
    expect(() => encodeOutbound(rejected)).toThrow(
      /invalid intersection encode/,
    );
  });
});
