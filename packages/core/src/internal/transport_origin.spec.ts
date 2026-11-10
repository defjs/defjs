import { expect, test } from "vitest";
import { ERR_ABORTED, ERR_TIMEOUT } from "../error";
import { createTransportOrigin } from "./transport_origin";

test("transport origin is isolated between execution trackers without changing causes", () => {
  const first = createTransportOrigin();
  const second = createTransportOrigin();
  for (const cause of [new Error("shared"), ERR_ABORTED, ERR_TIMEOUT]) {
    expect(first.mark(cause)).toBe(cause);
    expect(first.has(cause)).toBe(true);
    expect(second.has(cause)).toBe(false);
  }
  expect(first.has(new Error("unmarked"))).toBe(false);
});

test("causes a WeakSet cannot hold are recorded by value", () => {
  const other = createTransportOrigin();
  const registered = Symbol.for("registered");
  const causes = [
    [null, undefined],
    [undefined, null],
    ["failure", "other"],
    [42, 43],
    [0n, 1n],
    [true, false],
    [Symbol("s"), Symbol("s")],
    [registered, Symbol.for("unmarked")],
  ] as const;
  for (const [cause, unmarked] of causes) {
    const origin = createTransportOrigin();
    expect(origin.has(cause)).toBe(false);
    expect(origin.mark(cause)).toBe(cause);
    expect(origin.has(cause)).toBe(true);
    expect(origin.has(unmarked)).toBe(false);
    expect(other.has(cause)).toBe(false);
  }
});

test("functions are tracked by identity", () => {
  const origin = createTransportOrigin();
  const cause = () => 1;
  expect(origin.mark(cause)).toBe(cause);
  expect(origin.has(cause)).toBe(true);
  expect(origin.has(() => 1)).toBe(false);
});
