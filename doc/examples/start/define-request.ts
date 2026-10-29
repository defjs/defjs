// #region example
import { defineRequest, struct } from "@defjs/core";

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
});

const NotFound = struct.object({
  message: struct.string(),
});

export const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
  error: NotFound,
});

// #endregion
