import { registerTruncatedBalancerSuite } from "./suites/truncated-balancer.ts";

// Firefox does not check the HTTP/1.1 chunked terminator, so the truncated
// body arrives whole and declared JSON fails to decode.
registerTruncatedBalancerSuite("RES_DECODE_FAILED");
