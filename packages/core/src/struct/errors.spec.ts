import { describe, expect, test } from "vitest";

function parsed(text: string): unknown {
  return JSON.parse(text);
}
import type { ErrorMap } from "./index";
import { StructError, struct } from "./index";
import { parseStructTuple as parse } from "./parse";
import { method } from "../../test/method";

describe("StructError format / flatten / prettify", () => {
  const userStruct = struct.object({
    id: struct.string(),
    profile: struct.object({
      email: struct.string(),
    }),
    tags: struct.array(struct.string()),
  });

  test("format exposes only the first parse issue", () => {
    const [err] = parse(userStruct, {
      id: 42,
      profile: { email: false },
      tags: [10],
    });
    expect(err).toBeInstanceOf(StructError);
    if (!err) {
      throw new Error("expected parse error");
    }

    const tree = err.format();
    expect(tree._errors).toEqual([]);
    expect(tree["id"]).toEqual({
      _errors: ["Expected string at id, received number"],
    });
    expect(tree["profile"]).toBeUndefined();
    expect(tree["tags"]).toBeUndefined();
    expect(err.issues).toHaveLength(1);
  });

  test("flatten groups the first parse issue by path segment", () => {
    const [err] = parse(userStruct, {
      id: 42,
      profile: { email: false },
      tags: [10],
    });
    expect(err).toBeInstanceOf(StructError);
    if (!err) {
      throw new Error("expected parse error");
    }

    const flat = err.flatten();
    expect(flat.formErrors).toEqual([]);
    expect(flat.fieldErrors["id"]).toEqual([
      "Expected string at id, received number",
    ]);
    expect(flat.fieldErrors["profile"]).toBeUndefined();
    expect(flat.fieldErrors["tags"]).toBeUndefined();
  });

  test("flatten appends multiple issues under the same top-level key", () => {
    const error = new StructError([
      {
        code: "custom",
        expected: "email",
        message: "email is missing",
        path: ["profile", "email"],
        received: undefined,
      },
      {
        code: "custom",
        expected: "name",
        message: "name is missing",
        path: ["profile", "name"],
        received: undefined,
      },
      {
        code: "custom",
        expected: "string",
        message: "first item is invalid",
        path: [0, "first"],
        received: 1,
      },
      {
        code: "custom",
        expected: "string",
        message: "second item is invalid",
        path: [0, "second"],
        received: 2,
      },
    ]);
    expect(error.flatten()).toEqual({
      formErrors: [],
      fieldErrors: {
        profile: ["email is missing", "name is missing"],
        0: ["first item is invalid", "second item is invalid"],
      },
    });
  });

  test("flatten places empty-path issues in formErrors", () => {
    const err = new StructError([
      {
        code: "custom",
        expected: "form",
        message: "a must not be empty",
        path: [],
        received: { a: "" },
      },
    ]);

    const flat = err.flatten();
    expect(flat.formErrors).toEqual(["a must not be empty"]);
    expect(flat.fieldErrors).toEqual({});
  });

  test("prettify renders the first parse issue", () => {
    const [err] = parse(userStruct, {
      id: 42,
      profile: { email: false },
      tags: [10],
    });
    expect(err).toBeInstanceOf(StructError);
    if (!err) {
      throw new Error("expected parse error");
    }

    const text = err.prettify();
    expect(text).toContain("× id: Expected string at id, received number");
    expect(text).not.toContain("profile.email");
    expect(text).not.toContain("tags[0]");
  });

  test("format keeps a declared _errors field separate from node errors", () => {
    const [err] = parse(struct.object({ _errors: struct.string() }), {
      _errors: 42,
    });
    expect(err).toBeInstanceOf(StructError);
    if (!err) {
      throw new Error("expected parse error");
    }

    const tree = err.format();
    expect(tree._errors).toEqual([]);
    expect(tree["\\_errors"]).toEqual({
      _errors: ["Expected string at _errors, received number"],
    });
  });

  test("format and flatten keep attacker-controlled paths out of object prototypes", () => {
    const pollutionKey = "defjsStructErrorPolluted";
    const cases = [
      {
        input: parsed(`{"__proto__":{"${pollutionKey}":7}}`),
        schema: struct.record(struct.record(struct.string())),
        target: Object.prototype,
        topLevelKey: "__proto__",
      },
      {
        input: parsed(`{"constructor":{"prototype":{"${pollutionKey}":7}}}`),
        schema: struct.record(struct.record(struct.record(struct.string()))),
        target: Object.prototype,
        topLevelKey: "constructor",
      },
      {
        input: parsed(`{"toString":{"${pollutionKey}":7}}`),
        schema: struct.record(struct.record(struct.string())),
        target: method(Object.prototype, "toString"),
        topLevelKey: "toString",
      },
    ];

    try {
      for (const { input, schema, target, topLevelKey } of cases) {
        const [err] = struct.parse(schema, input);
        expect(err).toBeInstanceOf(StructError);
        if (!err) {
          throw new Error("expected parse error");
        }

        const tree = err.format();
        const flat = err.flatten();

        expect(Object.getPrototypeOf(tree)).toBeNull();
        expect(Object.hasOwn(tree, topLevelKey)).toBe(true);
        expect(Object.getPrototypeOf(flat.fieldErrors)).toBeNull();
        expect(Object.hasOwn(flat.fieldErrors, topLevelKey)).toBe(true);
        expect(Object.hasOwn(target, pollutionKey)).toBe(false);
      }
    } finally {
      Reflect.deleteProperty(Object.prototype, pollutionKey);
      Reflect.deleteProperty(
        method(Object.prototype, "toString"),
        pollutionKey,
      );
    }
  });

  test("prettify renders deep array paths without stray dots", () => {
    const matrix = struct.array(struct.array(struct.array(struct.string())));
    const [err] = parse(matrix, [[[1]]]);
    expect(err).toBeInstanceOf(StructError);

    expect(err?.prettify()).toContain(
      "× [0][0][0]: Expected string at [0][0][0], received number",
    );
  });

  test("format nests an issue under the node an earlier issue created", () => {
    const issue = (message: string, path: string[]) => ({
      code: "custom" as const,
      expected: "valid value",
      message,
      path,
      received: undefined,
    });
    const error = new StructError([
      issue("profile failed", ["profile"]),
      issue("name failed", ["profile", "name"]),
    ]);

    expect(error.format()).toEqual({
      _errors: [],
      profile: {
        _errors: ["profile failed"],
        name: { _errors: ["name failed"] },
      },
    });
  });

  test("prettify on empty issues falls back to a sane string", () => {
    const error = new StructError([]);
    expect(error.prettify()).toBe("Struct parse failed");
  });
});

