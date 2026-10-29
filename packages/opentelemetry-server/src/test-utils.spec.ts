import { describe, expect, test } from "vitest";
import { makeHttpResponse } from "./test-utils";

describe("makeHttpResponse", () => {
  test("defaults to an absent body and keeps an explicit JSON null", () => {
    expect(makeHttpResponse().body).toBeUndefined();
    expect(makeHttpResponse(null).body).toBeNull();
  });
});
