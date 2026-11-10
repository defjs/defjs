import { afterEach, beforeEach, describe, vi } from "vitest";
import { __resetStreamingRequestBodySupportForTests } from "./transport/fetch_init.ts";
import { registerHttpBalancerUploadSuite } from "../../test/suites/http.balancer-upload.ts";
import { installStreamingRequestShim } from "../../test/streaming-request-shim.ts";
import { simulatedFirefoxStreaming } from "../../test/upload-capability.ts";

describe("simulated Firefox upload balancer attribution", () => {
  beforeEach(installStreamingRequestShim);
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetStreamingRequestBodySupportForTests();
  });
  registerHttpBalancerUploadSuite(simulatedFirefoxStreaming, ["custom"]);
});
