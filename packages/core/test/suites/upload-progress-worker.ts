import { describe, expect, inject, test } from "vitest";
import { decodeBase64, notesFormBody } from "../multipart-fixture.ts";
import type { ModuleWorkerReport } from "../upload-progress.worker.ts";
import { uploadOutcome, type UploadCapability } from "../upload-capability.ts";

const uploadBytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x41]);

export function registerUploadProgressWorkerSuite(cap: UploadCapability): void {
  describe("worker upload progress", () => {
    test("should reject Blob and FormData uploads with onUploadProgress from a Chromium module worker and send them unchanged from Firefox", async () => {
      const worker = new Worker(
        new URL("../upload-progress.worker.ts", import.meta.url),
        { type: "module" },
      );
      try {
        const report = await workerResult<ModuleWorkerReport>(
          worker,
          inject("testServerHost"),
        );
        expect(report.documentType).toBe("undefined");
        expect(report.importScriptsInGlobal).toBe(true);
        expect(report.importScriptsType).toBe("function");
        expect(report.streaming, `runtime=${cap.runtime}`).toBe(cap.streamBody);

        switch (uploadOutcome(cap, "Blob", "platform")) {
          case "bypassed":
            expect(uploadOutcome(cap, "FormData", "platform")).toBe("bypassed");
            expect(report.blob.errorCode).toBeNull();
            expect(report.blob.causeMessage).toBeNull();
            expect(report.blob.bodyBase64).toBe(bytesToBase64(uploadBytes));
            expect(report.blob.contentType).toBe("application/x-defjs-upload");
            expect(report.blob.calls).toBe(0);

            expect(report.form.errorCode).toBeNull();
            expect(report.form.causeMessage).toBeNull();
            expect(decodeBase64(report.form.bodyBase64 ?? "")).toBe(
              notesFormBody(report.form.contentType ?? ""),
            );
            expect(report.form.calls).toBe(0);
            return;
          case "unreachable":
            expect(uploadOutcome(cap, "FormData", "platform")).toBe(
              "unreachable",
            );
            expect(report.blob.errorCode).toBe("NET_UNREACHABLE");
            expect(report.blob.causeMessage).toBe("Failed to fetch");
            expect(report.blob.bodyBase64).toBeNull();
            expect(report.blob.contentType).toBeNull();
            expect(report.blob.calls).toBeGreaterThan(0);

            expect(report.form.errorCode).toBe("NET_UNREACHABLE");
            expect(report.form.causeMessage).toBe("Failed to fetch");
            expect(report.form.bodyBase64).toBeNull();
            expect(report.form.contentType).toBeNull();
            expect(report.form.calls).toBeGreaterThan(0);
            return;
          case "observed":
          case "unsupported":
            throw new Error("unexpected worker platform outcome");
        }
      } finally {
        worker.terminate();
      }
    }, 20_000);

    // Vite dev mode cannot serve ESM imports to a classic worker, so the premise check is a self-contained blob URL.
    test("should expose importScripts and no document in a classic worker", async () => {
      const source = [
        "self.onmessage = () => {",
        "  self.postMessage({",
        "    documentType: typeof document,",
        "    importScriptsInGlobal: 'importScripts' in globalThis,",
        "  })",
        "}",
      ].join("\n");
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
      const worker = new Worker(url);
      try {
        const report = await workerResult<{
          documentType: string;
          importScriptsInGlobal: boolean;
        }>(worker, "go");
        expect(report.documentType).toBe("undefined");
        expect(report.importScriptsInGlobal).toBe(true);
      } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    }, 20_000);
  });
}

function workerResult<T>(worker: Worker, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("worker timed out waiting for a result"));
    }, 15_000);

    const finish = (settle: () => void) => {
      clearTimeout(timer);
      settle();
    };

    worker.addEventListener(
      "message",
      (event: MessageEvent<T | { failed: string }>) => {
        finish(() => {
          const data = event.data;
          if (data && typeof data === "object" && "failed" in data) {
            reject(new Error(data.failed));
            return;
          }
          resolve(data);
        });
      },
    );
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      finish(() => {
        reject(new Error(event.message || "worker error"));
      });
    });
    worker.addEventListener("messageerror", () => {
      finish(() => {
        reject(new Error("worker messageerror"));
      });
    });
    worker.postMessage(message);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
