import { registerHttpFailoverUploadSuite } from "../../test/suites/http.failover-upload.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";

registerHttpFailoverUploadSuite(uploadCapabilities.chrome);
