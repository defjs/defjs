import { registerHttpBalancerUploadSuite } from "../../test/suites/http.balancer-upload.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";

registerHttpBalancerUploadSuite(uploadCapabilities.bun);
