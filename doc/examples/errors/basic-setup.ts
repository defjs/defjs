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

const [err, user, response] = await client.execute(getUser({ id: 7 }));
if (err?.code === "HTTP_STATUS" && err.status === 404) {
  console.log(err.data.message);
} else if (err?.code === "NET_TIMEOUT") {
  console.log("timed out");
} else if (err?.code === "RES_STRUCT_MISMATCH") {
  console.log(
    "the response did not match what we declared",
    err.response.status,
  );
} else if (!err) {
  console.log(user.name, response.status);
}
// #endregion
