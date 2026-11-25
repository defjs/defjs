import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import {
  createClient,
  defineRequest,
  outlierDetection,
  p2cBalancer,
  struct,
  withBalancer,
  withEndpoint,
  withRetry,
} from "@defjs/core";
import ky from "ky";
import { createPrng, mean, percentile, resolveSeed, roundTo } from "./stats.ts";
import type { ResilienceEntry } from "./types.ts";

const LOGICAL_CALLS = 200;
const CONCURRENCY = 8;

const ItemResponse = struct.object({
  upstream: struct.enum(["A", "B", "C"]),
  ok: struct.boolean(),
});

const getItem = defineRequest({
  method: "GET",
  path: "/item",
  output: ItemResponse,
});

function delayMs(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

interface UpstreamCluster {
  readonly urls: readonly [string, string, string];
  readonly reset: (seed: number) => void;
  readonly getCounts: () => {
    readonly A: number;
    readonly B: number;
    readonly C: number;
  };
  readonly close: () => Promise<void>;
}

async function startServer(
  handler: () => Promise<{
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: string;
  }>,
): Promise<{ readonly url: string; readonly server: Server }> {
  const server = createServer((req, res) => {
    void req;
    void handler().then((out) => {
      res.writeHead(out.status, {
        "content-type": "application/json",
        ...out.headers,
      });
      res.end(out.body);
    });
  });
  server.keepAliveTimeout = 60_000;
  await new Promise<void>((resolveReady) => {
    server.listen(0, "127.0.0.1", () => resolveReady());
  });
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind mock upstream server");
  }
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

async function createUpstreamCluster(
  initialSeed: number,
): Promise<UpstreamCluster> {
  let prngA = createPrng(initialSeed ^ 0xa1);
  let prngB = createPrng(initialSeed ^ 0xb2);
  let prngC = createPrng(initialSeed ^ 0xc3);
  let counts = { A: 0, B: 0, C: 0 };

  const nodeA = await startServer(async () => {
    counts.A += 1;
    void prngA();
    await delayMs(5);
    return { status: 200, body: '{"upstream":"A","ok":true}' };
  });

  const nodeB = await startServer(async () => {
    counts.B += 1;
    const isTail = prngB() < 0.4;
    await delayMs(isTail ? 300 : 5);
    return { status: 200, body: '{"upstream":"B","ok":true}' };
  });

  const nodeC = await startServer(async () => {
    counts.C += 1;
    const r = prngC();
    if (r < 0.4) {
      await delayMs(5);
      return { status: 503, body: '{"error":"unavailable"}' };
    }
    if (r < 0.8) {
      await delayMs(5);
      return {
        status: 429,
        headers: { "retry-after": "1" },
        body: '{"error":"rate_limited"}',
      };
    }
    await delayMs(10);
    return { status: 200, body: '{"upstream":"C","ok":true}' };
  });

  return {
    urls: [nodeA.url, nodeB.url, nodeC.url],
    reset: (seed: number) => {
      prngA = createPrng(seed ^ 0xa1);
      prngB = createPrng(seed ^ 0xb2);
      prngC = createPrng(seed ^ 0xc3);
      counts = { A: 0, B: 0, C: 0 };
    },
    getCounts: () => ({ ...counts }),
    close: async () => {
      for (const s of [nodeA.server, nodeB.server, nodeC.server]) {
        s.closeAllConnections();
        await new Promise<void>((resolveClosed) => {
          s.close(() => resolveClosed());
        });
      }
    },
  };
}

async function runResilientWorkload(
  library: string,
  cluster: UpstreamCluster,
  seed: number,
  execCall: (index: number) => Promise<boolean>,
): Promise<ResilienceEntry> {
  cluster.reset(seed);
  const latenciesMs = new Array<number>(LOGICAL_CALLS);
  let successCount = 0;
  let errorCount = 0;
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= LOGICAL_CALLS) {
        return;
      }
      const t0 = performance.now();
      const ok = await execCall(idx);
      latenciesMs[idx] = performance.now() - t0;
      if (ok) {
        successCount += 1;
      } else {
        errorCount += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const upstreamCounts = cluster.getCounts();
  const wireRequests = upstreamCounts.A + upstreamCounts.B + upstreamCounts.C;
  const sorted = [...latenciesMs].sort((a, b) => a - b);

  return {
    library,
    logicalCalls: LOGICAL_CALLS,
    wireRequests,
    successCount,
    errorCount,
    successRatePct: roundTo((successCount / LOGICAL_CALLS) * 100, 2),
    retryAmplification: roundTo(wireRequests / LOGICAL_CALLS, 2),
    p50Ms: roundTo(percentile(sorted, 0.5), 2),
    p95Ms: roundTo(percentile(sorted, 0.95), 2),
    p99Ms: roundTo(percentile(sorted, 0.99), 2),
    meanMs: roundTo(mean(latenciesMs), 2),
    upstreamCounts,
  };
}

export async function runResilienceBench(
  seed = resolveSeed(),
): Promise<ResilienceEntry[]> {
  const cluster = await createUpstreamCluster(seed);
  const [urlA, urlB, urlC] = cluster.urls;

  try {
    const defClient = createClient(
      withEndpoint(urlA, urlB, urlC),
      withBalancer(
        outlierDetection(p2cBalancer(), {
          consecutiveFailures: 2,
          minPenaltyMs: 1_500,
          maxPenaltyMs: 10_000,
          halfOpen: true,
          maxEjectionPercent: 50,
        }),
      ),
      withRetry({
        maxRetries: 2,
        delayMs: 25,
        maxDelayMs: 1_500,
      }),
    );

    const kyClient = ky.create({
      retry: {
        limit: 2,
        statusCodes: [429, 503],
        backoffLimit: 1_500,
      },
      timeout: 10_000,
    });

    const bareFetchEntry = await runResilientWorkload(
      "bare fetch (round-robin, no retry)",
      cluster,
      seed,
      async (idx) => {
        const target = cluster.urls[idx % 3] ?? urlA;
        try {
          const res = await fetch(`${target}/item`);
          await res.arrayBuffer();
          return res.ok;
        } catch {
          return false;
        }
      },
    );

    const kyEntry = await runResilientWorkload(
      "ky (round-robin, retry: 2)",
      cluster,
      seed,
      async (idx) => {
        const target = cluster.urls[idx % 3] ?? urlA;
        try {
          await kyClient.get(`${target}/item`).json();
          return true;
        } catch {
          return false;
        }
      },
    );

    const defEntry = await runResilientWorkload(
      "@defjs/core (p2c + outlierDetection + withRetry)",
      cluster,
      seed,
      async () => {
        const [err] = await getItem(defClient);
        return err === null;
      },
    );

    if (defEntry.successRatePct <= bareFetchEntry.successRatePct) {
      throw new Error(
        `Expected @defjs/core (${defEntry.successRatePct}%) to beat bare fetch (${bareFetchEntry.successRatePct}%)`,
      );
    }

    return [bareFetchEntry, kyEntry, defEntry];
  } finally {
    await cluster.close();
  }
}

if (import.meta.main) {
  const entries = await runResilienceBench();
  console.log(JSON.stringify(entries, null, 2));
}
