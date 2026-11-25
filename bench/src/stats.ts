export const DEFAULT_SEED = 20261124;

export function resolveSeed(rawSeed = process.env["SEED"]): number {
  if (rawSeed === undefined || rawSeed.trim() === "") {
    return DEFAULT_SEED;
  }
  const parsed = Number(rawSeed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid SEED "${rawSeed}": expected a non-negative integer`,
    );
  }
  return parsed;
}

/** Deterministic 32-bit mulberry32 PRNG returning values in `[0, 1)`. */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(1, p));
  const index = Math.min(
    sorted.length - 1,
    Math.floor((sorted.length - 1) * clamped),
  );
  return sorted[index] ?? 0;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

export function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatNs(ns: number): string {
  if (ns < 1_000) {
    return `${ns.toFixed(1)} ns`;
  }
  if (ns < 1_000_000) {
    return `${(ns / 1_000).toFixed(2)} us`;
  }
  return `${(ns / 1_000_000).toFixed(2)} ms`;
}

export function formatOps(ops: number): string {
  return Math.round(ops).toLocaleString("en-US");
}

export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} B (${(bytes / 1024).toFixed(2)} KB)`;
}

export function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}x`;
}
