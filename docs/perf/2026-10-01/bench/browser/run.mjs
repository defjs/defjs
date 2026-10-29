// Runs the ../scenarios.mjs measurements, plus two real-network ones, inside real browsers driven by Playwright.
//   node run.mjs pair   <core-src-A> <core-src-B> [--browsers chromium,firefox,webkit] [scenario...]
//   node run.mjs memory <core-src-A> <core-src-B>
// `pair` prints the median B/A per browser and scenario, in the format of ../pair.mjs with the browser in place of the runtime.
// `memory` (Chromium only) prints the heap retained by ../leak.mjs's workloads, in the format of ../leak.mjs, and the heap per decoded object.
// <core-src> is a directory holding the core `index.ts`, as for bench.sh. Needs node >= 26, bun >= 1.4 (bun build) and Playwright's browsers.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, firefox, webkit } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const engines = { chromium, firefox, webkit };
const usage = `usage: node run.mjs pair <core-src-A> <core-src-B> [--browsers ${Object.keys(engines).join(",")}] [scenario...]
       node run.mjs memory <core-src-A> <core-src-B>`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: { browsers: { type: "string" } },
  });
} catch (error) {
  fail(`${error.message}\n${usage}`);
}
const [command, srcA, srcB, ...names] = args.positionals;
const browsers = (args.values.browsers ?? Object.keys(engines).join(",")).split(
  ",",
);
if (
  !["pair", "memory"].includes(command) ||
  !srcB ||
  browsers.some((name) => !engines[name])
)
  fail(usage);
if (command === "memory" && (names.length || args.values.browsers)) fail(usage);

const out = mkdtempSync(join(tmpdir(), "defjs-browser-bench-"));
process.on("exit", () => rmSync(out, { recursive: true, force: true }));

// ---- bundles and server ------------------------------------------------------------------------
// Same as bench.sh: copy the templates with `__CORE__` replaced by <core-src>/index.ts, then bundle them.
function bundle(side, src) {
  const index = join(resolve(src), "index.ts");
  if (!existsSync(index))
    fail(
      `${index} does not exist: <core-src> is the directory holding the core index.ts`,
    );
  const dir = join(out, side);
  mkdirSync(dir);
  writeFileSync(
    join(dir, "scenarios.gen.mjs"),
    readFileSync(join(here, "..", "scenarios.mjs"), "utf8").replaceAll(
      "__CORE__",
      index,
    ),
  );
  writeFileSync(
    join(dir, "workloads.gen.mjs"),
    readFileSync(join(here, "workloads.mjs"), "utf8").replaceAll(
      "__CORE__",
      index,
    ),
  );
  const file = join(out, `${side}.js`);
  const built = spawnSync(
    "bun",
    [
      "build",
      join(dir, "workloads.gen.mjs"),
      "--target=browser",
      `--outfile=${file}`,
    ],
    { encoding: "utf8" },
  );
  if (built.status !== 0)
    fail(
      `bun build failed for ${src}:\n${built.error ?? ""}${built.stdout ?? ""}${built.stderr ?? ""}`,
    );
  return readFileSync(file);
}

// The payloads of get-small and get-list-1000 in ../scenarios.mjs, served to the net-* scenarios in workloads.mjs.
const userJson = JSON.stringify({
  id: 1,
  name: "Ada",
  email: "ada@example.com",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
});
const listJson = JSON.stringify(
  Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `n${i}`,
    email: `u${i}@x.io`,
    active: i % 2 === 0,
    created_at: "2026-01-01",
  })),
);
const files = new Map([
  [
    "/",
    [
      "text/html",
      Buffer.from(
        '<!doctype html><meta charset="utf-8"><title>defjs bench</title>',
      ),
    ],
  ],
  ["/page.mjs", ["text/javascript", readFileSync(join(here, "page.mjs"))]],
  ["/users/1", ["application/json", Buffer.from(userJson)]],
  ["/users", ["application/json", Buffer.from(listJson)]],
  ["/a.js", ["text/javascript", bundle("a", srcA)]],
  ["/b.js", ["text/javascript", bundle("b", srcB)]],
]);

function serve() {
  const server = createServer((request, response) => {
    const [type, body] = files.get(request.url) ?? [];
    if (!body) return void response.writeHead(404).end();
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": body.length,
      "content-type": type,
    });
    response.end(body);
  });
  // An idle socket that the server closes mid-run would make the next fetch race the close.
  server.keepAliveTimeout = 0;
  return new Promise((ready) =>
    server.listen(0, "127.0.0.1", () => ready(server)),
  );
}

// ---- browsers ----------------------------------------------------------------------------------
// Playwright 1.63 expects webkit-2359; a machine that only has an older WebKit build can still run it, so take the newest installed revision.
function installedWebkit() {
  const wanted = webkit.executablePath();
  const [, root, rest] = /^(.*[/\\])webkit-\d+([/\\].*)$/.exec(wanted) ?? [];
  if (!root || existsSync(wanted)) return undefined;
  const newest = readdirSync(root)
    .filter(
      (dir) => /^webkit-\d+$/.test(dir) && existsSync(join(root, dir) + rest),
    )
    .sort((x, y) => y.slice(7) - x.slice(7))[0];
  if (newest)
    console.error(`webkit: ${wanted} is not installed, using ${newest}`);
  return newest && join(root, newest) + rest;
}

