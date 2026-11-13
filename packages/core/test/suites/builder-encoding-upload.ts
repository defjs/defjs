import { expect, test } from "vitest";
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
} from "../../src/client/index.ts";
import { defineRequest } from "../../src/http/index.ts";
import { uploadOutcome, type UploadCapability } from "../upload-capability.ts";
import { expectUploadOutcome } from "../upload-outcome-assert.ts";

export function registerBuilderEncodingUploadSuite(
  cap: UploadCapability,
): void {
  test("surfaces stream reuse as a second-call transport failure", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    });
    let handleCalls = 0;
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(async (input) => {
        handleCalls += 1;
        const request = input instanceof Request ? input : new Request(input);
        await request.arrayBuffer();
        return new Response(null, { status: 204 });
      }),
    );
    const upload = defineRequest({
      builder: () => ({ body: stream }),
      method: "POST",
      path: "/stream",
    });

    const [firstError, firstResult, firstResponse] = await upload(client);
    const [secondError, secondResult, secondResponse] = await upload(client);
    const outcome = uploadOutcome(cap, "ReadableStream", "custom");
    if (outcome !== "observed") {
      if (outcome !== "unsupported") {
        throw new Error(`a custom ReadableStream upload is not ${outcome}`);
      }
      expectUploadOutcome(outcome, {
        error: firstError,
        result: firstResult,
        response: firstResponse,
        observerCalls: 0,
      });
      expectUploadOutcome(outcome, {
        error: secondError,
        result: secondResult,
        response: secondResponse,
        observerCalls: 0,
      });
      expect(handleCalls).toBe(0);
      expect(stream.locked).toBe(false);
      return;
    }

    expect(firstError).toBeNull();
    expect(secondError?.code).toBe("REQ_BUILD_FAILED");
  });
}
