// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com/v1"));
const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({
    path: { id: input.id },
    query: { fields: input.fields },
  }),
});

const command = getUser({ id: "a/b", fields: "name" });
// → https://api.example.com/v1/users/a%2Fb?fields=name

async function main() {
  const [error] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
}

void main();
// #endregion
