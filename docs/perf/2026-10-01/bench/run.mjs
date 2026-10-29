// Median ns/op per scenario (7 samples of 250 ms). With --alloc under node, also KiB allocated per op
// with young-generation GC suppressed; a "(GC!)" mark means a collection ran and the number is void.
import { scenarios } from "./scenarios.gen.mjs";

const names = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const allocMode = process.argv.includes("--alloc");
const heavy = /list|order|sse|ws|struct/;

async function timeIt(run, ms) {
  let count = 0;
  const start = performance.now();
  let now = start;
  while (now - start < ms) {
    for (let i = 0; i < 32; i += 1) await run();
    count += 32;
    now = performance.now();
  }
  return ((now - start) * 1e6) / count;
}

let gcCount = 0;
if (allocMode) {
  const { PerformanceObserver } = await import("node:perf_hooks");
  new PerformanceObserver(
    (list) => (gcCount += list.getEntries().length),
  ).observe({ entryTypes: ["gc"] });
}

for (const name of names.length
  ? names
  : Object.keys(scenarios).filter((name) => !name.startsWith("net-"))) {
  const run = scenarios[name];
  if (!run) throw new Error(`unknown scenario ${name}`);
  await timeIt(run, 300);
  const samples = [];
  for (let i = 0; i < 7; i += 1) samples.push(await timeIt(run, 250));
  samples.sort((a, b) => a - b);
  let alloc = "";
  if (allocMode) {
    globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const before = gcCount;
    const iterations = heavy.test(name) ? 40 : 1000;
    const heap = process.memoryUsage().heapUsed;
    for (let i = 0; i < iterations; i += 1) await run();
    const bytes = (process.memoryUsage().heapUsed - heap) / iterations;
    await new Promise((resolve) => setTimeout(resolve, 20));
    alloc = `\t${(bytes / 1024).toFixed(2)} KiB/op${gcCount !== before ? " (GC!)" : ""}`;
  }
  console.log(
    `${name}\t${samples[3].toFixed(0)} ns/op\t[min ${samples[0].toFixed(0)}, max ${samples[6].toFixed(0)}]${alloc}`,
  );
}
