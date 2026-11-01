// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, user] = await getUser(client, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.name);
}

void main();
// #endregion
