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

async function main() {
  const [error, user, response] = await getUser(client, { id: 7 });
  if (error?.code === "HTTP_STATUS" && error.status === 404) {
    console.log(error.data.message);
    return;
  }
  if (error?.code === "NET_TIMEOUT") {
    console.log("timed out");
    return;
  }
  if (error?.code === "RES_STRUCT_MISMATCH") {
    console.log(
      "the response did not match what we declared",
      error.response.status,
    );
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.name, response.status);
}

void main();
// #endregion
