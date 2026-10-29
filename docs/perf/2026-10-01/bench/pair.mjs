// Interleaved A/B in one process: both builds warm up, then 12 rounds alternate the order.
// Reports the median B/A ratio with its interquartile range, which cancels machine drift.
import { scenarios as A } from "./a.gen.mjs";
import { scenarios as B } from "./b.gen.mjs";

const runtime = globalThis.Bun ? "bun" : "node";
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : Object.keys(A).filter(
      (name) => name !== "raw-fetch-json" && !name.startsWith("net-"),
    );

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

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const pct = (ratio) => `${((ratio - 1) * 100).toFixed(1)}%`;

for (const name of names) {
  await timeIt(A[name], 300);
  await timeIt(B[name], 300);
  const as = [];
  const bs = [];
  const ratios = [];
  for (let round = 0; round < 12; round += 1) {
    const aFirst = round % 2 === 0;
    const a1 = aFirst ? await timeIt(A[name], 200) : 0;
    const b = await timeIt(B[name], 200);
    const a = aFirst ? a1 : await timeIt(A[name], 200);
    as.push(a);
    bs.push(b);
    ratios.push(b / a);
  }
  const sorted = [...ratios].sort((x, y) => x - y);
  console.log(
    `${runtime}\t${name}\tA=${median(as).toFixed(0)}ns\tB=${median(bs).toFixed(0)}ns\tB/A=${pct(median(ratios))}\t[p25 ${pct(sorted[3])}, p75 ${pct(sorted[8])}]`,
  );
}
