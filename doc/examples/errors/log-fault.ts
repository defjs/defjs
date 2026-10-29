// #region example
import { StructError, type AnyFault } from "@defjs/core";

export function logFault(fault: AnyFault): void {
  console.error(String(fault), { code: fault.code });
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify());
  }
}
// #endregion
