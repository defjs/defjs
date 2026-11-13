// #region example
import { defineWebSocket, struct } from "@defjs/core";

export const TickFrame = struct.discriminatedUnion("type", [
  struct.object({
    type: struct.literal("tick"),
    symbol: struct.string(),
    price: struct.number(),
  }),
  struct.object({
    type: struct.literal("subscribed"),
    symbol: struct.string(),
  }),
]);

export const SubscribeCommand = struct.object({
  type: struct.literal("subscribe"),
  symbol: struct.string(),
});

export const openTicker = defineWebSocket({
  path: "/market/ws",
  operation: "market.ticker",
  incoming: TickFrame,
  outgoing: SubscribeCommand,
});
// #endregion
