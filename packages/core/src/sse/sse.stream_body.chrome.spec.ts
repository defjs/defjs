import { registerSseStreamBodySuite } from "../../test/suites/sse-stream-body.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";

registerSseStreamBodySuite(uploadCapabilities.chrome, "chromium");
