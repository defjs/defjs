// #region example
import { struct, type Fault } from "@defjs/core";

const ApiError = struct.discriminatedUnion("kind", [
  struct.object({
    kind: struct.literal("validation"),
    fields: struct.array(struct.string()),
  }),
  struct.object({
    kind: struct.literal("rateLimit"),
    retryAfter: struct.number(),
  }),
]);

declare const err: Fault<typeof ApiError>;

if (err.code === "HTTP_STATUS") {
  switch (err.data.kind) {
    case "validation":
      console.log(err.data.fields.length);
      break;
    case "rateLimit":
      console.log(err.data.retryAfter);
      break;
  }
}
// #endregion
