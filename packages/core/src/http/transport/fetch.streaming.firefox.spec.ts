import { registerStreamingUploadSuite } from "../../../test/suites/streaming-upload.ts";
import { uploadCapabilities } from "../../../test/upload-capability.ts";

registerStreamingUploadSuite(uploadCapabilities.firefox);
