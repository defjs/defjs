import { describe, expect, test } from "vitest";
import { decodeJson, encodeJson } from "./codec/json";
import { StructError, struct } from "./index";
import type { StructLike } from "./index";
import { parseStructTuple as parse } from "./introspection";
import { selectUnionOptions } from "./match";

describe("parse.ts prototype pollution defense", () => {
  test("parseObjectValue strips __proto__ without polluting Object.prototype", () => {
    const s = struct.object({});
    const [err, val] = parse(s, JSON.parse('{"__proto__":{"polluted":true}}'));
    if (err) {
      throw err;
    }
    expect(
      (Object.prototype as { [key: string]: unknown })["polluted"],
    ).toBeUndefined();
    expect(Object.hasOwn(val as object, "__proto__")).toBe(false);
  });

  test("parseRecordValue does not pollute Object.prototype", () => {
    const s = struct.record(struct.any());
    parse(s, JSON.parse('{"__proto__":{"polluted":true}}'));
    expect(
      (Object.prototype as { [key: string]: unknown })["polluted"],
    ).toBeUndefined();
  });

  test("parsed object output has null prototype(Object.create(null))", () => {
    const s = struct.object({ x: struct.string() });
    const [err, val] = parse(s, { x: "hi" });
    if (err) {
      throw err;
    }
    expect(Object.getPrototypeOf(val)).toBeNull();
  });

  test("parsed record output has null prototype", () => {
    const s = struct.record(struct.string());
    const [err, val] = parse(s, { k: "v" });
    if (err) {
      throw err;
    }
    expect(Object.getPrototypeOf(val)).toBeNull();
  });

  test('"__proto__" key preserved as own property under record output', () => {
    const s = struct.record(struct.any());
    const [err, val] = parse(s, JSON.parse('{"__proto__":"data"}'));
    if (err) {
      throw err;
    }
    expect(Object.hasOwn(val as object, "__proto__")).toBe(true);
    expect((val as { [key: string]: unknown })["__proto__"]).toBe("data");
  });

  test("parseObjectValue ignores inherited declared fields", () => {
    const s = struct.object({ pollutedId: struct.string() });
    Object.defineProperty(Object.prototype, "pollutedId", {
      configurable: true,
      value: "admin",
    });

    try {
      const [err, val] = parse(s, {});
      expect(err).toBeInstanceOf(StructError);
      expect(err?.issues[0]?.code).toBe("missing_key");
      expect(val).toBeUndefined();
    } finally {
      delete (Object.prototype as { [key: string]: unknown })["pollutedId"];
    }
  });

  test("parseObjectValue ignores inherited declared fields in plain input", () => {
    const s = struct.object({ pollutedId: struct.string() });
    Object.defineProperty(Object.prototype, "pollutedId", {
      configurable: true,
      value: "admin",
    });

    try {
      const [err, val] = parse(s, {});
      expect(err).toBeInstanceOf(StructError);
      expect(err?.issues[0]?.code).toBe("missing_key");
      expect(val).toBeUndefined();
    } finally {
      delete (Object.prototype as { [key: string]: unknown })["pollutedId"];
    }
  });

  test("decodeJson ignores inherited wire keys", () => {
    const s = struct.object({
      name: struct.string().alias("user_name"),
    });
    const wire = Object.create({ user_name: "admin" });

    expect(() => decodeJson(s, wire)).toThrow(StructError);
  });

  test("JSON aliases for dangerous keys do not pollute prototypes", () => {
    const dangerousStruct = struct.object({
      constructorValue: struct.string().alias("constructor"),
      protoValue: struct.string().alias("__proto__"),
    });

    const encoded = encodeJson(dangerousStruct, {
      constructorValue: "ctor",
      protoValue: "proto",
    }) as { [key: string]: unknown };
    expect(Object.hasOwn(encoded, "__proto__")).toBe(true);
    expect(Object.hasOwn(encoded, "constructor")).toBe(true);
    expect(encoded["__proto__"]).toBe("proto");
    expect(encoded["constructor"]).toBe("ctor");
    expect(
      (Object.prototype as { [key: string]: unknown })["proto"],
    ).toBeUndefined();

    const decoded = decodeJson(
      dangerousStruct,
      JSON.parse('{"__proto__":"proto","constructor":"ctor"}'),
    );
    expect(decoded).toEqual({ constructorValue: "ctor", protoValue: "proto" });
    expect(Object.getPrototypeOf(decoded)).toBeNull();
    expect(
      (Object.prototype as { [key: string]: unknown })["proto"],
    ).toBeUndefined();
  });

  test("keeps dangerous wire keys as own data properties during alias decode", () => {
    const Payload = struct.object({
      proto: struct.string().alias("__proto__"),
      constructorValue: struct.string().alias("constructor"),
    });

    const raw: { [key: string]: unknown } = Object.create(null);
    raw["__proto__"] = "safe";
    raw["constructor"] = "value";

    const output = decodeJson(Payload, raw);

    expect(output).toEqual({ proto: "safe", constructorValue: "value" });
    expect(({} as { proto?: string }).proto).toBeUndefined();
  });

  test("reads nested object fields and discriminators only once", () => {
    let pagingReads = 0;
    const nestedInput = {
      get paging() {
        pagingReads += 1;
        if (pagingReads > 1) {
          throw new Error("paging reread");
        }
        return { page: 1 };
      },
    };
    expect(
      parse(
        struct.object({ paging: struct.object({ page: struct.number() }) }),
        nestedInput,
      ),
    ).toEqual([null, { paging: { page: 1 } }]);

    let typeReads = 0;
    const Event = struct.discriminatedUnion("type", [
      struct.object({
        payload: struct.string(),
        type: struct.literal("message"),
      }),
    ]);
    const eventInput = {
      payload: "hello",
      get type() {
        typeReads += 1;
        if (typeReads > 1) {
          throw new Error("type reread");
        }
        return "message" as const;
      },
    };
    expect(parse(Event, eventInput)).toEqual([
      null,
      { payload: "hello", type: "message" },
    ]);

    let kindReads = 0;
    const WireEvent = struct.discriminatedUnion("type", [
      struct.object({
        payload: struct.string().alias("body"),
        type: struct.literal("message").alias("kind"),
      }),
      struct.object({
        count: struct.number(),
        type: struct.literal("count").alias("kind"),
      }),
    ]);
    const wireInput = {
      body: "hello",
      get kind() {
        kindReads += 1;
        if (kindReads > 1) {
          throw new Error("kind reread");
        }
        return "message" as const;
      },
    };
    expect(decodeJson(WireEvent, wireInput)).toEqual({
      payload: "hello",
      type: "message",
    });
    expect([pagingReads, typeReads, kindReads]).toEqual([1, 1, 1]);
  });
});

