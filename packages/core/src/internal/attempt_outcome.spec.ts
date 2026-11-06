import { expect, test } from "vitest";
import { statusOutcome } from "./attempt_outcome";

test.each([
  [199, undefined],
  [200, undefined],
  [499, undefined],
  [500, "NET_SERVER_ERROR"],
  [501, "NET_SERVER_ERROR"],
  [502, "NET_UNAVAILABLE"],
  [503, "NET_UNAVAILABLE"],
  [504, "NET_UNAVAILABLE"],
  [505, "NET_SERVER_ERROR"],
  [599, "NET_SERVER_ERROR"],
  [500.5, undefined],
  [NaN, undefined],
] as const)("statusOutcome(%s) returns %s", (status, expected) => {
  expect(statusOutcome(status)).toBe(expected);
});
