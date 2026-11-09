import { registerEventStreamAdvancedUploadSuite } from "../../../test/suites/event_stream.advanced-upload.ts";
import { uploadCapabilities } from "../../../test/upload-capability.ts";

registerEventStreamAdvancedUploadSuite(uploadCapabilities.chrome);
