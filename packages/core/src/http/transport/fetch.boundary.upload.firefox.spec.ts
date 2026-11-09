import { registerFetchBoundaryUploadSuite } from "../../../test/suites/fetch.boundary-upload.ts";
import { uploadCapabilities } from "../../../test/upload-capability.ts";

registerFetchBoundaryUploadSuite(uploadCapabilities.firefox);
