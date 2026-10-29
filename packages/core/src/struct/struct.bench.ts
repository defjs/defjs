import assert from "node:assert/strict";
import { afterAll, describe, test, type BenchRunOptions } from "vitest";
import { materializeOutboundRequest } from "../internal/outbound_request";
import { decodeJson, encodeJson } from "./codec/json";
import { encodeStructValue } from "./introspection";
import { StructError, struct } from "./index";
import type { StructLike } from "./types";

const micro = { iterations: 10, time: 500, warmupTime: 100 };
const largeBatch = {
  iterations: 10,
  time: 1000,
  warmupIterations: 1,
  warmupTime: 100,
};
let sink: unknown;

function measure(
  name: string,
  run: () => void,
  options: BenchRunOptions,
): void {
  test(name, async ({ bench }) => {
    const result = await bench(name, run).run(options);
    assert.ok(result.latency.samplesCount > 0);
  });
}

function record(value: unknown): void {
  sink = value;
}

function makeObjectFixture(width: number) {
  const shape: Record<string, ReturnType<typeof struct.string>> = {};
  const payload: Record<string, string> = {};
  for (let index = 0; index < width; index += 1) {
    const key = `field${index}`;
    shape[key] = struct.string();
    payload[key] = `value${index}`;
  }
  return { payload, schema: struct.object(shape) };
}

function makeNestedFixture(depth: number, leaf: unknown = "leaf") {
  let schema: StructLike = struct.object({ value: struct.string() });
  let payload: unknown = { value: leaf };
  for (let level = 1; level < depth; level += 1) {
    schema = struct.object({ child: schema, level: struct.number() });
    payload = { child: payload, level };
  }
  return { payload, schema };
}

function makeArrayFixture(length: number) {
  return {
    payload: Array.from({ length }, (_, index) => ({
      id: index,
      name: `item${index}`,
    })),
    schema: struct.array(
      struct.object({ id: struct.number(), name: struct.string() }),
    ),
  };
}

function makeObjectEncodeFixture(width: number) {
  const aliasShape: Record<string, ReturnType<typeof struct.string>> = {};
  const plainShape: Record<string, ReturnType<typeof struct.string>> = {};
  const payload: Record<string, string> = {};
  const wirePayload: Record<string, string> = {};
  for (let index = 0; index < width; index += 1) {
    const key = `field${index}`;
    const wireKey = `wire${index}`;
    plainShape[key] = struct.string();
    aliasShape[key] = struct.string().alias(wireKey);
    payload[key] = `value${index}`;
    wirePayload[wireKey] = `value${index}`;
  }
  return {
    aliasSchema: struct.object(aliasShape),
    payload,
    plainSchema: struct.object(plainShape),
    width,
    wirePayload,
  };
}

function makeIntersectionFixture(branches: number) {
  const payload: Record<string, string> = {};
  const options = Array.from({ length: branches }, (_, index) => {
    const key = `field${index}`;
    payload[key] = `value${index}`;
    return struct.object({ [key]: struct.string() });
  });
  return {
    branches,
    payload,
    schema: struct.intersection(
      ...(options as [(typeof options)[number], ...typeof options]),
    ),
  };
}

function makeEquivalentUnionFixture(branches: number, width: number) {
  const payload: Record<string, string> = {};
  const options = Array.from({ length: branches }, (_, branch) => {
    const shape: Record<string, ReturnType<typeof struct.string>> = {};
    for (let offset = 0; offset < width; offset += 1) {
      const index = (branch + offset) % width;
      const key = `field${index}`;
      shape[key] = struct.string();
      payload[key] = `value${index}`;
    }
    return struct.object(shape);
  });
  return {
    branches,
    payload,
    schema: struct.or(
      ...(options as [(typeof options)[number], ...typeof options]),
    ),
    width,
  };
}

function makeLateWireDiscriminatedUnionFixture(size: number, fields = 10) {
  const fillerCount = fields - 2;
  const options = Array.from({ length: size }, (_, index) => {
    const shape: Record<string, StructLike> = {};
    for (let filler = 0; filler < fillerCount; filler += 1) {
      shape[`filler${filler}`] = struct.string();
    }
    shape["kind"] = struct.literal(`kind${index}`).alias(`type_${index}`);
    shape["value"] = struct.string().alias("payload");
    return struct.object(shape);
  });
  const payload: Record<string, string> = {
    [`type_${size - 1}`]: `kind${size - 1}`,
    payload: "value",
  };
  for (let filler = 0; filler < fillerCount; filler += 1) {
    payload[`filler${filler}`] = `value${filler}`;
  }
  return {
    payload,
    schema: struct.discriminatedUnion("kind", options as never),
    fields,
    size,
  };
}

