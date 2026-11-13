import { registerUploadCapabilitySelfCheckSuite } from "./suites/upload-capability-self-check.ts";
import { uploadCapabilities } from "./upload-capability.ts";

registerUploadCapabilitySelfCheckSuite(uploadCapabilities.bun);
