// #region example
import { defineRequest, struct } from "@defjs/core";

export const getHealth = defineRequest({
  method: "GET",
  path: "/health",
  output: struct.object({ ok: struct.boolean() }),
});

// #endregion
