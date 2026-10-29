// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const updateUser = defineRequest({
  method: "PATCH",
  path: "/users/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({
      displayName: struct.string().alias("display_name"),
    }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
  output: struct.object({
    id: struct.number(),
    displayName: struct.string().alias("display_name"),
  }),
});

async function main() {
  const command = updateUser({
    id: 7,
    requestId: "request-42",
    profile: { displayName: "Ada" },
  });
  const [error, user] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.id);
}

void main();
// #endregion
