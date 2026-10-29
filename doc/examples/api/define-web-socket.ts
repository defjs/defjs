// #region example
import { defineWebSocket, struct } from "@defjs/core";

const chat = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: "/chat",
  protocols: ["chat.v1"],
  incoming: struct.object({
    text: struct.string(),
    type: struct.literal("message"),
  }),
  outgoing: struct.object({
    text: struct.string(),
    type: struct.literal("message"),
  }),
});
// #endregion
