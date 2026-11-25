import { createRequire } from "node:module";
import { type AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import axios from "axios";
import { Hono } from "hono";
import ky from "ky";
import { ofetch } from "ofetch";
import createOpenApiClient from "openapi-fetch";
import type { Pool as UndiciPool } from "undici";
import { percentile, roundTo } from "./stats.ts";
import type { HttpOverheadEntry } from "./types.ts";

// Bun's built-in "undici" shim shadows bare "undici" with an empty Pool stub,
// so load the locked npm undici entry directly for genuine Pool benchmarks.
const requireFromHere = createRequire(import.meta.url);
const undiciMod: { readonly Pool: typeof UndiciPool } = requireFromHere(
  "../node_modules/undici/index.js",
);
const Pool = undiciMod.Pool;

const WARMUP_REQUESTS = 500;
const MEASURE_REQUESTS = 5_000;

const OrderSchema = struct.object({
  id: struct.string(),
  status: struct.string(),
  total: struct.number(),
  currency: struct.string(),
});

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.string() }),
  builder: (input) => ({ path: input }),
  output: OrderSchema,
});

function createUndiciPoolHandle(
  baseUrl: string,
  connections: number,
): {
  readonly handle: FetchHandle;
  readonly close: () => Promise<void>;
} {
  const pool = new Pool(baseUrl, { connections, pipelining: 1 });
  const handle: FetchHandle = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const target = new URL(request.url);
    const reqHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      reqHeaders[key] = value;
    });
    const res = await pool.request({
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers: reqHeaders,
      signal: request.signal,
    });
    const headerEntries: [string, string][] = [];
    for (const [key, val] of Object.entries(res.headers)) {
      if (typeof val === "string") {
        headerEntries.push([key, val]);
      } else if (Array.isArray(val)) {
        headerEntries.push([key, val.join(", ")]);
      }
    }
    const bodyBuffer = await res.body.arrayBuffer();
    return new Response(bodyBuffer, {
      status: res.statusCode,
      headers: headerEntries,
    });
  };
  return {
    handle,
    close: async () => {
      await pool.close();
    },
  };
}

async function runPoolWorkload(
  totalRequests: number,
  concurrency: number,
  fn: () => Promise<unknown>,
): Promise<{ readonly durationMs: number; readonly latenciesMs: number[] }> {
  const latenciesMs = new Array<number>(totalRequests);
  let cursor = 0;

  const startWall = performance.now();
  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= totalRequests) {
        return;
      }
      const t0 = performance.now();
      await fn();
      latenciesMs[idx] = performance.now() - t0;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const durationMs = performance.now() - startWall;
  return { durationMs, latenciesMs };
}

interface HttpCandidate {
  readonly library: string;
  readonly schemaValidated: boolean;
  readonly call: () => Promise<unknown>;
}

interface OrderPaths {
  "/orders/{id}": {
    get: {
      parameters: { path: { id: string } };
      responses: {
        200: {
          content: {
            "application/json": {
              id: string;
              status: string;
              total: number;
              currency: string;
            };
          };
        };
      };
    };
  };
}

export async function runHttpOverheadBench(): Promise<HttpOverheadEntry[]> {
  const app = new Hono();
  app.get("/orders/:id", (c) =>
    c.json({
      id: c.req.param("id"),
      status: "paid",
      total: 199.5,
      currency: "USD",
    }),
  );

  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolveReady) => {
    if (server.listening) {
      resolveReady();
      return;
    }
    server.once("listening", () => resolveReady());
  });

  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to resolve Hono local server port");
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const poolBridge = createUndiciPoolHandle(baseUrl, 32);

  try {
    const defFetchClient = createClient(withEndpoint(baseUrl));
    const defPoolClient = createClient(
      withEndpoint(baseUrl),
      withHTTPHandle(poolBridge.handle),
    );
    const kyClient = ky.create({ prefix: baseUrl });
    const ofetchClient = ofetch.create({ baseURL: baseUrl });
    const axiosClient = axios.create({ baseURL: baseUrl });
    const openapiClient = createOpenApiClient<OrderPaths>({ baseUrl });

    const candidates: readonly HttpCandidate[] = [
      {
        library: "native fetch",
        schemaValidated: false,
        call: async () => {
          const res = await fetch(`${baseUrl}/orders/ord-1`);
          return await res.json();
        },
      },
      {
        library: "@defjs/core (fetch + struct)",
        schemaValidated: true,
        call: async () => {
          const [err, order] = await getOrder(defFetchClient, { id: "ord-1" });
          if (err) throw err;
          return order;
        },
      },
      {
        library: "@defjs/core (undici.Pool + struct)",
        schemaValidated: true,
        call: async () => {
          const [err, order] = await getOrder(defPoolClient, { id: "ord-1" });
          if (err) throw err;
          return order;
        },
      },
      {
        library: "ky",
        schemaValidated: false,
        call: async () => await kyClient.get("orders/ord-1").json(),
      },
      {
        library: "ofetch",
        schemaValidated: false,
        call: async () => await ofetchClient("/orders/ord-1"),
      },
      {
        library: "axios",
        schemaValidated: false,
        call: async () => (await axiosClient.get("/orders/ord-1")).data,
      },
      {
        library: "openapi-fetch",
        schemaValidated: false,
        call: async () => {
          const res = await openapiClient.GET("/orders/{id}", {
            params: { path: { id: "ord-1" } },
          });
          if (res.error !== undefined) {
            throw new Error("openapi-fetch request failed");
          }
          return res.data;
        },
      },
    ];

    // Pre-flight check that every candidate decodes the expected payload
    const expected = {
      id: "ord-1",
      status: "paid",
      total: 199.5,
      currency: "USD",
    };
    for (const candidate of candidates) {
      const sample = await candidate.call();
      if (!Bun.deepEquals(sample, expected)) {
        throw new Error(
          `Unexpected HTTP payload for ${candidate.library}: ${JSON.stringify(sample)}`,
        );
      }
    }

    const results: HttpOverheadEntry[] = [];
    for (const [mode, concurrency] of [
      ["sequential", 1],
      ["concurrent-16", 16],
    ] as const) {
      for (const candidate of candidates) {
        await runPoolWorkload(WARMUP_REQUESTS, concurrency, candidate.call);
        const { durationMs, latenciesMs } = await runPoolWorkload(
          MEASURE_REQUESTS,
          concurrency,
          candidate.call,
        );
        const sorted = [...latenciesMs].sort((a, b) => a - b);
        results.push({
          mode,
          library: candidate.library,
          schemaValidated: candidate.schemaValidated,
          requests: MEASURE_REQUESTS,
          durationMs: roundTo(durationMs, 2),
          reqPerSec: roundTo((MEASURE_REQUESTS / durationMs) * 1_000, 1),
          p50Ms: roundTo(percentile(sorted, 0.5), 3),
          p95Ms: roundTo(percentile(sorted, 0.95), 3),
          p99Ms: roundTo(percentile(sorted, 0.99), 3),
        });
      }
    }

    return results;
  } finally {
    await poolBridge.close();
    if (
      "closeAllConnections" in server &&
      typeof server.closeAllConnections === "function"
    ) {
      server.closeAllConnections();
    }
    await new Promise<void>((resolveClosed) => {
      server.close(() => resolveClosed());
    });
  }
}

if (import.meta.main) {
  const entries = await runHttpOverheadBench();
  console.log(JSON.stringify(entries, null, 2));
}
