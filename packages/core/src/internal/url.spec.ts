import { describe, expect, test } from "vitest";
import {
  appendRecordToHeaders,
  createResolvedRequestUrl,
  createSearchParams,
  fillUrl,
} from "./url";

describe("url helpers", () => {
  test("should resolve endpoint urls with normalized client endpoint path", () => {
    expect(
      createResolvedRequestUrl(
        "https://api.example.com/v1",
        "/user/info",
      ).toString(),
    ).toBe("https://api.example.com/v1/user/info");
    expect(
      createResolvedRequestUrl(
        "https://api.example.com/v1/",
        "user/info",
        "page=1",
      ).toString(),
    ).toBe("https://api.example.com/v1/user/info?page=1");
  });

  test("should reject invalid endpoint paths", () => {
    expect(() => createResolvedRequestUrl("/api", "/user/info")).toThrowError(
      "Client endpoint must be a valid URL",
    );
    expect(() =>
      createResolvedRequestUrl(
        "https://api.example.com/v1",
        "https://other.example.com/user",
      ),
    ).toThrowError("Endpoint path must not be an absolute URL");
    expect(() =>
      createResolvedRequestUrl(
        "https://api.example.com/v1",
        "/user/info?page=1",
      ),
    ).toThrowError("Endpoint path must not include query or hash");
    expect(() =>
      createResolvedRequestUrl(
        "https://api.example.com/v1",
        "/user/info#fragment",
      ),
    ).toThrowError("Endpoint path must not include query or hash");
  });

  test("should reject parser failures and same-origin absolute paths", () => {
    expect(() =>
      createResolvedRequestUrl("https://example.test/api", "https://["),
    ).toThrow("Endpoint path must resolve to a valid URL");
    expect(() =>
      createResolvedRequestUrl(
        "https://example.test/api",
        "https://example.test/api/user",
      ),
    ).toThrow("Endpoint path must not be an absolute URL");
    expect(() =>
      createResolvedRequestUrl(
        "https://example.test/api",
        "//example.test/api/user",
      ),
    ).toThrow("Endpoint path must not be an absolute URL");
    expect(() =>
      createResolvedRequestUrl("https://example.test/api", "nested\\leaf"),
    ).toThrow("Endpoint path must not include C0 controls or backslashes");
  });

  test("should fill urls and create search params from request values", () => {
    expect(fillUrl("/users/:id", { id: "a/b ?#%猫" })).toBe(
      "/users/a%2Fb%20%3F%23%25%E7%8C%AB",
    );
    expect(fillUrl("/:id/:id", { id: "a/b" })).toBe("/a%2Fb/a%2Fb");
    expect(fillUrl("/users/:id", { id: "%2F" })).toBe("/users/%252F");
    expect(() => fillUrl("/users/:id", { id: "" })).toThrow(
      'path value for "id" must be a non-empty path segment',
    );
    expect(() => fillUrl("/users/:id", { id: "." })).toThrow(
      'path value for "id" must not be a dot segment',
    );
    expect(() => fillUrl("/users/:id", { id: ".." })).toThrow(
      'path value for "id" must not be a dot segment',
    );

    expect(fillUrl("/user/:id/:name", { id: "1", name: "miao" })).toBe(
      "/user/1/miao",
    );

    expect(() => fillUrl("/user/:id")).toThrow("Missing path param: id");
    expect(() => fillUrl("/user/:id", {})).toThrow("Missing path param: id");
    expect(() => fillUrl("/user/:id/:name", { id: "1" })).toThrow(
      "Missing path param: name",
    );
    expect(() => fillUrl("/files/:constructor", {})).toThrow(
      "Missing path param: constructor",
    );

    expect(() =>
      createSearchParams({
        filters: { active: true },
      }),
    ).toThrow(
      'a query serializer is required for nested query value "filters"',
    );
    expect(() =>
      createSearchParams({
        filters: [{ active: true }] as never,
      }),
    ).toThrow(
      'a query serializer is required for nested query value "filters"',
    );
    expect(() =>
      createSearchParams({
        tags: ["a", { active: true } as never],
      }),
    ).toThrow('a query serializer is required for nested query value "tags"');

    const params = createSearchParams({
      include: true,
      page: 1,
      skip: undefined,
      tags: ["a", "b"],
    });

    expect(params.toString()).toBe("include=true&page=1&tags=a&tags=b");

    expect(() =>
      createSearchParams({
        empty: null,
      }),
    ).toThrow('query value for "empty" must not be null');
    expect(() =>
      createSearchParams({
        tags: ["a", null],
      }),
    ).toThrow('query value for "tags" must not be null');

    const paramsWithUndefinedArray = createSearchParams({
      tags: [undefined as never],
    });
    expect(paramsWithUndefinedArray.toString()).toBe("");
  });

  test("should append record-like values into headers", () => {
    const fromHeaders = new Headers();
    fromHeaders.set("x-trace-id", "trace-1");

    const copied = new Headers();
    appendRecordToHeaders(copied, fromHeaders);
    expect(copied.get("x-trace-id")).toBe("trace-1");

    const fromTuples = new Headers();
    appendRecordToHeaders(fromTuples, [
      ["set-cookie", "a=1"],
      ["set-cookie", "b=2"],
    ]);
    expect(fromTuples.get("set-cookie")).toBe("a=1, b=2");

    const fromRecord = new Headers();
    appendRecordToHeaders(fromRecord, {
      "x-number": 1,
      "x-roles": ["admin", "user"],
      "x-skip": undefined,
    });
    expect(fromRecord.get("x-number")).toBe("1");
    expect(fromRecord.get("x-roles")).toBe("admin, user");
    expect(fromRecord.has("x-skip")).toBe(false);

    expect(() =>
      appendRecordToHeaders(new Headers(), { "x-object": { nested: true } }),
    ).toThrow('header value for "x-object" requires a scalar value');
    expect(() =>
      appendRecordToHeaders(new Headers(), {
        "x-object": [{ nested: true }] as never,
      }),
    ).toThrow('header value for "x-object" requires a scalar value');
  });

  test.each<{
    name: string;
    value: Parameters<typeof appendRecordToHeaders>[1];
    expected: string;
  }>([
    {
      name: "Headers",
      value: new Headers({ "x-scope": "command" }),
      expected: "command",
    },
    {
      name: "scalar record",
      value: { "x-scope": "command" },
      expected: "command",
    },
    {
      name: "array record",
      value: { "x-scope": ["first", "second"] },
      expected: "first, second",
    },
    {
      name: "mixed-case array record",
      value: { "X-Scope": ["first"], "x-scope": ["second"] },
      expected: "first, second",
    },
    {
      name: "pairs",
      value: [
        ["X-Scope", "first"],
        ["x-scope", "second"],
      ],
      expected: "first, second",
    },
    { name: "undefined input", value: undefined, expected: "default" },
    {
      name: "undefined field",
      value: { "x-scope": undefined },
      expected: "default",
    },
    { name: "empty pairs", value: [], expected: "default" },
    {
      name: "empty array field",
      value: { "x-scope": [] },
      expected: "default",
    },
  ])(
    "overrides defaults without losing command values for $name",
    ({ value, expected }) => {
      const headers = new Headers({ "X-Scope": "default", "X-Keep": "keep" });

      appendRecordToHeaders(headers, value);

      expect(headers.get("x-scope")).toBe(expected);
      expect(headers.get("x-keep")).toBe("keep");
    },
  );

  test("keeps an own __proto__ key in path, query, and header application", () => {
    const record: { [key: string]: string } = Object.create(null);
    Object.defineProperty(record, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "safe",
      writable: true,
    });

    const headers = new Headers();
    appendRecordToHeaders(headers, record);

    expect(fillUrl("/files/:__proto__", record)).toBe("/files/safe");
    expect(createSearchParams(record).get("__proto__")).toBe("safe");
    expect(headers.get("__proto__")).toBe("safe");
    expect(
      (Object.prototype as { [key: string]: unknown })["polluted"],
    ).toBeUndefined();
  });
});
