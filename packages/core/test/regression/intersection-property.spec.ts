import { expect, test } from "vitest";
import { struct, type AnyStruct } from "../../src/struct";
import { parseEndpointInput } from "../../src/internal/endpoint_input";
import { encodeOutbound } from "../../src/internal/outbound_request";
import { encodeJson } from "../../src/struct/codec/json";

type Pair = {
  label: string;
  left: AnyStruct;
  right: AnyStruct;
  value: unknown;
};

// Same xorshift32 as the round-13 audit. Wire names are reserved `w_*` so a literal extra cannot impersonate an alias.
function makeRandom(seed: number): (count: number) => number {
  let state = seed >>> 0;
  return (count) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % count;
  };
}

function pair(
  pick: (count: number) => number,
  depth: number,
  exotic = false,
): Pair {
  if (depth === 0) {
    const value = pick(100);
    const text = pick(2) === 0;
    const leaf = text ? struct.string() : struct.number();
    return {
      label: "leaf",
      left: struct.object({ name: leaf.alias("w_left") }),
      right: struct.object({
        name: leaf.alias(pick(2) ? "w_right" : "w_left"),
      }),
      value: { name: text ? `v${value}` : value },
    };
  }
  const child = pair(pick, depth - 1, exotic);
  // ROUND13_EXOTIC=1 adds any/unknown unions and passthrough containers. The regular suite leaves it unset.
  switch (pick(exotic ? 19 : 15)) {
    case 0:
      return {
        label: `split(${child.label})`,
        left: struct.object({ row: child.left.alias("w_parent_left") }),
        right: struct.object({ row: child.right.alias("w_parent_right") }),
        value: { row: child.value },
      };
    case 1:
      return {
        label: `array-tuple(${child.label})`,
        left: struct.array(child.left),
        right: struct.tuple([child.right]),
        value: [child.value],
      };
    case 2:
      return {
        label: `record-object(${child.label})`,
        left: struct.record(child.left),
        right: struct.object({ one: child.right.alias("w_one") }),
        value: { extra: child.value, one: child.value },
      };
    case 3:
      return {
        label: `records(${child.label})`,
        left: struct.record(child.left),
        right: struct.record(child.right),
        value: { one: child.value },
      };
    case 4:
      return {
        label: `shared(${child.label})`,
        left: struct.object({ row: child.left }),
        right: struct.object({ row: child.right }),
        value: { row: child.value },
      };
    case 5:
      return {
        label: `identity(${child.label})`,
        left: struct.intersection(child.left, struct.unknown()),
        right: child.right,
        value: child.value,
      };
    case 6:
      return {
        label: `union(${child.label})`,
        left: struct.or(child.left, struct.literal("other")),
        right: child.right,
        value: child.value,
      };
    case 7:
      return {
        label: `discriminator(${child.label})`,
        left: struct.discriminatedUnion("kind", [
          struct.object({
            kind: struct.literal("item").alias("w_kind"),
            row: child.left,
          }),
          struct.object({
            kind: struct.literal("other"),
            other: struct.string(),
          }),
        ]),
        right: struct.object({
          kind: struct.literal("item").alias("w_kind"),
          row: child.right,
        }),
        value: { kind: "item", row: child.value },
      };
    case 8:
      return {
        label: `nullish(${child.label})`,
        left: child.left.nullish(),
        right: child.right.nullish(),
        value: [child.value, null, undefined][pick(3)],
      };
    case 9:
      return {
        label: `record-any(${child.label})`,
        left: struct.record(struct.any()),
        right: struct.object({ row: child.right }),
        value: { extra: child.value, row: child.value },
      };
    case 10:
      return {
        label: `record-unknown(${child.label})`,
        left: struct.record(struct.unknown()),
        right: struct.object({ row: child.left }),
        value: { extra: child.value, row: child.value },
      };
    case 11:
      return {
        label: `field-any(${child.label})`,
        left: struct.object({ row: struct.any() }),
        right: struct.object({ row: child.right }),
        value: { row: child.value },
      };
    case 12:
      return {
        label: `field-unknown(${child.label})`,
        left: struct.object({ row: struct.unknown().alias("w_unknown") }),
        right: struct.object({ row: child.right.alias("w_row") }),
        value: { row: child.value },
      };
    case 13:
      return {
        label: `record-unknown-field(${child.label})`,
        left: struct.object({ note: struct.any(), row: child.left }),
        right: struct.record(struct.unknown()),
        value: { note: child.value, row: child.value },
      };
    case 15:
      return {
        label: `union-any(${child.label})`,
        left: child.left,
        right: struct.or(struct.any(), struct.number()),
        value: child.value,
      };
    case 16:
      return {
        label: `union-unknown(${child.label})`,
        left: child.left,
        right: struct.or(struct.unknown(), struct.number()),
        value: child.value,
      };
    case 17:
      return {
        label: `array-any-nullish(${child.label})`,
        left: struct.array(struct.any().nullish()),
        right: struct.array(child.right.nullish()),
        value: [child.value, null, undefined],
      };
    case 18:
      return {
        label: `array-scalar(${child.label})`,
        left: struct.array(struct.any()),
        right: struct.array(struct.string()),
        value: ["N"],
      };
    default:
      return {
        label: `nested(${child.label})`,
        left: struct.intersection(child.left, child.right),
        right: child.left,
        value: child.value,
      };
  }
}