function launch(name) {
  const options = {
    executablePath: name === "webkit" ? installedWebkit() : undefined,
  };
  if (name === "firefox" && process.platform === "darwin") {
    // macOS 27 denies Firefox 155 the real ~/Library/Application Support/Firefox ("Could not find profile folder."), as in test/firefox-app-data.ts.
    const data = join(out, "firefox-app-data");
    mkdirSync(join(data, "roaming"), { recursive: true });
    mkdirSync(join(data, "local"));
    options.env = {
      ...process.env,
      MOZ_APP_DATA: join(data, "roaming"),
      MOZ_LOCAL_APP_DATA: join(data, "local"),
    };
  }
  return engines[name].launch(options);
}

// A fresh context is a fresh renderer, so nothing carries over between pages.
async function open(browser, sides) {
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (error) =>
    console.error(`page error: ${error.message}`),
  );
  await page.goto(origin);
  return { page, info: await call(page, "load", sides) };
}

const call = (page, fn, ...args) =>
  page.evaluate(
    async ([fn, args]) => (await import("/page.mjs"))[fn](...args),
    [fn, args],
  );

// ---- pair --------------------------------------------------------------------------------------
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const pct = (ratio) => `${((ratio - 1) * 100).toFixed(1)}%`;

function report(browser, name, as, bs) {
  const ratios = bs.map((b, round) => b / as[round]);
  const sorted = [...ratios].sort((x, y) => x - y);
  console.log(
    `${browser}\t${name}\tA=${median(as).toFixed(0)}ns\tB=${median(bs).toFixed(0)}ns\tB/A=${pct(median(ratios))}\t[p25 ${pct(sorted[3])}, p75 ${pct(sorted[8])}]`,
  );
}

async function pairIn(name) {
  const browser = await launch(name);
  try {
    console.error(`== ${name} ${browser.version()}`);
    const { page, info } = await open(browser, ["a", "b"]);
    const selected = names.length
      ? names
      : info.scenarios.filter((scenario) => scenario !== "raw-fetch-json");
    const unknown = selected.filter(
      (scenario) => !info.scenarios.includes(scenario),
    );
    if (unknown.length)
      throw new Error(
        `unknown scenario ${unknown.join(", ")}; known: ${info.scenarios.join(", ")}`,
      );
    for (const scenario of selected) {
      const { as, bs } = await call(page, "pair", scenario);
      report(name, scenario, as, bs);
    }
  } finally {
    await browser.close();
  }
}

// ---- memory ------------------------------------------------------------------------------------
// Six full GCs with pauses, so finalizers and weak references get their turn, as in ../leak.mjs.
async function settle(cdp) {
  for (let i = 0; i < 6; i += 1) {
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(100);
  }
}

// Blink's own objects (AbortSignal and its listeners) live in the embedder heap, not in V8's, so a leak of them only shows in the sum.
async function heapUsed(cdp) {
  const { usedSize, embedderHeapUsedSize } = await cdp.send(
    "Runtime.getHeapUsage",
  );
  return usedSize + embedderHeapUsedSize;
}

async function inFreshPage(browser, side, run) {
  const { page } = await open(browser, [side]);
  try {
    await run(page, await page.context().newCDPSession(page));
  } finally {
    await page.context().close();
  }
}

async function memory() {
  const browser = await launch("chromium");
  try {
    console.error(`== chromium ${browser.version()}`);
    const probe = await open(browser, ["a"]);
    await probe.page.context().close();
    const { leaks, decode } = probe.info;
    for (const side of ["a", "b"]) {
      console.log(`== chromium ${side.toUpperCase()}`);
      for (const [label, rounds] of leaks) {
        await inFreshPage(browser, side, async (page, cdp) => {
          await call(page, "leakStart", side, label);
          await settle(cdp);
          const start = await heapUsed(cdp);
          let total = 0;
          const growth = [];
          for (const count of rounds) {
            await call(page, "leakRun", count);
            total += count;
            await settle(cdp);
            growth.push(
              `${total}: +${(((await heapUsed(cdp)) - start) / 1024).toFixed(0)} KiB`,
            );
          }
          console.log(`${label}\t${growth.join("\t")}`);
        });
      }
      await inFreshPage(browser, side, async (page, cdp) => {
        await call(page, "decodePrepare", side);
        await settle(cdp);
        const before = await heapUsed(cdp);
        await call(page, "decodeKeep");
        await settle(cdp);
        const bytes =
          ((await heapUsed(cdp)) - before) / (decode.lists * decode.size);
        console.log(
          `retained per decoded object: ${bytes.toFixed(0)} bytes (${decode.lists} x ${decode.size / 1000}k-item lists kept alive)`,
        );
      });
    }
  } finally {
    await browser.close();
  }
}

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  if (command === "pair") for (const name of browsers) await pairIn(name);
  else await memory();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
