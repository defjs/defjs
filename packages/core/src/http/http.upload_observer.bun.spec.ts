import { registerUploadObserverSuite } from "../../test/suites/upload-observer.ts";
import { uploadCapabilities } from "../../test/upload-capability.ts";

registerUploadObserverSuite(uploadCapabilities.bun);
