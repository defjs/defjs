import { yieldMacrotask } from "./macrotask";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

test("resolves while fake timers are installed", async () => {
  vi.useFakeTimers();
  const before = Date.now();
  await yieldMacrotask();
  expect(Date.now()).toBe(before);
});

test("runs after already queued microtasks and promise callbacks", async () => {
  const order: string[] = [];
  queueMicrotask(() => {
    order.push("microtask");
  });
  void Promise.resolve().then(() => {
    order.push("then");
  });
  await yieldMacrotask();
  order.push("macrotask");
  expect(order).toEqual(["microtask", "then", "macrotask"]);
});
