import { describe, expect, test } from "vitest";
import {
  createResolvedRequestUrl,
  createSearchParams,
  fillUrl,
  mergeHeaders,
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
        filters: [{ active: true }],
      }),
    ).toThrow(
      'a query serializer is required for nested query value "filters"',
    );
    expect(() =>
      createSearchParams({
        tags: ["a", { active: true }],
      }),
    ).toThrow('a query serializer is required for nested query value "tags"');

    const params = createSearchParams({
      include: true,
      page: 1,
      skip: undefined,
      tags: ["a", "b"],
    });

    expect(params.toString()).toBe("include=true&page=1&tags=a&tags=b");

    const paramsWithUndefinedArray = createSearchParams({
      tags: [undefined],
    });
    expect(paramsWithUndefinedArray.toString()).toBe("");
  });

  describe("mergeHeaders", () => {
    test("copies every name of the source into the target", () => {
      const target = new Headers({ "x-keep": "keep" });

      mergeHeaders(target, new Headers({ "x-trace-id": "trace-1" }));

      expect(target.get("x-trace-id")).toBe("trace-1");
      expect(target.get("x-keep")).toBe("keep");
    });

    test("replaces a target value of the same name, whatever its case", () => {
      const target = new Headers({ "X-Scope": "default", "X-Keep": "keep" });

      mergeHeaders(target, new Headers({ "x-scope": "command" }));

      expect(target.get("x-scope")).toBe("command");
      expect(target.get("x-keep")).toBe("keep");
    });

    test("keeps each Set-Cookie of the source and drops the target's", () => {
      const target = new Headers([["set-cookie", "default=0"]]);
      const source = new Headers([
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
      ]);

      mergeHeaders(target, source);

      expect(target.getSetCookie()).toEqual(["a=1", "b=2"]);
    });

    test("leaves the target alone when the source is empty", () => {
      const target = new Headers({ "x-scope": "default" });

      mergeHeaders(target, new Headers());

      expect(target.get("x-scope")).toBe("default");
    });
  });

  test("keeps an own __proto__ key in path and query application", () => {
    const record: { [key: string]: string } = {};
    Object.defineProperty(record, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "safe",
      writable: true,
    });

    expect(fillUrl("/files/:__proto__", record)).toBe("/files/safe");
    expect(createSearchParams(record).get("__proto__")).toBe("safe");
    expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined();
  });
});
