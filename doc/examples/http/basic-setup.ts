// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

const [error, data, response] = await client.execute(getUser({ id: 7 }));
if (error?.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data.message);
} else if (!error) {
  console.log(data.name, response.status);
}
// #endregion
