import { registerUploadProgressBrowserSuite } from "../../test/suites/upload-progress-browser.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";

registerUploadProgressBrowserSuite(uploadCapabilities.firefox, "firefox");