describe("errors.ts errorMap", () => {
  test("parse errorMap overrides default issue messages", () => {
    const map: ErrorMap = (issue) => {
      if (issue.code === "invalid_type") {
        return `字段 ${issue.path.join(".")} 类型不符（期望 ${issue.expected}）`;
      }
      return undefined;
    };

    const [err] = parse(struct.string(), 42, { errorMap: map });
    expect(err).toBeInstanceOf(StructError);
    expect(err?.issues[0]?.message).toBe("字段  类型不符（期望 string）");
  });

  test("errorMap returning undefined preserves the default message", () => {
    const [err] = parse(struct.string(), 42, { errorMap: () => undefined });
    expect(err).toBeInstanceOf(StructError);
    expect(err?.issues[0]?.message).toBe(
      "Expected string at <root>, received number",
    );
  });

  test("errorMap returning an empty string replaces the default message", () => {
    const secret = "secret-value";
    const [err] = parse(struct.number(), secret, { errorMap: () => "" });
    expect(err).toBeInstanceOf(StructError);
    expect(err?.issues[0]?.message).toBe("");
    expect(err?.issues[0]?.received).toBe(secret);
    expect(err?.message).toBe("");
    expect(err?.prettify()).toBe("× <root>: ");
    expect(String(err)).not.toContain(secret);
  });

  test("omitting errorMap uses default messages", () => {
    const [after] = parse(struct.string(), 42);
    expect(after).toBeInstanceOf(StructError);
    expect(after?.issues[0]?.message).toBe(
      "Expected string at <root>, received number",
    );
  });

  test("default messages name the received kind and keep the value on the issue", () => {
    const secret = "ada.lovelace@example.test";
    const file = new File([secret], "secret-name.png");
    const blob = new Blob([secret], { type: "text/plain" });
    const when = new Date("2020-01-01T00:00:00.000Z");
    const cases: [unknown, string][] = [
      [secret, "string"],
      [123456789, "number"],
      [false, "boolean"],
      [10n, "bigint"],
      [Symbol("secret"), "symbol"],
      [() => secret, "function"],
      [null, "null"],
      [undefined, "undefined"],
      [[secret], "array"],
      [{ email: secret }, "object"],
      [file, "File"],
      [blob, "Blob"],
      [new ArrayBuffer(4), "ArrayBuffer"],
      [when, "Date"],
    ];

    for (const [value, kind] of cases) {
      // A number is valid for struct.number(), so that one case is rejected by struct.string() instead.
      const expected = typeof value === "number" ? "string" : "number";
      const schema = expected === "string" ? struct.string() : struct.number();
      const [err] = parse(schema, value);
      expect(err).toBeInstanceOf(StructError);
      const issue = err?.issues[0];
      expect(issue?.message).toBe(
        `Expected ${expected} at <root>, received ${kind}`,
      );
      expect(issue?.received).toBe(value);
      expect(issue?.message).not.toContain(secret);
      expect(issue?.message).not.toContain("secret-name");
      expect(issue?.message).not.toContain("123456789");
      expect(issue?.message).not.toContain("text/plain");
      expect(err?.prettify()).toBe(
        `× <root>: Expected ${expected} at <root>, received ${kind}`,
      );
      expect(String(err)).toBe(
        `StructError: Expected ${expected} at <root>, received ${kind}`,
      );
      expect(String(err)).not.toContain(secret);
    }
  });
});
