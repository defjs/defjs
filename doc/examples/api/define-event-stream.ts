// #region example
import { defineEventStream, struct } from "@defjs/core";

const ticks = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: "/ticks",
  events: { message: struct.object({ text: struct.string() }) },
});
// #endregion
