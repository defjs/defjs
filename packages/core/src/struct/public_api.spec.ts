import { expect, test } from "vitest";

const core = await import("../index");

test("STRUCT is not a public runtime value", () => {
  expect(Object.hasOwn(core, "STRUCT")).toBe(false);
});