function makeUnionOptions(size: number, aliases = false) {
  const options = Array.from({ length: size }, (_, index) =>
    struct.object({
      kind: aliases
        ? struct.literal(`kind${index}`).alias("type")
        : struct.literal(`kind${index}`),
      value: aliases ? struct.string().alias("payload") : struct.string(),
    }),
  );
  return options as [(typeof options)[number], ...typeof options];
}

function makeOrdinaryUnionFixture(size: number) {
  const options = makeUnionOptions(size);
  return {
    failure: { kind: "missing", value: "value" },
    payloads: Array.from({ length: size }, (_, index) => ({
      kind: `kind${index}`,
      value: "value",
    })),
    schema: struct.or(...options),
  };
}

function makeDiscriminatedUnionFixture(size: number, aliases = false) {
  const options = makeUnionOptions(size, aliases);
  return {
    aliasPayloads: Array.from({ length: size }, (_, index) => ({
      payload: "value",
      type: `kind${index}`,
    })),
    payloads: Array.from({ length: size }, (_, index) => ({
      kind: `kind${index}`,
      value: "value",
    })),
    schema: struct.discriminatedUnion("kind", options),
  };
}

function constructSchemaBatch(count: number) {
  let schema: StructLike | undefined;
  for (let index = 0; index < count; index += 1) {
    schema = struct
      .object({
        active: struct.boolean().nullish(),
        id: struct.string().alias("id"),
        label: struct.string().optional().alias("label"),
        score: struct.number().nullable(),
      })
      .optional();
  }
  return schema;
}

function assertParse(schema: StructLike, payload: unknown): void {
  const [error] = struct.parse(schema, payload);
  assert.equal(error, null);
}

function plain(value: unknown): object {
  return { ...(value as object) };
}

const objectFixtures = [4, 16, 64].map(makeObjectFixture);
const nestedFixtures = [1, 3, 8].map((depth) => makeNestedFixture(depth));
const nestedDepth64Valid = makeNestedFixture(64);
const nestedDepth64Invalid = makeNestedFixture(64, 1);
const arrayFixtures = [0, 10, 1000].map(makeArrayFixture);
const failureSchema = struct.object({
  first: struct.string(),
  middle: struct.string(),
  penultimate: struct.string(),
  last: struct.string(),
});
const failureFirst = {
  first: 1,
  last: "last",
  middle: "middle",
  penultimate: "penultimate",
};
const failureLast = {
  first: "first",
  last: 1,
  middle: "middle",
  penultimate: "penultimate",
};
const unionFixtures = [2, 8, 32].map((size) => ({
  size,
  ...makeOrdinaryUnionFixture(size),
}));
const discriminatedFixtures = [2, 8, 32].map((size) => ({
  alias: makeDiscriminatedUnionFixture(size, true),
  plain: makeDiscriminatedUnionFixture(size),
  size,
}));
const lateWireDiscriminatedFixtures = [2, 8, 32].map((size) =>
  makeLateWireDiscriminatedUnionFixture(size),
);
const lateWireDiscriminated32x64 = makeLateWireDiscriminatedUnionFixture(
  32,
  64,
);
const objectEncodeFixtures = [4, 16, 64, 256].map(makeObjectEncodeFixture);
const intersectionFixtures = [2, 8, 16, 64].map(makeIntersectionFixture);
const intersection64Fixture = intersectionFixtures.at(-1);
const unionEncodeUnique = struct.or(
  struct.object({ kind: struct.literal("number"), value: struct.number() }),
  struct.object({ kind: struct.literal("text"), value: struct.string() }),
);
const unionEncodeUniqueValue = { kind: "number" as const, value: 1 };
const equivalentUnionFixtures = [2, 8, 32].map((branches) =>
  makeEquivalentUnionFixture(branches, 16),
);
const equivalentUnionWidthFixtures = [2, 16, 64].map((width) =>
  makeEquivalentUnionFixture(8, width),
);
const requestSchema = struct.object({
  id: struct.string(),
  page: struct.number(),
  size: struct.number(),
  trace: struct.string(),
  user: struct.object({ active: struct.boolean(), name: struct.string() }),
});
const requestPayload = {
  id: "user-1",
  page: 1,
  size: 20,
  trace: "trace-1",
  user: { active: true, name: "Miao" },
};
const placeRequest = (input: typeof requestPayload) => ({
  body: input.user,
  headers: { trace: input.trace },
  path: { id: input.id },
  query: { page: input.page, size: input.size },
});

