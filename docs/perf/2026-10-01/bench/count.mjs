// Counts platform primitives per operation (node only): promises, listeners, signals, URL/Request/Headers.
import { createHook } from "node:async_hooks";

const counts = {};
const inc = (key, by = 1) => (counts[key] = (counts[key] ?? 0) + by);
for (const name of [
  "AbortController",
  "Headers",
  "URL",
  "Request",
  "URLSearchParams",
]) {
  const Original = globalThis[name];
  const Counted = class extends Original {
    constructor(...args) {
      super(...args);
      inc(`new ${name}`);
    }
  };
  for (const key of Object.getOwnPropertyNames(Original)) {
    if (!(key in Counted)) Counted[key] = Original[key];
  }
  globalThis[name] = Counted;
}
const wrap = (owner, key, label) => {
  const original = owner[key];
  owner[key] = function (...args) {
    inc(typeof label === "function" ? label(args) : label);
    return original.apply(this, args);
  };
};
wrap(AbortSignal, "any", "AbortSignal.any");
wrap(
  EventTarget.prototype,
  "addEventListener",
  (args) => `addEventListener(${args[0]})`,
);
wrap(
  EventTarget.prototype,
  "removeEventListener",
  (args) => `removeEventListener(${args[0]})`,
);
wrap(AbortSignal.prototype, "throwIfAborted", "throwIfAborted");
wrap(Promise, "race", "Promise.race");
wrap(Object, "create", "Object.create");
wrap(Object, "defineProperty", "Object.defineProperty");
let promises = 0;
createHook({
  init: (_id, type) => type === "PROMISE" && (promises += 1),
}).enable();

const { scenarios } = await import("./scenarios.gen.bundle.mjs");
const names = process.argv.slice(2);
for (const name of names.length
  ? names
  : ["ping-no-decl", "get-small", "get-small-timeout", "post-json"]) {
  await scenarios[name]();
  for (const key of Object.keys(counts)) delete counts[key];
  promises = 0;
  const iterations = 100;
  for (let i = 0; i < iterations; i += 1) await scenarios[name]();
  const row = Object.entries(counts)
    .map(([key, value]) => `${key}=${+(value / iterations).toFixed(2)}`)
    .join("  ");
  console.log(
    `${name}\n  promises=${(promises / iterations).toFixed(1)}  ${row}`,
  );
}
