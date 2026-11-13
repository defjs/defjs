import { describe, expect, inject, test } from "vitest";
import { createClient, withEndpoint } from "../../src/client/index.ts";
import { defineRequest } from "../../src/http/index.ts";
import { struct } from "../../src/struct/index.ts";
import { uploadOutcome, type UploadCapability } from "../upload-capability.ts";
import { expectUploadOutcome } from "../upload-outcome-assert.ts";

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

export function registerStreamBodyE2eSuite(cap: UploadCapability): void {
  describe("stream body e2e", () => {
    test("sends a ReadableStream body according to this runtime's capability", async () => {
      const payload = new TextEncoder().encode("stream-bytes");
      const sendStream = defineRequest({
        builder: () => ({
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(payload);
              controller.close();
            },
          }),
        }),
        method: "POST",
        output: EchoReport,
        path: "/e2e/echo",
      });
      const client = createClient(withEndpoint(inject("testServerHost")));
      const [error, result, response] = await sendStream(client);
      const outcome = uploadOutcome(cap, "ReadableStream", "platform");
      if (outcome === "observed") {
        expect(error).toBeNull();
        if (result === undefined) {
          throw new Error("Expected a decoded success value");
        }
        expect(result.headers["content-type"]).toBe("application/octet-stream");
        expect(result.bodyText).toBe("stream-bytes");
        return;
      }

      expectUploadOutcome(outcome, {
        error,
        result,
        response,
        observerCalls: 0,
      });
    });
  });
}
