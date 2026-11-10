// #region example
import {
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
} from "@defjs/core";

const readOrders = defineRequest({
  method: "GET",
  operation: "orders.read",
  path: "/orders",
});
const orderEvents = defineEventStream({
  operation: "orders.watch",
  path: "/orders/events",
  events: { update: struct.object({ id: struct.number() }) },
});
const orderSocket = defineWebSocket({
  operation: "orders.connect",
  path: "/orders/socket",
  incoming: struct.object({ id: struct.number() }),
});

void readOrders;
void orderEvents;
void orderSocket;
// #endregion
