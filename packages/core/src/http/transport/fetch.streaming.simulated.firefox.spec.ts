import { beforeEach, describe } from "vitest";
import { registerStreamingUploadSuite } from "../../../test/suites/streaming-upload.ts";
import { installStreamingRequestShim } from "../../../test/streaming-request-shim.ts";
import { simulatedFirefoxStreaming } from "../../../test/upload-capability.ts";

describe("simulated Firefox streaming request bodies", () => {
  beforeEach(installStreamingRequestShim);
  registerStreamingUploadSuite(simulatedFirefoxStreaming);
});
