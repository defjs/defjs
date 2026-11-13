// #region example
import { defineRequest, struct } from "@defjs/core";

const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
});

const NotFound = struct.object({
  message: struct.string(),
});

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: Order,
  error: NotFound,
});

// #endregion