describe("parse.ts nesting limit", () => {
  const Node: StructLike = struct.object({
    get child(): StructLike {
      return Node;
    },
  });
  const Chain = struct.object({
    get child(): StructLike {
      return Chain.null();
    },
  });
  const Tree = struct.object({
    get next(): StructLike {
      return struct.or(Tree, struct.null());
    },
  });

  function nest(key: string, depth: number, leaf: unknown): unknown {
    let value = leaf;
    for (let level = 0; level < depth; level += 1) {
      value = { [key]: value };
    }
    return value;
  }

  test("accepts a value 256 levels deep and rejects one level more", () => {
    expect(parse(Chain, nest("child", 256, null))[0]).toBeNull();

    const [error, output] = parse(Chain, nest("child", 257, null));
    expect(output).toBeUndefined();
    expect(error).toBeInstanceOf(StructError);
    expect(error?.issues).toHaveLength(1);
    expect(error?.issues[0]).toMatchObject({
      code: "invalid_type",
      expected: "value nested at most 256 levels deep",
      path: Array.from({ length: 256 }, () => "child"),
      received: { child: null },
    });
  });

  test("returns a StructError instead of overflowing the stack on a very deep document", () => {
    const input = JSON.parse(
      '{"child":'.repeat(100_000) + "null" + "}".repeat(100_000),
    );
    const [error, output] = struct.parse(Chain, input);
    expect(error).toBeInstanceOf(StructError);
    expect(error?.issues[0]?.path).toHaveLength(256);
    expect(output).toBeUndefined();
  });

  test("returns a StructError for a cyclic document", () => {
    const cycle: { [key: string]: unknown } = {};
    cycle["child"] = cycle;

    const [error, output] = parse(Node, cycle);
    expect(error).toBeInstanceOf(StructError);
    expect(error?.issues[0]?.code).toBe("invalid_type");
    expect(error?.issues[0]?.received).toBe(cycle);
    expect(output).toBeUndefined();
  });

  test("counts every container level, not only objects", () => {
    const List = struct.object({
      get children(): StructLike {
        return struct.array(List);
      },
    });
    const levels = (depth: number) => {
      let value: unknown = { children: [] };
      for (let level = 1; level < depth; level += 1) {
        value = { children: [value] };
      }
      return value;
    };

    expect(parse(List, levels(128))[0]).toBeNull();
    expect(parse(List, levels(129))[0]).toBeInstanceOf(StructError);
  });

  test.each(["array", "record", "tuple"] as const)(
    "bounds nested %s containers, including empty ones",
    (kind) => {
      let schema: StructLike = struct.number();
      let input: unknown = 1;
      for (let level = 0; level < 256; level += 1) {
        if (kind === "record") {
          schema = struct.record(schema);
          input = { item: input };
        } else {
          schema =
            kind === "array" ? struct.array(schema) : struct.tuple([schema]);
          input = [input];
        }
      }
      expect(struct.parse(schema, input)[0]).toBeNull();
      expect(selectUnionOptions([schema], input)).toHaveLength(1);
      const outer = struct.object({ value: schema });
      expect(selectUnionOptions([outer], { value: input })).toHaveLength(0);
      const [error, output] = struct.parse(outer, { value: input });
      expect(error?.issues[0]).toMatchObject({
        code: "invalid_type",
        expected: "value nested at most 256 levels deep",
      });
      expect(error?.issues[0]?.path).toHaveLength(256);
      expect(output).toBeUndefined();

      if (kind !== "tuple") {
        let nested: StructLike =
          kind === "array"
            ? struct.array(struct.number())
            : struct.record(struct.number());
        let value: unknown = kind === "record" ? {} : [];
        for (let level = 0; level < 256; level += 1) {
          nested = struct.object({ value: nested });
          value = { value };
        }
        expect(struct.parse(nested, value)[0]).toBeInstanceOf(StructError);
      }
    },
  );

  test("bounds object fast paths for intersections and discriminated unions", () => {
    const Intersection = struct.intersection(
      struct.object({
        get child(): StructLike {
          return Intersection.null();
        },
      }),
      struct.object({ tag: struct.string().optional() }),
    );
    const Discriminated = struct.discriminatedUnion("kind", [
      struct.object({
        kind: struct.literal("node"),
        get child(): StructLike {
          return Discriminated.null();
        },
      }),
    ]);
    let input: unknown = null;
    for (let level = 0; level < 257; level += 1)
      input = { child: input, kind: "node" };
    for (const schema of [Intersection, Discriminated]) {
      const [error, output] = struct.parse(schema, input);
      expect(error?.issues[0]?.path).toHaveLength(256);
      expect(output).toBeUndefined();
    }
  });

  test("decodeJson reports the logical path when aliased nesting exceeds the limit", () => {
    const Aliased = struct.object({
      get child(): StructLike {
        return Aliased.null().alias("wire");
      },
    });
    const input = nest("wire", 100_000, null);
    expect(() => decodeJson(Aliased, input)).toThrow(StructError);
    expect(() => decodeJson(Aliased, input)).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            path: Array.from({ length: 256 }, () => "child"),
          }),
        ],
      }),
    );
  });

  test("does not traverse passthrough values or confuse shared children with cycles", () => {
    const cycle: { child?: unknown } = {};
    cycle.child = cycle;
    expect(struct.parse(struct.any(), cycle)).toEqual([null, cycle]);
    expect(struct.parse(struct.unknown(), cycle)).toEqual([null, cycle]);
    const shared = nest("child", 255, null);
    expect(
      struct.parse(struct.object({ left: Chain, right: Chain }), {
        left: shared,
        right: shared,
      })[0],
    ).toBeNull();
  });

  test("maps the depth failure without leaking path or failure state across reentrant parses", () => {
    let calls = 0;
    const [error] = struct.parse(Chain, nest("child", 257, null), {
      errorMap: (entry) => {
        calls += 1;
        expect(entry.path).toHaveLength(256);
        expect(struct.parse(Chain, { child: null })[0]).toBeNull();
        return "nesting rejected";
      },
    });
    expect(error?.message).toBe("nesting rejected");
    expect(calls).toBe(1);
    expect(struct.parse(Chain, { child: null })[0]).toBeNull();
  });

  test("leaves caller RangeErrors from getters and error maps unchanged", () => {
    const original = new RangeError("Maximum call stack size exceeded");
    const Throwing = struct.object({
      get child(): StructLike {
        throw original;
      },
    });
    const input = {
      get child(): unknown {
        throw original;
      },
    };
    const operations = [
      () => struct.parse(Throwing, {}),
      () => struct.parse(Chain, input),
      () => decodeJson(Chain, input),
      () => encodeJson(Chain, input),
      () =>
        struct.parse(Chain, nest("child", 257, null), {
          errorMap: () => {
            throw original;
          },
        }),
    ];
    for (const run of operations) {
      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(original);
    }
    expect(struct.parse(Chain, { child: null })[0]).toBeNull();
  });

  test("a union candidate past the limit fails like any other candidate", () => {
    const [error, output] = parse(Tree, nest("next", 100_000, null));
    expect(error?.issues[0]?.code).toBe("invalid_union");
    expect(output).toBeUndefined();

    const Fallback = struct.object({
      get next(): StructLike {
        return struct.or(Fallback, struct.any());
      },
    });
    const deep = nest("next", 100_000, null);
    expect(parse(Fallback, deep)).toEqual([
      null,
      expect.objectContaining({ next: expect.anything() }),
    ]);
  });
});
