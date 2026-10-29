import { defineRequest, struct } from "../../src";

const User = struct.object({ id: struct.string().alias("user_id") });

// Parsed object nodes keep their tags inside records, tuples, and chained modifiers.
// Each of these valid builders should compile without a cast or manually spelling the wire key.
defineRequest({
  input: struct.record(User),
  method: "GET",
  path: "/users/:user_id",
  builder: (input) => ({ path: input["selected"] }),
});

defineRequest({
  input: struct.tuple([User]),
  method: "GET",
  path: "/users/:user_id",
  builder: (input) => ({ path: input[0] }),
});

defineRequest({
  input: struct.object({ selected: User.optional().nullable() }),
  method: "GET",
  path: "/users/:user_id",
  builder: (input) => ({ path: input.selected ?? { user_id: "fallback" } }),
});
