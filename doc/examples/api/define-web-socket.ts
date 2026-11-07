// #region example
import { defineWebSocket, struct } from "@defjs/core";

const quotes = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: "/quotes",
  protocols: ["quotes.v1"],
  incoming: struct.object({
    type: struct.literal("tick"),
    symbol: struct.string(),
    price: struct.number(),
  }),
  outgoing: struct.object({
    type: struct.literal("subscribe"),
    symbol: struct.string(),
  }),
});
// #endregion
