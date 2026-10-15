// Runs inside the browser page (run.mjs serves it as-is). Mirrors ../pair.mjs and ../leak.mjs so numbers compare across runtimes.
const sides = {}

// `names` are the bundles to load ('a', 'b'); both live in one page, so their A/B rounds share one JIT, heap and event loop.
export async function load(names) {
  for (const name of names) sides[name] = await import(`/${name}.js`)
  const first = sides[names[0]]
  return {
    decode: { lists: first.decode.lists, size: first.decode.size },
    leaks: Object.entries(first.leaks).map(([label, { rounds }]) => [label, rounds]),
    scenarios: Object.keys(first.scenarios),
  }
}

async function timeIt(run, ms) {
  let count = 0
  const start = performance.now()
  let now = start
  while (now - start < ms) {
    for (let i = 0; i < 32; i += 1) await run()
    count += 32
    now = performance.now()
  }
  return ((now - start) * 1e6) / count
}

// Warm up both builds, then 12 rounds of 200 ms that alternate which build goes first. Returns ns/op per round.
export async function pair(name) {
  const a = sides.a.scenarios[name]
  const b = sides.b.scenarios[name]
  await timeIt(a, 300)
  await timeIt(b, 300)
  const as = []
  const bs = []
  for (let round = 0; round < 12; round += 1) {
    const aFirst = round % 2 === 0
    const a1 = aFirst ? await timeIt(a, 200) : 0
    const b1 = await timeIt(b, 200)
    as.push(aFirst ? a1 : await timeIt(a, 200))
    bs.push(b1)
  }
  return { as, bs }
}

// Heap sampling needs the DevTools protocol, so run.mjs drives it: start, then one run per round with a GC and a heap reading between.
let once
let longLived

export async function leakStart(side, label) {
  once = sides[side].leaks[label].once
  longLived = new AbortController()
  for (let i = 0; i < 500; i += 1) await once(longLived.signal)
}

export async function leakRun(count) {
  for (let i = 0; i < count; i += 1) await once(longLived.signal)
}

let decode

export function decodePrepare(side) {
  decode = sides[side].decode
  decode.prepare()
}

export function decodeKeep() {
  decode.keep()
}
