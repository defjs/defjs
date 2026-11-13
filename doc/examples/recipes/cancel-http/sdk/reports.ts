// #region example
import { defineRequest } from "@defjs/core";

export const getReport = defineRequest({
  method: "GET",
  path: "/report",
});
// #endregion
