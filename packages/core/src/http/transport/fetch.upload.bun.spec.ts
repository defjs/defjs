import { registerFetchUploadSuite } from "../../../test/suites/fetch-upload.ts";
import { uploadCapabilities } from "../../../test/upload-capability.ts";

registerFetchUploadSuite(uploadCapabilities.bun);
