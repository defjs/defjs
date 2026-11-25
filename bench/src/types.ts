export interface EnvironmentMeta {
  readonly timestamp: string;
  readonly gitSha: string;
  readonly os: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuCores: number;
  readonly memoryGb: number;
  readonly bunVersion: string;
  readonly nodeVersion: string;
  readonly seed: number;
  readonly versions: Readonly<Record<string, string>>;
}

export interface StructBenchEntry {
  readonly scenario: string;
  readonly library: string;
  readonly avgNs: number;
  readonly medianNs: number;
  readonly p75Ns: number;
  readonly p99Ns: number;
  readonly opsPerSec: number;
}

export interface BundleSizeEntry {
  readonly label: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  readonly brotliBytes: number;
}

export interface HttpOverheadEntry {
  readonly mode: "sequential" | "concurrent-16";
  readonly library: string;
  readonly schemaValidated: boolean;
  readonly requests: number;
  readonly durationMs: number;
  readonly reqPerSec: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export interface ResilienceUpstreamCounts {
  readonly A: number;
  readonly B: number;
  readonly C: number;
}

export interface ResilienceEntry {
  readonly library: string;
  readonly logicalCalls: number;
  readonly wireRequests: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly successRatePct: number;
  readonly retryAmplification: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  readonly upstreamCounts: ResilienceUpstreamCounts;
}

export interface BenchmarkReport {
  readonly environment: EnvironmentMeta;
  readonly struct: readonly StructBenchEntry[];
  readonly bundleSize: readonly BundleSizeEntry[];
  readonly httpOverhead: readonly HttpOverheadEntry[];
  readonly resilience: readonly ResilienceEntry[];
}