assert.notEqual(constructSchemaBatch(1), undefined);
assert.notEqual(constructSchemaBatch(1_000), undefined);
assertParse(
  objectFixtures[0]?.schema as StructLike,
  objectFixtures[0]?.payload,
);
assertParse(
  nestedFixtures[2]?.schema as StructLike,
  nestedFixtures[2]?.payload,
);
assertParse(nestedDepth64Valid.schema, nestedDepth64Valid.payload);
assertParse(arrayFixtures[2]?.schema as StructLike, arrayFixtures[2]?.payload);
const [firstFailure] = struct.parse(failureSchema, failureFirst);
assert.ok(firstFailure instanceof StructError);
assert.deepEqual(firstFailure.issues[0]?.path, ["first"]);
const [lastFailure] = struct.parse(failureSchema, failureLast);
assert.ok(lastFailure instanceof StructError);
assert.deepEqual(lastFailure.issues[0]?.path, ["last"]);
const [depth64Failure] = struct.parse(
  nestedDepth64Invalid.schema,
  nestedDepth64Invalid.payload,
);
assert.ok(depth64Failure instanceof StructError);
assert.deepEqual(depth64Failure.issues[0]?.path, [
  ...Array<string>(63).fill("child"),
  "value",
]);
assertParse(
  unionFixtures[2]?.schema as StructLike,
  unionFixtures[2]?.payloads[31],
);
const [ordinaryUnionAllFailure] = struct.parse(
  unionFixtures[2]?.schema as StructLike,
  unionFixtures[2]?.failure,
);
assert.ok(ordinaryUnionAllFailure instanceof StructError);
assert.equal(ordinaryUnionAllFailure.issues[0]?.code, "invalid_union");
assertParse(
  discriminatedFixtures[2]?.plain.schema as StructLike,
  discriminatedFixtures[2]?.plain.payloads[31],
);
assert.deepEqual(
  plain(
    decodeJson(
      discriminatedFixtures[2]?.alias.schema as StructLike,
      discriminatedFixtures[2]?.alias.aliasPayloads[31],
    ),
  ),
  {
    kind: "kind31",
    value: "value",
  },
);
assert.deepEqual(
  plain(
    decodeJson(
      lateWireDiscriminatedFixtures[2]?.schema as StructLike,
      lateWireDiscriminatedFixtures[2]?.payload,
    ),
  ),
  {
    filler0: "value0",
    filler1: "value1",
    filler2: "value2",
    filler3: "value3",
    filler4: "value4",
    filler5: "value5",
    filler6: "value6",
    filler7: "value7",
    kind: "kind31",
    value: "value",
  },
);
const lateWire32x64Decoded = decodeJson(
  lateWireDiscriminated32x64.schema,
  lateWireDiscriminated32x64.payload,
) as Record<string, unknown>;
assert.equal(Object.keys(lateWire32x64Decoded).length, 64);
assert.equal(lateWire32x64Decoded["kind"], "kind31");
assert.equal(lateWire32x64Decoded["value"], "value");
assert.deepEqual(
  plain(
    encodeStructValue(
      objectEncodeFixtures[3]?.plainSchema as StructLike,
      objectEncodeFixtures[3]?.payload,
    ),
  ),
  objectEncodeFixtures[3]?.payload,
);
assert.deepEqual(
  plain(
    encodeJson(
      objectEncodeFixtures[3]?.aliasSchema as StructLike,
      objectEncodeFixtures[3]?.payload,
    ),
  ),
  objectEncodeFixtures[3]?.wirePayload,
);
assert.ok(intersection64Fixture);
assert.equal(intersection64Fixture.branches, 64);
assert.deepEqual(
  plain(
    struct.parse(
      intersection64Fixture.schema,
      intersection64Fixture.payload,
    )[1],
  ),
  intersection64Fixture.payload,
);
assert.deepEqual(
  plain(
    encodeStructValue(
      intersection64Fixture.schema,
      intersection64Fixture.payload,
    ),
  ),
  intersection64Fixture.payload,
);
assert.deepEqual(
  plain(encodeStructValue(unionEncodeUnique, unionEncodeUniqueValue)),
  unionEncodeUniqueValue,
);
assert.deepEqual(
  plain(
    encodeStructValue(
      equivalentUnionFixtures[2]?.schema as StructLike,
      equivalentUnionFixtures[2]?.payload,
    ),
  ),
  equivalentUnionFixtures[2]?.payload,
);
assert.deepEqual(
  plain(
    encodeStructValue(
      equivalentUnionWidthFixtures[2]?.schema as StructLike,
      equivalentUnionWidthFixtures[2]?.payload,
    ),
  ),
  equivalentUnionWidthFixtures[2]?.payload,
);
assertParse(requestSchema, requestPayload);

