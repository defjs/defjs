import { resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { build } from "esbuild";
import type { BundleSizeEntry } from "./types.ts";

const benchRoot = resolve(import.meta.dirname, "..");

interface BundleTarget {
  readonly label: string;
  readonly code: string;
}

const TARGETS: readonly BundleTarget[] = [
  {
    label: "@defjs/core (minimal: defineRequest + struct)",
    code: `
      import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";
      export const Order = struct.object({ id: struct.string(), total: struct.number() });
      export const getOrder = defineRequest({
        method: "GET",
        path: "/orders/:id",
        input: struct.object({ id: struct.string() }),
        builder: (input) => ({ path: input }),
        output: Order,
      });
      export function createApi(baseUrl: string) {
        return createClient(withEndpoint(baseUrl));
      }
    `,
  },
  {
    label:
      "@defjs/core (resilient: p2c + outlierDetection + retry + middleware)",
    code: `
      import {
        concurrencyLimitHttpInterceptor,
        createClient,
        defineRequest,
        idempotencyKeyHttpInterceptor,
        outlierDetection,
        p2cBalancer,
        struct,
        withBalancer,
        withEndpoint,
        withInterceptors,
        withRetry,
      } from "@defjs/core";
      export const Order = struct.object({ id: struct.string(), total: struct.number() });
      export const getOrder = defineRequest({
        method: "GET",
        path: "/orders/:id",
        input: struct.object({ id: struct.string() }),
        builder: (input) => ({ path: input }),
        output: Order,
      });
      export function createResilientApi(endpoints: readonly string[]) {
        return createClient(
          withEndpoint(...endpoints),
          withBalancer(outlierDetection(p2cBalancer(), { halfOpen: true, maxEjectionPercent: 50 })),
          withRetry({ maxRetries: 2 }),
          withInterceptors(
            concurrencyLimitHttpInterceptor({ maxConcurrency: 8 }),
            idempotencyKeyHttpInterceptor(),
          ),
        );
      }
    `,
  },
  {
    label: "@defjs/core (full root entry)",
    code: `
      import * as core from "@defjs/core";
      export { core };
    `,
  },
  {
    label: "ky (minimal)",
    code: `
      import ky from "ky";
      export function createKyClient(prefix: string) {
        return ky.create({ prefix });
      }
    `,
  },
  {
    label: "ofetch (minimal)",
    code: `
      import { ofetch } from "ofetch";
      export function createOfetchClient(baseURL: string) {
        return ofetch.create({ baseURL });
      }
    `,
  },
  {
    label: "axios (minimal)",
    code: `
      import axios from "axios";
      export function createAxiosClient(baseURL: string) {
        return axios.create({ baseURL });
      }
    `,
  },
  {
    label: "openapi-fetch + zod",
    code: `
      import createClient from "openapi-fetch";
      import { z } from "zod";
      export const Order = z.object({ id: z.string(), total: z.number() });
      export function createOpenApiFetch(baseUrl: string) {
        return createClient({ baseUrl });
      }
    `,
  },
  {
    label: "@orpc/client + zod",
    code: `
      import { createORPCClient } from "@orpc/client";
      import { RPCLink } from "@orpc/client/fetch";
      import { z } from "zod";
      export const Order = z.object({ id: z.string(), total: z.number() });
      export function createOrpc(url: string) {
        const link = new RPCLink({ url });
        return createORPCClient(link);
      }
    `,
  },
];

export async function runBundleSizeBench(): Promise<BundleSizeEntry[]> {
  const results: BundleSizeEntry[] = [];

  for (const target of TARGETS) {
    const out = await build({
      stdin: {
        contents: target.code,
        resolveDir: benchRoot,
        sourcefile: "entry.ts",
        loader: "ts",
      },
      bundle: true,
      format: "esm",
      treeShaking: true,
      minify: true,
      platform: "browser",
      mainFields: ["browser", "module", "main"],
      conditions: ["browser", "import", "default"],
      target: "es2022",
      write: false,
      logLevel: "silent",
    });

    const first = out.outputFiles[0];
    if (!first) {
      throw new Error(`No bundle output produced for ${target.label}`);
    }
    const raw = Buffer.from(first.contents);
    const gzip = gzipSync(raw, { level: 9 });
    const brotli = brotliCompressSync(raw, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    });

    results.push({
      label: target.label,
      rawBytes: raw.byteLength,
      gzipBytes: gzip.byteLength,
      brotliBytes: brotli.byteLength,
    });
  }

  return results;
}

if (import.meta.main) {
  const entries = await runBundleSizeBench();
  console.log(JSON.stringify(entries, null, 2));
}
