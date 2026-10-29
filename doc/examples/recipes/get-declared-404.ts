// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

async function main() {
  const command = getUser({ id: 7 });
  const [error, user, response] = await client.execute(command);
  if (error?.code === "HTTP_STATUS" && error.status === 404) {
    console.log(error.data.message);
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(`Loaded ${user.name} from ${response.status}`);
}

void main();
// #endregion
