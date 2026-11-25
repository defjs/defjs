# Defjs Reproducible Benchmark Suite

This directory is an isolated, non-workspace benchmark subproject (`"private": true`) with its own `bun.lock` and `tsconfig.json` so competitor dependencies (`zod`, `valibot`, `arktype`, `ky`, `ofetch`, `axios`, `openapi-fetch`, `@orpc/client`, `undici`, `mitata`, `esbuild`) never enter the published packages' dependency graph.

## Suites

1. [`src/struct.bench.ts`](./src/struct.bench.ts) — `mitata` microbenchmarks comparing `@defjs/core` (`struct.parse`) against `zod`, `valibot`, and `arktype` on flat objects, 3-level nested alias + `Date` decoding, 1,000-item arrays, and fail-fast invalid inputs.
2. [`src/bundle-size.ts`](./src/bundle-size.ts) — `esbuild` browser ESM tree-shaking measurements (raw minified, gzip-9, brotli-11) comparing `@defjs/core` slices against `ky`, `ofetch`, `axios`, `openapi-fetch + zod`, and `@orpc/client + zod`.
3. [`src/http-overhead.ts`](./src/http-overhead.ts) — Loopback Hono HTTP keep-alive benchmark (500 warmup + 5,000 measured requests, sequential and concurrency 16) comparing `native fetch`, `@defjs/core` (Fetch & `undici.Pool` + `struct` validation), `ky`, `ofetch`, `axios`, and `openapi-fetch`.
4. [`src/resilience.ts`](./src/resilience.ts) — Seeded (`SEED=20261124`) 3-upstream fault/long-tail simulation comparing bare `fetch`, `ky`, and `@defjs/core` (`p2cBalancer` + `outlierDetection({ consecutiveFailures: 2, minPenaltyMs: 1_500, maxPenaltyMs: 10_000, halfOpen: true, maxEjectionPercent: 50 })` + `withRetry({ maxRetries: 2, delayMs: 25, maxDelayMs: 1_500 })` with native `429` / `Retry-After`).

## How to Run

```bash
# 1. Build workspace artifacts from the repository root
bun run build

# 2. Install exact locked benchmark dependencies and run all 4 suites
cd bench
bun install --frozen-lockfile
bun run all

# 3. Format generated report files from the repository root
cd ..
bun fmt bench/REPORT.md bench/README.md bench/results/latest.json
```

Individual suites and typecheck:

```bash
cd bench
bun run typecheck
bun run bench:struct
bun run bench:bundle
bun run bench:http
bun run bench:resilience
```

Set `SEED=<integer>` (default `20261124`) to vary the deterministic upstream server fault/latency PRNG sequence in the resilience suite (unseeded client `Math.random()` jitter and concurrency-8 scheduling can still cause minor variance across runs).

## Results

- Narrative report & tables: [`REPORT.md`](./REPORT.md)
- Machine-readable JSON: [`results/latest.json`](./results/latest.json)