describe("Struct performance", () => {
  describe("construct schema", () => {
    for (const count of [1, 100, 1_000, 10_000]) {
      measure(
        `construct/schema batch ${count}`,
        () => {
          record(constructSchemaBatch(count));
        },
        micro,
      );
    }
    measure(
      "construct/schema batch 100000",
      () => {
        record(constructSchemaBatch(100_000));
      },
      largeBatch,
    );
  });

  describe("parse object", () => {
    for (const { payload, schema } of objectFixtures) {
      measure(
        `parse/object width ${Object.keys(payload).length}`,
        () => {
          record(struct.parse(schema, payload));
        },
        micro,
      );
    }
    for (const { payload, schema } of nestedFixtures) {
      let depth = 1;
      for (
        let current = payload as { child?: unknown };
        current.child;
        current = current.child as { child?: unknown }
      ) {
        depth += 1;
      }
      measure(
        `parse/object depth ${depth}`,
        () => {
          record(struct.parse(schema, payload));
        },
        micro,
      );
    }
    measure(
      "parse/object depth 64 valid leaf",
      () => {
        record(
          struct.parse(nestedDepth64Valid.schema, nestedDepth64Valid.payload),
        );
      },
      micro,
    );
    measure(
      "parse/object depth 64 invalid leaf",
      () => {
        record(
          struct.parse(
            nestedDepth64Invalid.schema,
            nestedDepth64Invalid.payload,
          ),
        );
      },
      micro,
    );
    for (const { payload, schema } of arrayFixtures) {
      measure(
        `parse/array length ${payload.length}`,
        () => {
          record(struct.parse(schema, payload));
        },
        micro,
      );
    }
    measure(
      "parse/failure first field",
      () => {
        record(struct.parse(failureSchema, failureFirst));
      },
      micro,
    );
    measure(
      "parse/failure last field",
      () => {
        record(struct.parse(failureSchema, failureLast));
      },
      micro,
    );
  });

  describe("parse union", () => {
    for (const { failure, payloads, schema, size } of unionFixtures) {
      for (const [position, index] of [
        ["first", 0],
        ["middle", Math.floor(size / 2)],
        ["last", size - 1],
      ] as const) {
        measure(
          `parse/union ${size} ${position} hit`,
          () => {
            record(struct.parse(schema, payloads[index]));
          },
          micro,
        );
      }
      measure(
        `parse/union ${size} all fail`,
        () => {
          record(struct.parse(schema, failure));
        },
        micro,
      );
    }
  });

  describe("parse discriminated union", () => {
    for (const { alias, plain, size } of discriminatedFixtures) {
      measure(
        `parse/discriminated union ${size} plain`,
        () => {
          record(struct.parse(plain.schema, plain.payloads[size - 1]));
        },
        micro,
      );
      measure(
        `parse/discriminated union ${size} alias decodeJson`,
        () => {
          record(decodeJson(alias.schema, alias.aliasPayloads[size - 1]));
        },
        micro,
      );
    }
    for (const { payload, schema, size } of lateWireDiscriminatedFixtures) {
      measure(
        `parse/discriminated union ${size} alias late wire key decodeJson`,
        () => {
          record(decodeJson(schema, payload));
        },
        micro,
      );
    }
    measure(
      "parse/discriminated union 32 alias late wire key 64 fields decodeJson",
      () => {
        record(
          decodeJson(
            lateWireDiscriminated32x64.schema,
            lateWireDiscriminated32x64.payload,
          ),
        );
      },
      micro,
    );
  });

  describe("encode", () => {
    for (const {
      aliasSchema,
      payload,
      plainSchema,
      width,
    } of objectEncodeFixtures) {
      measure(
        `encode/object plain width ${width}`,
        () => {
          record(encodeStructValue(plainSchema, payload));
        },
        micro,
      );
      measure(
        `encode/object alias width ${width}`,
        () => {
          record(encodeJson(aliasSchema, payload));
        },
        micro,
      );
    }
    for (const { branches, payload, schema } of intersectionFixtures) {
      measure(
        `parse/intersection ${branches} branches`,
        () => {
          record(struct.parse(schema, payload));
        },
        micro,
      );
      measure(
        `encode/intersection ${branches} branches`,
        () => {
          record(encodeStructValue(schema, payload));
        },
        micro,
      );
    }
    measure(
      "encode/union unique match",
      () => {
        record(encodeStructValue(unionEncodeUnique, unionEncodeUniqueValue));
      },
      micro,
    );
    for (const {
      branches,
      payload,
      schema,
      width,
    } of equivalentUnionFixtures) {
      measure(
        `encode/union equivalent ${branches} branches width ${width}`,
        () => {
          record(encodeStructValue(schema, payload));
        },
        micro,
      );
    }
    for (const {
      branches,
      payload,
      schema,
      width,
    } of equivalentUnionWidthFixtures) {
      measure(
        `encode/union equivalent width sweep ${width} (${branches} branches)`,
        () => {
          record(encodeStructValue(schema, payload));
        },
        micro,
      );
    }
  });

  describe("parse endpoint input", () => {
    measure(
      "parse/endpoint input with a nested object",
      () => {
        record(struct.parse(requestSchema, requestPayload));
      },
      micro,
    );
  });

  describe("additional hot paths", () => {
    for (const {
      branches,
      payload,
      schema,
      width,
    } of equivalentUnionFixtures) {
      assert.deepEqual(plain(encodeJson(schema, payload)), payload);
      measure(
        `encode/JSON union equivalent ${branches} branches width ${width}`,
        () => record(encodeJson(schema, payload)),
        micro,
      );
    }
    for (const size of [8, 128, 1024]) {
      const values = Array.from(
        { length: size },
        (_, index) => `value${index}`,
      ) as [string, ...string[]];
      const schema = struct.enum(values);
      const input = values.at(-1);
      assertParse(schema, input);
      measure(
        `parse/enum ${size} last hit`,
        () => record(struct.parse(schema, input)),
        micro,
      );
    }
    const union32 = unionFixtures[2];
    assert.ok(union32);
    const errorMap = () => undefined;
    measure(
      "parse/union 32 last hit with errorMap",
      () =>
        record(
          struct.parse(union32.schema, union32.payloads[31], { errorMap }),
        ),
      micro,
    );
    const options = makeUnionOptions(32);
    measure(
      "construct/union 32 existing options",
      () => record(struct.or(...options)),
      micro,
    );
    const array = makeArrayFixture(1000);
    array.payload[0] = { id: "invalid" as unknown as number, name: "first" };
    assert.ok(struct.parse(array.schema, array.payload)[0]);
    measure(
      "parse/array length 1000 first item failure",
      () => record(struct.parse(array.schema, array.payload)),
      micro,
    );
    const parsed = struct.parse(requestSchema, requestPayload)[1];
    assert.ok(parsed);
    const built = materializeOutboundRequest(placeRequest(parsed), "http");
    assert.equal(built.body, '{"active":true,"name":"Miao"}');
    measure(
      "request/parse, place, and JSON build four sections",
      () => {
        const [error, value] = struct.parse(requestSchema, requestPayload);
        if (error) throw error;
        record(materializeOutboundRequest(placeRequest(value), "http"));
      },
      micro,
    );
  });

  afterAll(() => {
    assert.notEqual(sink, undefined);
  });
});
