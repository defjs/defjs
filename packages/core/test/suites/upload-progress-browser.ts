import { beforeEach, describe, expect, inject, test, vi } from "vitest";
import {
  createClient,
  type DerivableClient,
  withEndpoint,
} from "../../src/client/index.ts";
import { defineRequest, type HttpProgressFn } from "../../src/http/index.ts";
import { struct } from "../../src/struct/index.ts";
import {
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  supportsStreamingRequestBody,
} from "../../src/http/transport/fetch.ts";
import { missHits } from "../miss-log.ts";
import {
  createNotesForm,
  decodeBase64,
  notesFormBody,
} from "../multipart-fixture.ts";
import { uploadOutcome, type UploadCapability } from "../upload-capability.ts";

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

export function registerUploadProgressBrowserSuite(
  cap: UploadCapability,
  browser: "chromium" | "firefox",
): void {
  describe("browser upload progress", () => {
    let baseClient: DerivableClient;

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
      return endpoint(baseClient({ onUploadProgress }));
    }

    test.each(binaryUploads)(
      "should send a $kind upload as built and not call onUploadProgress",
      async ({ contentType, createBody }) => {
        const onUploadProgress = vi.fn();
        const [error, result] = await echoUpload(
          createBody(),
          onUploadProgress,
        );

        expect(error).toBeNull();
        expect(result?.bodyBase64).toBe(bytesToBase64(uploadBytes));
        expect(result?.headers["content-type"]).toBe(contentType);
        expect(onUploadProgress).not.toHaveBeenCalled();
      },
    );

    async function echoRaw(body: FormData, onUploadProgress: HttpProgressFn) {
      const endpoint = defineRequest({
        builder: () => ({ body }),
        method: "POST",
        output: RawEcho,
        path: "/e2e/echo-raw",
      });
      return endpoint(baseClient({ onUploadProgress }));
    }

    test("should send a FormData upload as built and not call onUploadProgress", async () => {
      const onUploadProgress = vi.fn();
      const [error, result] = await echoRaw(
        createNotesForm(),
        onUploadProgress,
      );

      expect(error).toBeNull();
      expect(decodeBase64(result?.bodyBase64 ?? "")).toBe(
        notesFormBody(result?.contentType ?? ""),
      );
      expect(onUploadProgress).not.toHaveBeenCalled();
    });

    test("should report the declared streaming capability", () => {
      expect(supportsStreamingRequestBody(), `runtime=${cap.runtime}`).toBe(
        cap.streamBody,
      );
    });

    test("should refuse or fail a caller-supplied ReadableStream without posting it", async () => {
      // Chromium can stream request bodies, so Defjs hands the stream to fetch with `duplex: 'half'`.
      // Chromium streams request bodies only over HTTP/2 or later. This server is HTTP/1.1, so fetch
      // rejects after the CORS preflight and before the POST is sent.
      const path = `/e2e/miss/stream-body-${browser}-${Date.now()}`;
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
      const [error, result] = await endpoint(baseClient);
      const hits = await missHits(baseClient, path);

      expect(result).toBeUndefined();
      if (uploadOutcome(cap, "ReadableStream", "platform") === "unsupported") {
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
      // Defjs relays the stream, so the failed send releases it, but a cancelled stream cannot be sent again.
      await vi.waitFor(() => expect(stream.locked).toBe(false), 10_000);
      expect(() => new Response(stream)).toThrow(TypeError);
    });
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
