// #region example
import { defineEventStream, struct } from "@defjs/core";

const deployEvents = defineEventStream({
  path: "/deployments/events",
  events: { line: struct.object({ text: struct.string() }) },
});
// #endregion
