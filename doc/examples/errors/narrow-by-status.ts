// #region example
import { struct, type Fault } from "@defjs/core";

const ApiError = struct.discriminatedUnion("status", [
  struct.object({ status: struct.literal(404), resource: struct.string() }),
  struct.object({ status: struct.literal(429), retryAfter: struct.number() }),
]);

declare const fault: Fault<typeof ApiError>;

if (fault.code === "HTTP_STATUS" && fault.data.status === 429) {
  console.log(fault.data.retryAfter);
}
// #endregion
