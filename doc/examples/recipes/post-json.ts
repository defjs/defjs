// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com/v1"));

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  email: struct.string(),
});

const ApiError = struct.object({
  code: struct.string(),
  message: struct.string(),
});

const NewUser = struct.object({
  name: struct.string(),
  email: struct.string(),
});

const createUser = defineRequest({
  method: "POST",
  path: "/users",
  input: NewUser,
  builder: (input) => ({ body: input }),
  output: User,
  error: ApiError,
});

const [error, user, response] = await client.execute(
  createUser({ name: "Ada", email: "ada@example.com" }),
);

if (error?.code === "HTTP_STATUS") {
  console.error(error.status, error.data.message);
} else if (error) {
  console.error(error.code);
} else {
  console.log(`Created ${user.name} → ${response.status}`);
}
// #endregion