function plain(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// Every expected leaf must survive. An extra `w_*` key is another member's alias, not a literal extra.
function compare(actual: unknown, expected: unknown, path = "$"): void {
  if (Array.isArray(expected)) {
    expect(actual, `${path}: expected array`).toBeInstanceOf(Array);
    const list = actual as unknown[];
    expect(list.length, `${path}: length`).toBe(expected.length);
    expected.forEach((item, index) =>
      compare(list[index], item, `${path}[${index}]`),
    );
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(actual, `${path}: expected object`).toEqual(expect.any(Object));
    expect(Array.isArray(actual), `${path}: expected object`).toBe(false);
    const output = actual as { [key: string]: unknown };
    for (const [key, child] of Object.entries(expected)) {
      expect(
        Object.hasOwn(output, key),
        `${path}.${key}: missing declared wire key`,
      ).toBe(true);
      compare(output[key], child, `${path}.${key}`);
    }
    for (const key of Object.keys(output)) {
      expect(
        Object.hasOwn(expected, key) || !key.startsWith("w_"),
        `${path}.${key}: unexpected wire key`,
      ).toBe(true);
    }
    return;
  }
  expect({ at: path, value: actual }).toEqual({ at: path, value: expected });
}

type AttemptFailure = {
  actual?: unknown;
  error: string;
  expected?: unknown;
  index: number;
  label: string;
};

async function runAttempts(
  seed: number,
  attempts: number,
  maxDepth: number,
  exotic = false,
): Promise<{
  failed: AttemptFailure[];
  passed: number;
  rejectedInput: number;
}> {
  const pick = makeRandom(seed);
  const failed: AttemptFailure[] = [];
  let passed = 0;
  let rejectedInput = 0;
  for (let index = 0; index < attempts; index += 1) {
    const generated = pair(pick, 1 + pick(maxDepth), exotic);
    const schema = struct.object({
      payload: struct.intersection(generated.left, generated.right),
    });
    const input = { payload: generated.value };
    const [parseError] = struct.parse(schema, input);
    if (parseError) {
      rejectedInput += 1;
      continue;
    }
    let expected: unknown;
    let actual: unknown;
    try {
      const parsed = await parseEndpointInput(schema, input as never);
      expected = plain(encodeJson(schema, parsed));
      actual = plain(encodeOutbound(parsed));
      compare(actual, expected);
      passed += 1;
    } catch (error) {
      failed.push({
        actual,
        error: error instanceof Error ? error.message : String(error),
        expected,
        index,
        label: generated.label,
      });
    }
  }
  return { failed, passed, rejectedInput };
}

function readCount(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

test("parsed outbound encoding matches encodeJson except literal extras", async () => {
  const seed = readCount("ROUND13_SEED", 0x13c0ffee);
  const attempts = readCount("ROUND13_ATTEMPTS", 1_000);
  const maxDepth = readCount("ROUND13_DEPTH", 4);
  const exotic = process.env["ROUND13_EXOTIC"] === "1";
  const result = await runAttempts(seed, attempts, maxDepth, exotic);
  const summary = {
    attempts,
    examples: result.failed.slice(0, 5).map((failure) => ({
      actual: failure.actual,
      error: failure.error,
      expected: failure.expected,
      index: failure.index,
      label: failure.label,
    })),
    failed: result.failed.length,
    maxDepth,
    passed: result.passed,
    rejectedInput: result.rejectedInput,
    seed,
  };
  expect(result.failed.length === 0 ? { failed: 0 } : summary).toEqual({
    failed: 0,
  });
});
