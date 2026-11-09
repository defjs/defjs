import { afterEach, beforeEach, describe, vi } from "vitest";
import { __resetStreamingRequestBodySupportForTests } from "./transport/fetch_init.ts";
import { registerUploadObserverSuite } from "../../test/suites/upload-observer.ts";
import { installStreamingRequestShim } from "../../test/streaming-request-shim.ts";
import { simulatedFirefoxStreaming } from "../../test/upload-capability.ts";

describe("simulated Firefox upload progress observer", () => {
  beforeEach(installStreamingRequestShim);
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetStreamingRequestBodySupportForTests();
  });
  registerUploadObserverSuite(simulatedFirefoxStreaming, ["custom"]);
});
