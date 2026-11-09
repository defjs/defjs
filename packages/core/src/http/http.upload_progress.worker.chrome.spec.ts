import { registerUploadProgressWorkerSuite } from "../../test/suites/upload-progress-worker.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";

registerUploadProgressWorkerSuite(uploadCapabilities.chrome);
