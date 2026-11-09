import { expect, test } from "vitest";
import {
  simulatedFirefoxStreaming,
  uploadCapabilities,
  uploadOutcome,
  type UploadBodyKind,
  type UploadTransport,
} from "./upload-capability.ts";

const runtimes = ["chrome", "firefox", "node", "bun"] as const;
const transports = [
  "platform",
  "custom",
] as const satisfies readonly UploadTransport[];
const convertedKinds = [
  "Blob",
  "ArrayBuffer",
  "FormData",
] as const satisfies readonly UploadBodyKind[];

test("declares firefox as the only runtime without stream request bodies", () => {
  expect(
    runtimes.filter((runtime) => !uploadCapabilities[runtime].streamBody),
  ).toEqual(["firefox"]);
});

test("maps chrome ReadableStream over the platform handle to unreachable", () => {
  expect(
    uploadOutcome(uploadCapabilities.chrome, "ReadableStream", "platform"),
  ).toBe("unreachable");
  expect(
    uploadOutcome(uploadCapabilities.chrome, "ReadableStream", "custom"),
  ).toBe("observed");
});

test("maps firefox ReadableStream to unsupported on both transports", () => {
  for (const transport of transports) {
    expect(
      uploadOutcome(uploadCapabilities.firefox, "ReadableStream", transport),
    ).toBe("unsupported");
  }
});

test("maps Blob, ArrayBuffer and FormData by runtime and transport", () => {
  for (const kind of convertedKinds) {
    for (const transport of transports) {
      expect(uploadOutcome(uploadCapabilities.firefox, kind, transport)).toBe(
        "bypassed",
      );
      expect(uploadOutcome(uploadCapabilities.node, kind, transport)).toBe(
        "observed",
      );
      expect(uploadOutcome(uploadCapabilities.bun, kind, transport)).toBe(
        "observed",
      );
    }
    expect(uploadOutcome(uploadCapabilities.chrome, kind, "custom")).toBe(
      "observed",
    );
    expect(uploadOutcome(uploadCapabilities.chrome, kind, "platform")).toBe(
      "unreachable",
    );
    expect(uploadOutcome(simulatedFirefoxStreaming, kind, "custom")).toBe(
      "observed",
    );
    expect(uploadOutcome(simulatedFirefoxStreaming, kind, "platform")).toBe(
      "unreachable",
    );
  }
});

test("maps simulated firefox ReadableStream through the custom transport only", () => {
  expect(simulatedFirefoxStreaming).toEqual({
    runtime: "firefox",
    streamBody: true,
    streamOverHttp1: false,
  });
  expect(
    uploadOutcome(simulatedFirefoxStreaming, "ReadableStream", "custom"),
  ).toBe("observed");
  expect(
    uploadOutcome(simulatedFirefoxStreaming, "ReadableStream", "platform"),
  ).toBe("unreachable");
});
