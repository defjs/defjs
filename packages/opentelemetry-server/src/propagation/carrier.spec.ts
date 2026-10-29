import { describe, expect, test } from "vitest";
import { headersGetter, headersSetter, queryStringSetter } from "./carrier";

describe("headersSetter", () => {
  test("sets header when carrier, key, and value are valid", () => {
    const headers = new Headers();
    headersSetter.set(headers, "x-trace", "abc123");
    expect(headers.get("x-trace")).toBe("abc123");
  });

  test("skips when carrier is null", () => {
    // @ts-expect-error carrier must be Headers, but setter defends against null
    expect(() => headersSetter.set(null, "x-trace", "abc")).not.toThrow();
  });

  test("skips when key is undefined", () => {
    const headers = new Headers();
    // @ts-expect-error key must be string, but setter defends against undefined
    headersSetter.set(headers, undefined, "abc");
    expect(headers.has("undefined")).toBe(false);
  });

  test("skips when value is undefined", () => {
    const headers = new Headers();
    // @ts-expect-error value must be string, but setter defends against undefined
    headersSetter.set(headers, "x-trace", undefined);
    expect(headers.has("x-trace")).toBe(false);
  });
});

describe("headersGetter", () => {
  test("returns keys from Headers", () => {
    const headers = new Headers({ "x-trace": "abc", "content-type": "json" });
    const keys = headersGetter.keys(headers);
    expect(keys).toContain("x-trace");
    expect(keys).toContain("content-type");
  });

  test("returns empty array when carrier is null", () => {
    // @ts-expect-error carrier must be Headers, but getter defends against null
    expect(headersGetter.keys(null)).toEqual([]);
  });

  test("returns value for existing key", () => {
    const headers = new Headers({ "x-trace": "abc123" });
    expect(headersGetter.get(headers, "x-trace")).toBe("abc123");
  });

  test("returns undefined when carrier is null", () => {
    // @ts-expect-error carrier must be Headers, but getter defends against null
    expect(headersGetter.get(null, "x-trace")).toBeUndefined();
  });

  test("returns undefined when key is null", () => {
    const headers = new Headers();
    // @ts-expect-error key must be string, but getter defends against null
    expect(headersGetter.get(headers, null)).toBeUndefined();
  });

  test("returns undefined for missing key", () => {
    const headers = new Headers();
    expect(headersGetter.get(headers, "missing")).toBeUndefined();
  });
});

describe("queryStringSetter", () => {
  test("sets param when carrier, key, and value are valid", () => {
    const carrier = { params: new URLSearchParams() };
    queryStringSetter.set(carrier, "traceparent", "abc123");
    expect(carrier.params.get("traceparent")).toBe("abc123");
  });

  test("replaces an earlier value for the same key", () => {
    const carrier = { params: new URLSearchParams() };
    queryStringSetter.set(carrier, "baggage", "tenant=a");
    queryStringSetter.set(carrier, "baggage", "tenant=b");
    expect(carrier.params.getAll("baggage")).toEqual(["tenant=b"]);
  });

  test("skips when carrier is null", () => {
    expect(() =>
      // @ts-expect-error carrier must be QueryStringCarrier, but setter defends against null
      queryStringSetter.set(null, "traceparent", "abc"),
    ).not.toThrow();
  });

  test("skips when key is undefined", () => {
    const carrier = { params: new URLSearchParams() };
    // @ts-expect-error key must be string, but setter defends against undefined
    queryStringSetter.set(carrier, undefined, "abc");
    expect(carrier.params.has("undefined")).toBe(false);
  });

  test("skips when value is undefined", () => {
    const carrier = { params: new URLSearchParams() };
    // @ts-expect-error value must be string, but setter defends against undefined
    queryStringSetter.set(carrier, "traceparent", undefined);
    expect(carrier.params.has("traceparent")).toBe(false);
  });
});
