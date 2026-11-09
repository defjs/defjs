import { registerBuilderEncodingUploadSuite } from "../suites/builder-encoding-upload.ts";
import { uploadCapabilities } from "../upload-capability.ts";

registerBuilderEncodingUploadSuite(uploadCapabilities.node);
