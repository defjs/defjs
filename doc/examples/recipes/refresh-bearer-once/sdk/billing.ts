// #region example
import { defineRequest, struct } from "@defjs/core";

export const getInvoice = defineRequest({
  method: "GET",
  path: "/v1/invoice",
  output: struct.object({ total: struct.number() }),
  error: struct.object({ code: struct.literal("expired_token") }),
});
// #endregion
