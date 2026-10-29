import { expect, test } from "vitest";
import catalog from "../app/data/api-entries.json";
import { apiOrder, compareApiIdentity } from "./api-order";

test("historical order matches the committed catalog and sorts unknowns last", () => {
  expect([...apiOrder]).toEqual(
    catalog.map((entry) => `${entry.package}:${entry.name}`),
  );
  expect(
    compareApiIdentity("@defjs/core:createClient", "@defjs/core:withEndpoint"),
  ).toBeLessThan(0);
  expect(
    compareApiIdentity("@defjs/core:later", "@defjs/core:alpha"),
  ).toBeGreaterThan(0);
  expect(
    compareApiIdentity("@defjs/core:alpha", "@defjs/core:later"),
  ).toBeLessThan(0);
  expect(compareApiIdentity("@defjs/core:same", "@defjs/core:same")).toBe(0);
  expect(
    compareApiIdentity("@defjs/core:createClient", "@defjs/core:createClient"),
  ).toBe(0);
});
