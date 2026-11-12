import { describe, expect, test } from "vitest";
import { carrierSetter, headersGetter } from "./carrier";

describe("carrierSetter", () => {
  test("sets a header", () => {
    const headers = new Headers();
    carrierSetter.set(headers, "x-trace", "abc123");
    expect(headers.get("x-trace")).toBe("abc123");
  });

  test("sets a query parameter", () => {
    const params = new URLSearchParams();
    carrierSetter.set(params, "traceparent", "abc123");
    expect(params.get("traceparent")).toBe("abc123");
  });

  test("replaces an earlier value for the same key", () => {
    const params = new URLSearchParams();
    carrierSetter.set(params, "baggage", "tenant=a");
    carrierSetter.set(params, "baggage", "tenant=b");
    expect(params.getAll("baggage")).toEqual(["tenant=b"]);
  });
});

describe("headersGetter", () => {
  test("returns keys from Headers", () => {
    const headers = new Headers({ "x-trace": "abc", "content-type": "json" });
    const keys = headersGetter.keys(headers);
    expect(keys).toContain("x-trace");
    expect(keys).toContain("content-type");
  });

  test("returns value for existing key", () => {
    const headers = new Headers({ "x-trace": "abc123" });
    expect(headersGetter.get(headers, "x-trace")).toBe("abc123");
  });

  test("returns undefined for missing key", () => {
    const headers = new Headers();
    expect(headersGetter.get(headers, "missing")).toBeUndefined();
  });
});
