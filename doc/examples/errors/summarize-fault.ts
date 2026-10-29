// #region example
import type { AnyFault } from "@defjs/core";

export function summarize(fault: AnyFault): {
  code: AnyFault["code"];
  status?: number;
} {
  return {
    code: fault.code,
    status: "status" in fault ? fault.status : undefined,
  };
}
// #endregion
