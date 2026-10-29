import { createClient, withEndpoint } from "../src/client";
import { defineRequest } from "../src/http";
import type { HttpProgressFn } from "../src/http";
import { supportsStreamingRequestBody } from "../src/http/transport/fetch";
import { struct } from "../src/struct";
import { createNotesForm } from "./multipart-fixture";

const uploadBytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x41]);

const EchoReport = struct.object({
  bodyBase64: struct.string(),
  headers: struct.record(struct.string()),
});

const RawEcho = struct.object({
  bodyBase64: struct.string(),
  contentType: struct.string(),
});

export type UploadCallReport = {
  bodyBase64: string | null;
  calls: number;
  contentType: string | null;
  errorCode: string | null;
};

export type ModuleWorkerReport = {
  blob: UploadCallReport;
  documentType: string;
  form: UploadCallReport;
  importScriptsInGlobal: boolean;
  importScriptsType: string;
  streaming: boolean;
};

self.onmessage = (event: MessageEvent<string>) => {
  void reportUpload(event.data).then(
    (report) => {
      self.postMessage(report);
    },
    (error: unknown) => {
      self.postMessage({
        failed: error instanceof Error ? error.message : String(error),
      });
    },
  );
};

async function reportUpload(host: string): Promise<ModuleWorkerReport> {
  const client = createClient(withEndpoint(host));
  const importScriptsValue = (globalThis as { importScripts?: unknown })
    .importScripts;
  return {
    blob: await sendBlob(client),
    documentType: typeof document,
    form: await sendForm(client),
    importScriptsInGlobal: "importScripts" in globalThis,
    importScriptsType: typeof importScriptsValue,
    streaming: supportsStreamingRequestBody(),
  };
}

async function sendBlob(
  client: ReturnType<typeof createClient>,
): Promise<UploadCallReport> {
  let calls = 0;
  const onUploadProgress: HttpProgressFn = () => {
    calls += 1;
  };
  const endpoint = defineRequest({
    builder: () => ({
      body: new Blob([uploadBytes], { type: "application/x-defjs-upload" }),
    }),
    method: "POST",
    output: EchoReport,
    path: "/e2e/echo",
  });
  const [error, result] = await client.execute(endpoint(), {
    onUploadProgress,
  });
  return {
    bodyBase64: result?.bodyBase64 ?? null,
    calls,
    contentType: result?.headers["content-type"] ?? null,
    errorCode: error?.code ?? null,
  };
}

async function sendForm(
  client: ReturnType<typeof createClient>,
): Promise<UploadCallReport> {
  let calls = 0;
  const onUploadProgress: HttpProgressFn = () => {
    calls += 1;
  };
  const endpoint = defineRequest({
    builder: () => ({ body: createNotesForm() }),
    method: "POST",
    output: RawEcho,
    path: "/e2e/echo-raw",
  });
  const [error, result] = await client.execute(endpoint(), {
    onUploadProgress,
  });
  return {
    bodyBase64: result?.bodyBase64 ?? null,
    calls,
    contentType: result?.contentType ?? null,
    errorCode: error?.code ?? null,
  };
}
