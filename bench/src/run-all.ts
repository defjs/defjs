import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { runBundleSizeBench } from "./bundle-size.ts";
import { runHttpOverheadBench } from "./http-overhead.ts";
import { runResilienceBench } from "./resilience.ts";
import {
  formatBytes,
  formatMs,
  formatNs,
  formatOps,
  formatRatio,
  resolveSeed,
  roundTo,
} from "./stats.ts";
import { runStructBench } from "./struct.bench.ts";
import type {
  BenchmarkReport,
  EnvironmentMeta,
  HttpOverheadEntry,
  StructBenchEntry,
} from "./types.ts";

const benchRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(benchRoot, "..");

function readPackageVersion(pkgJsonPath: string): string {
  const raw = readFileSync(pkgJsonPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    return parsed.version;
  }
  return "unknown";
}

function safeExec(
  command: string,
  args: readonly string[],
  cwd: string,
): string {
  try {
    return execFileSync(command, [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function collectEnvironment(seed: number): EnvironmentMeta {
  const cpuList = cpus();
  const cpuModel = cpuList[0]?.model.trim() ?? "unknown";
  const trackedDeps = [
    "arktype",
    "axios",
    "esbuild",
    "hono",
    "ky",
    "mitata",
    "ofetch",
    "openapi-fetch",
    "@orpc/client",
    "undici",
    "valibot",
    "zod",
  ] as const;

  const versions: Record<string, string> = {
    "@defjs/core": readPackageVersion(
      join(benchRoot, "node_modules/@defjs/core/dist/package.json"),
    ),
  };
  for (const dep of trackedDeps) {
    const parts = dep.split("/");
    versions[dep] = readPackageVersion(
      join(benchRoot, "node_modules", ...parts, "package.json"),
    );
  }

  const baseGitSha = safeExec(
    "git",
    ["rev-parse", "--short", "HEAD"],
    repoRoot,
  );
  const gitDirty = safeExec("git", ["status", "--porcelain"], repoRoot);
  const gitSha =
    baseGitSha !== "unknown" && gitDirty !== "unknown" && gitDirty.length > 0
      ? `${baseGitSha}-dirty`
      : baseGitSha;

  return {
    timestamp: new Date().toISOString(),
    gitSha,
    os: `${platform()} ${release()}`,
    arch: arch(),
    cpuModel,
    cpuCores: cpuList.length,
    memoryGb: roundTo(totalmem() / 1024 ** 3, 1),
    bunVersion: Bun.version,
    nodeVersion: safeExec("node", ["-v"], repoRoot),
    seed,
    versions,
  };
}

function renderStructTable(
  scenario: string,
  entries: readonly StructBenchEntry[],
): string {
  const rows = entries.filter((entry) => entry.scenario === scenario);
  const lines = [
    `#### Scenario: \`${scenario}\``,
    "",
    "| Library | Avg | Median (p50) | p75 | p99 | Ops/sec |",
    "| :--- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      `| \`${row.library}\` | ${formatNs(row.avgNs)} | ${formatNs(row.medianNs)} | ${formatNs(row.p75Ns)} | ${formatNs(row.p99Ns)} | ${formatOps(row.opsPerSec)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderHttpTable(
  mode: "sequential" | "concurrent-16",
  title: string,
  entries: readonly HttpOverheadEntry[],
): string {
  const rows = entries.filter((entry) => entry.mode === mode);
  const lines = [
    `#### Mode: ${title}`,
    "",
    "| Client | Schema Validated | Req/sec | p50 | p95 | p99 | Total (5,000 reqs) |",
    "| :--- | :---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      `| \`${row.library}\` | ${row.schemaValidated ? "Yes (`struct`)" : "No"} | ${formatOps(row.reqPerSec)} | ${formatMs(row.p50Ms)} | ${formatMs(row.p95Ms)} | ${formatMs(row.p99Ms)} | ${formatMs(row.durationMs)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderMarkdownReport(report: BenchmarkReport): string {
  const { environment } = report;
  const scenarios = [...new Set(report.struct.map((entry) => entry.scenario))];

  const versionRows = Object.entries(environment.versions)
    .map(([name, ver]) => `| \`${name}\` | \`${ver}\` |`)
    .join("\n");

  const bundleRows = report.bundleSize
    .map(
      (entry) =>
        `| \`${entry.label}\` | ${formatBytes(entry.rawBytes)} | ${formatBytes(entry.gzipBytes)} | ${formatBytes(entry.brotliBytes)} |`,
    )
    .join("\n");

  const resilienceRows = report.resilience
    .map(
      (entry) =>
        `| \`${entry.library}\` | ${entry.successCount}/${entry.logicalCalls} (${entry.successRatePct.toFixed(1)}%) | ${entry.wireRequests} | ${formatRatio(entry.retryAmplification)} | ${formatMs(entry.p50Ms)} | ${formatMs(entry.p95Ms)} | ${formatMs(entry.p99Ms)} | A:${entry.upstreamCounts.A} / B:${entry.upstreamCounts.B} / C:${entry.upstreamCounts.C} |`,
    )
    .join("\n");

  return [
    "# Defjs Benchmark Report",
    "",
    "Generated by [`bench/src/run-all.ts`](./src/run-all.ts) from the isolated `bench/` suite against built workspace artifacts.",
    "",
    "## Reproduction",
    "",
    "```bash",
    "# From repository root",
    "bun run build",
    "cd bench && bun install --frozen-lockfile && bun run all",
    "cd .. && bun fmt bench/REPORT.md bench/README.md bench/results/latest.json",
    "```",
    "",
    `Seed used for upstream server fault/latency injection: \`SEED=${environment.seed}\` (client jitter and concurrency-8 scheduling can still cause minor variance across runs). Raw machine-readable output is saved at [\`results/latest.json\`](./results/latest.json).`,
    "",
    "## Environment & Locked Versions",
    "",
    "| Property | Value |",
    "| :--- | :--- |",
    `| Timestamp | \`${environment.timestamp}\` |`,
    `| Git SHA | \`${environment.gitSha}\` |`,
    `| OS / Arch | \`${environment.os}\` (\`${environment.arch}\`) |`,
    `| CPU | \`${environment.cpuModel}\` (${environment.cpuCores} cores) |`,
    `| Memory | ${environment.memoryGb} GB |`,
    `| Bun | \`${environment.bunVersion}\` |`,
    `| Node.js | \`${environment.nodeVersion}\` |`,
    `| PRNG Seed | \`${environment.seed}\` |`,
    "",
    "| Package | Version |",
    "| :--- | :--- |",
    versionRows,
    "",
    "## 1. `struct.parse` vs Schema Libraries (`mitata`)",
    "",
    "> Methodology: `@defjs/core` `struct` declares structural decoding and key/date transformations (`{ aliases: true }`) without a general-purpose validation/refinement DSL; Zod, Valibot, and ArkType additionally offer constraint & refinement pipelines. All 4 libraries are verified to produce deep-equal canonical outputs on valid fixtures and to reject invalid fixtures before timing.",
    "",
    ...scenarios.map((scenario) => renderStructTable(scenario, report.struct)),
    "## 2. ESM Browser Bundle Size (`esbuild` minify + tree-shake)",
    "",
    "| Target | Minified Raw | Gzip (9) | Brotli (11) |",
    "| :--- | ---: | ---: | ---: |",
    bundleRows,
    "",
    "## 3. HTTP Keep-Alive Request Overhead (Local `127.0.0.1` Hono Server)",
    "",
    "> Methodology: 500 warmup requests followed by 5,000 timed requests over HTTP keep-alive on loopback. Both `@defjs/core` entries perform full runtime schema validation (`struct`) on every response; the other clients return unvalidated JSON.",
    "",
    renderHttpTable(
      "sequential",
      "Sequential (concurrency = 1)",
      report.httpOverhead,
    ),
    renderHttpTable(
      "concurrent-16",
      "Concurrent (concurrency = 16)",
      report.httpOverhead,
    ),
    "## 4. Multi-Upstream Resilience (Deterministic Seeded Fault & Tail Latency)",
    "",
    "> Topology (`SEED=" +
      String(environment.seed) +
      "`): Upstream **A** responds in 5 ms (`200`), Upstream **B** serves 60% 5 ms / 40% 300 ms tail (`200`), and Upstream **C** returns 40% `503`, 40% `429` (`Retry-After: 1`), and 20% `200`. Each candidate issues 200 logical calls at concurrency 8 with upstream server PRNG state and counters reset identically before each run (unseeded client `Math.random()` jitter and concurrency-8 scheduling can still introduce minor variance).",
    "",
    "| Client | Success Rate | Wire Reqs | Retry Amplification | p50 | p95 | p99 | Upstream Traffic (A/B/C) |",
    "| :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
    resilienceRows,
    "",
  ].join("\n");
}

function renderBenchReadme(): string {
  return [
    "# Defjs Reproducible Benchmark Suite",
    "",
    'This directory is an isolated, non-workspace benchmark subproject (`"private": true`) with its own `bun.lock` and `tsconfig.json` so competitor dependencies (`zod`, `valibot`, `arktype`, `ky`, `ofetch`, `axios`, `openapi-fetch`, `@orpc/client`, `undici`, `mitata`, `esbuild`) never enter the published packages\' dependency graph.',
    "",
    "## Suites",
    "",
    "1. [`src/struct.bench.ts`](./src/struct.bench.ts) — `mitata` microbenchmarks comparing `@defjs/core` (`struct.parse`) against `zod`, `valibot`, and `arktype` on flat objects, 3-level nested alias + `Date` decoding, 1,000-item arrays, and fail-fast invalid inputs.",
    "2. [`src/bundle-size.ts`](./src/bundle-size.ts) — `esbuild` browser ESM tree-shaking measurements (raw minified, gzip-9, brotli-11) comparing `@defjs/core` slices against `ky`, `ofetch`, `axios`, `openapi-fetch + zod`, and `@orpc/client + zod`.",
    "3. [`src/http-overhead.ts`](./src/http-overhead.ts) — Loopback Hono HTTP keep-alive benchmark (500 warmup + 5,000 measured requests, sequential and concurrency 16) comparing `native fetch`, `@defjs/core` (Fetch & `undici.Pool` + `struct` validation), `ky`, `ofetch`, `axios`, and `openapi-fetch`.",
    "4. [`src/resilience.ts`](./src/resilience.ts) — Seeded (`SEED=20261124`) 3-upstream fault/long-tail simulation comparing bare `fetch`, `ky`, and `@defjs/core` (`p2cBalancer` + `outlierDetection({ consecutiveFailures: 2, minPenaltyMs: 1_500, maxPenaltyMs: 10_000, halfOpen: true, maxEjectionPercent: 50 })` + `withRetry({ maxRetries: 2, delayMs: 25, maxDelayMs: 1_500 })` with native `429` / `Retry-After`).",
    "",
    "## How to Run",
    "",
    "```bash",
    "# 1. Build workspace artifacts from the repository root",
    "bun run build",
    "",
    "# 2. Install exact locked benchmark dependencies and run all 4 suites",
    "cd bench",
    "bun install --frozen-lockfile",
    "bun run all",
    "",
    "# 3. Format generated report files from the repository root",
    "cd ..",
    "bun fmt bench/REPORT.md bench/README.md bench/results/latest.json",
    "```",
    "",
    "Individual suites and typecheck:",
    "",
    "```bash",
    "cd bench",
    "bun run typecheck",
    "bun run bench:struct",
    "bun run bench:bundle",
    "bun run bench:http",
    "bun run bench:resilience",
    "```",
    "",
    "Set `SEED=<integer>` (default `20261124`) to vary the deterministic upstream server fault/latency PRNG sequence in the resilience suite (unseeded client `Math.random()` jitter and concurrency-8 scheduling can still cause minor variance across runs).",
    "",
    "## Results",
    "",
    "- Narrative report & tables: [`REPORT.md`](./REPORT.md)",
    "- Machine-readable JSON: [`results/latest.json`](./results/latest.json)",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const seed = resolveSeed();
  const environment = collectEnvironment(seed);

  console.log("Running 1/4: struct.parse benchmarks (mitata)...");
  const structResults = await runStructBench();

  console.log("Running 2/4: ESM bundle size benchmarks (esbuild)...");
  const bundleResults = await runBundleSizeBench();

  console.log("Running 3/4: HTTP keep-alive overhead benchmarks (Hono)...");
  const httpResults = await runHttpOverheadBench();

  console.log("Running 4/4: Multi-upstream resilience simulation...");
  const resilienceResults = await runResilienceBench(seed);

  const report: BenchmarkReport = {
    environment,
    struct: structResults,
    bundleSize: bundleResults,
    httpOverhead: httpResults,
    resilience: resilienceResults,
  };

  mkdirSync(join(benchRoot, "results"), { recursive: true });
  writeFileSync(
    join(benchRoot, "results/latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(join(benchRoot, "REPORT.md"), renderMarkdownReport(report));
  writeFileSync(join(benchRoot, "README.md"), renderBenchReadme());

  console.log(
    "Wrote bench/results/latest.json, bench/REPORT.md, and bench/README.md",
  );
}

await main();
