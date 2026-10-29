// #region example
import { struct, type Fault } from "@defjs/core";

const ApiError = struct.or(
  struct.object({ message: struct.string() }),
  struct.object({ retryAfter: struct.number() }),
);

declare const fault: Fault<typeof ApiError>;

if (fault.code === "HTTP_STATUS" && "retryAfter" in fault.data) {
  console.log(fault.data.retryAfter);
}
// #endregion
