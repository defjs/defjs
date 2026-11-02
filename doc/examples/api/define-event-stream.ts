// #region example
import { defineEventStream, struct } from "@defjs/core";

const deployEvents = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: "/deployments/events",
  events: { line: struct.object({ text: struct.string() }) },
});
// #endregion
