import { registerSseBalancerUploadSuite } from "../../test/suites/sse.balancer-upload.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";

registerSseBalancerUploadSuite(uploadCapabilities.node);
