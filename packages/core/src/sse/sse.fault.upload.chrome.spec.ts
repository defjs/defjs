import { registerSseFaultUploadSuite } from "../../test/suites/sse.fault-upload.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";

registerSseFaultUploadSuite(uploadCapabilities.chrome);
