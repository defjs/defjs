// #region example
import { struct, type Fault } from "@defjs/core";

const ApiError = struct.or(
  struct.object({ message: struct.string() }),
  struct.object({ retryAfter: struct.number() }),
);

declare const err: Fault<typeof ApiError>;

if (err.code === "HTTP_STATUS" && "retryAfter" in err.data) {
  console.log(err.data.retryAfter);
}
// #endregion
