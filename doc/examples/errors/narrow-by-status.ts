// #region example
import { struct, type Fault } from "@defjs/core";

const ApiError = struct.discriminatedUnion("status", [
  struct.object({ status: struct.literal(404), resource: struct.string() }),
  struct.object({ status: struct.literal(429), retryAfter: struct.number() }),
]);

declare const err: Fault<typeof ApiError>;

if (err.code === "HTTP_STATUS" && err.data.status === 429) {
  console.log(err.data.retryAfter);
}
// #endregion
