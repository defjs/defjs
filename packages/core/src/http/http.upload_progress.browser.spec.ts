import { beforeEach, describe, expect, inject, test, vi } from "vitest";
import { server } from "vitest/browser";

import { createClient, withEndpoint } from "../client";
import type { Client } from "../client";
import { struct } from "../struct";
import { defineRequest } from "./index";
import type { HttpProgressFn } from "./index";
import { missHits } from "../../test/miss-log";
import {
  createNotesForm,
  decodeBase64,
  notesFormBody,
} from "../../test/multipart-fixture";
import {
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  supportsStreamingRequestBody,
} from "./transport/fetch";

const uploadBytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x41]);

const EchoField = struct.object({
  filename: struct.string().optional(),
  name: struct.string(),
  text: struct.string(),
  type: struct.string().optional(),
});

const EchoReport = struct.object({
  bodyBase64: struct.string(),
  bodyText: struct.string(),
  fields: struct.array(EchoField),
  headers: struct.record(struct.string()),
  method: struct.string(),
  path: struct.string(),
  rawQuery: struct.string(),
});

const RawEcho = struct.object({
  bodyBase64: struct.string(),
  contentType: struct.string(),
});

const binaryUploads = [
  {
    contentType: "application/x-defjs-upload",
    createBody: () =>
      new Blob([uploadBytes], { type: "application/x-defjs-upload" }),
    kind: "Blob",
  },
  {
    contentType: "application/octet-stream",
    createBody: () => uploadBytes.slice().buffer,
    kind: "ArrayBuffer",
  },
] as const;

describe("browser upload progress", () => {
  let baseClient: Client;

  beforeEach(() => {
    baseClient = createClient(withEndpoint(inject("testServerHost")));
  });

  async function echoUpload(
    body: ArrayBuffer | Blob | FormData | ReadableStream<Uint8Array>,
    onUploadProgress: HttpProgressFn,
  ) {
    const endpoint = defineRequest({
      builder: () => ({ body }),
      method: "POST",
      output: EchoReport,
      path: "/e2e/echo",
    });
    return baseClient.execute(endpoint(), { onUploadProgress });
  }

  test.each(binaryUploads)(
    "should send the $kind body unchanged and not call onUploadProgress",
    async ({ contentType, createBody }) => {
      const onUploadProgress = vi.fn();
      const [error, result] = await echoUpload(createBody(), onUploadProgress);

      expect(error?.code ?? null).toBeNull();
      expect(result?.bodyBase64).toBe(bytesToBase64(uploadBytes));
      expect(result?.headers["content-type"]).toBe(contentType);
      expect(onUploadProgress).toHaveBeenCalledTimes(0);
    },
  );

  async function echoRaw(body: FormData, onUploadProgress: HttpProgressFn) {
    const endpoint = defineRequest({
      builder: () => ({ body }),
      method: "POST",
      output: RawEcho,
      path: "/e2e/echo-raw",
    });
    return baseClient.execute(endpoint(), { onUploadProgress });
  }

  test("should send FormData unchanged and not call onUploadProgress", async () => {
    const onUploadProgress = vi.fn();
    const [error, result] = await echoRaw(createNotesForm(), onUploadProgress);

    expect(error?.code ?? null).toBeNull();
    expect(decodeBase64(result?.bodyBase64 ?? "")).toBe(
      notesFormBody(result?.contentType ?? ""),
    );
    expect(onUploadProgress).toHaveBeenCalledTimes(0);
  });

  test("should succeed with the original Blob when onUploadProgress throws", async () => {
    const onUploadProgress = vi.fn(() => {
      throw new Error("upload observer failed");
    });
    const [error, result] = await echoUpload(
      new Blob([uploadBytes], { type: "application/x-defjs-upload" }),
      onUploadProgress,
    );

    expect(error?.code ?? null).toBeNull();
    expect(result?.bodyBase64).toBe(bytesToBase64(uploadBytes));
    expect(result?.headers["content-type"]).toBe("application/x-defjs-upload");
    expect(onUploadProgress).toHaveBeenCalledTimes(0);
  });

  test("should report streaming request bodies as supported in Chromium and unsupported in Firefox", () => {
    expect(supportsStreamingRequestBody(), `browser=${server.browser}`).toBe(
      server.browser === "chromium",
    );
  });

  test("should refuse or fail a caller-supplied ReadableStream without posting it", async () => {
    if (server.browser !== "chromium" && server.browser !== "firefox") {
      throw new Error(`unexpected browser ${server.browser}`);
    }

    // Chromium can stream request bodies, so Defjs hands the stream to fetch with `duplex: 'half'`.
    // Chromium streams request bodies only over HTTP/2 or later. This server is HTTP/1.1, so fetch
    // rejects after the CORS preflight and before the POST is sent.
    const path = `/e2e/miss/stream-body-${server.browser}-${Date.now()}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(uploadBytes);
        controller.close();
      },
    });
    const endpoint = defineRequest({
      builder: () => ({ body: stream }),
      method: "POST",
      output: EchoReport,
      path,
    });
    const [error, result] = await baseClient.execute(endpoint());
    const hits = await missHits(baseClient, path);

    expect(result).toBeUndefined();
    if (server.browser === "firefox") {
      expect(error?.code, `bodyText=${String(result?.bodyText)}`).toBe(
        "ENV_UNSUPPORTED",
      );
      expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
      expect(hits).toEqual([]);
      expect(stream.locked).toBe(false);
      return;
    }
    expect(error?.code, `bodyText=${String(result?.bodyText)}`).toBe(
      "NET_UNREACHABLE",
    );
    expect(error?.cause).toBeInstanceOf(TypeError);
    expect(error?.cause instanceof Error ? error.cause.message : "").toBe(
      "Failed to fetch",
    );
    expect(hits).toEqual([`OPTIONS ${path}`]);
    expect(stream.locked).toBe(true);
  });
});

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
