export type UploadBodyKind =
  "ReadableStream" | "Blob" | "ArrayBuffer" | "FormData";
export type UploadTransport = "platform" | "custom";
export type UploadOutcome =
  "observed" | "bypassed" | "unsupported" | "unreachable";

export interface UploadCapability {
  readonly runtime: "chrome" | "firefox" | "node" | "bun";
  readonly streamBody: boolean;
  readonly streamOverHttp1: boolean;
}

export const uploadCapabilities: Readonly<
  Record<UploadCapability["runtime"], UploadCapability>
> = {
  chrome: {
    runtime: "chrome",
    streamBody: true,
    streamOverHttp1: false,
  },
  firefox: {
    runtime: "firefox",
    streamBody: false,
    streamOverHttp1: false,
  },
  node: {
    runtime: "node",
    streamBody: true,
    streamOverHttp1: true,
  },
  bun: {
    runtime: "bun",
    streamBody: true,
    streamOverHttp1: true,
  },
};

// Only the custom transport exists under this capability.
export const simulatedFirefoxStreaming: UploadCapability = {
  runtime: "firefox",
  streamBody: true,
  streamOverHttp1: false,
};

export function uploadOutcome(
  cap: UploadCapability,
  kind: UploadBodyKind,
  transport: UploadTransport,
): UploadOutcome {
  // Only a caller-supplied ReadableStream reports upload progress. Any other body is sent as built.
  if (kind !== "ReadableStream") return "bypassed";
  if (!cap.streamBody) return "unsupported";
  if (transport === "platform" && !cap.streamOverHttp1) return "unreachable";
  return "observed";
}
