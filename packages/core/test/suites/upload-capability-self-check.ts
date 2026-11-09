import { expect, inject, test } from "vitest";
import { supportsStreamingRequestBody } from "../../src/http/transport/fetch_init.ts";
import { fixture } from "../fixture/client-auto.ts";
import { uploadOutcome, type UploadCapability } from "../upload-capability.ts";

export function registerUploadCapabilitySelfCheckSuite(
  cap: UploadCapability,
): void {
  test("sends a ReadableStream upload according to the declared outcome", async () => {
    const f = fixture(inject("testServerHost"), inject("fixtureToken"));
    const url = await f.endpoint("echo", "respond", { status: 200 });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      duplex: "half",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("stream-bytes"));
          controller.close();
        },
      }),
    };
    const pending = fetch(url, init);
    switch (uploadOutcome(cap, "ReadableStream", "platform")) {
      case "observed":
        expect((await pending).status).toBe(200);
        return;
      case "unreachable":
        await expect(pending).rejects.toBeInstanceOf(TypeError);
        return;
      case "unsupported": {
        expect((await pending).status).toBe(200);
        const request = (await f.log({ wait: 1 })).requests[0];
        expect(request?.headers["content-type"]).toMatch(/^text\/plain/);
        expect(request?.headers["content-length"]).toBe("23");
        return;
      }
      case "bypassed":
        throw new Error("ReadableStream uploads are never bypassed");
    }
  });

  test("declares the runtime's streaming capability", () => {
    expect(supportsStreamingRequestBody()).toBe(cap.streamBody);
  });
}
