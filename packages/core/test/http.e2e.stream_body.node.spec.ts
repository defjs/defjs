import { registerStreamBodyE2eSuite } from "./suites/stream-body-e2e.ts";
import { uploadCapabilities } from "./upload-capability.ts";

registerStreamBodyE2eSuite(uploadCapabilities.node);
