import { expect, test } from "vitest";
import { withXSRF } from "../packages/core/src/xsrf/index.ts";

const locationMessage =
  "withXSRF requires a browser runtime: globalThis.location is missing";

test("withXSRF rejects Bun because location is missing", () => {
  let caught: unknown;
  try {
    withXSRF();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  if (!(caught instanceof Error)) {
    throw new Error("expected withXSRF to throw");
  }
  expect(caught.message).toBe(locationMessage);
});
