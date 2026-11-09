import { expect, test } from "vitest";
import { readRound13Settings } from "./round13-settings";

test("uses the documented defaults for an empty environment", () => {
  expect(readRound13Settings({})).toEqual({
    seed: 0x13c0ffee,
    attempts: 1000,
    depth: 4,
    exotic: false,
  });
});

test("treats empty strings as unset", () => {
  expect(readRound13Settings({ ROUND13_ATTEMPTS: "" }).attempts).toBe(1000);
});

test("reads overrides", () => {
  expect(
    readRound13Settings({
      ROUND13_SEED: "7",
      ROUND13_ATTEMPTS: "50",
      ROUND13_DEPTH: "2",
      ROUND13_EXOTIC: "1",
    }),
  ).toEqual({ seed: 7, attempts: 50, depth: 2, exotic: true });
});

test("enables exotic only for 1", () => {
  expect(readRound13Settings({ ROUND13_EXOTIC: "true" }).exotic).toBe(false);
  expect(readRound13Settings({ ROUND13_EXOTIC: "0" }).exotic).toBe(false);
});

test.each(["0", "-1", "1.5", "abc"])("rejects ROUND13_ATTEMPTS %s", (value) => {
  expect(() => readRound13Settings({ ROUND13_ATTEMPTS: value })).toThrow(
    "ROUND13_ATTEMPTS must be a positive integer",
  );
});
