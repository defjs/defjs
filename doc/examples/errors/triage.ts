// #region example
import { createNetworkFault, ERR_ABORTED, type AnyFault } from "@defjs/core";

function triage(fault: AnyFault): string {
  switch (fault.code) {
    case "HTTP_STATUS":
      return `status ${fault.status}`;
    case "RES_MEDIA_TYPE_INVALID":
    case "RES_DECODE_FAILED":
    case "RES_STRUCT_MISMATCH":
      return "the contract did not hold";
    case "NET_ABORTED":
      return "the caller canceled";
    case "NET_TIMEOUT":
      return "the deadline expired";
    case "NET_UNREACHABLE":
      return "no response arrived";
    case "NET_BODY_INCOMPLETE":
      return "the response was cut short";
    case "REQ_INPUT_INVALID":
    case "REQ_BUILD_FAILED":
      return "fix the call";
    case "EXT_INTERCEPTOR_FAILED":
    case "EXT_HOOK_FAILED":
    case "EXT_OBSERVER_FAILED":
      return "fix the code you attached";
    case "CAP_BUFFER_EXCEEDED":
      return "raise the declared limit";
    case "ENV_UNSUPPORTED":
      return "the host runtime is missing something";
  }
}

const example: AnyFault = createNetworkFault(ERR_ABORTED);
console.log(triage(example));
// #endregion
