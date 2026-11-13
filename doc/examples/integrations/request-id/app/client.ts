// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { withRequestIdHeader } from "../plugins/request-id.ts";

export const client = createClient(
  withEndpoint("https://api.example.com"),
  withRequestIdHeader(),
);
// #endregion
