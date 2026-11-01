// #region example
import { defineRequest, struct, type Client } from "@defjs/core";

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

async function loadUser(client: Client) {
  const [error, user] = await getUser(client, { id: 7 });
  if (error) return;
  console.log(user.name);
}

void loadUser;
// #endregion
