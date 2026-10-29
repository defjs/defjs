// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  active: struct.boolean(),
});

type User = Infer<typeof User>;

const createUser = defineRequest({
  method: "POST",
  path: "/users",
  input: struct.object({
    name: struct.string(),
    email: struct.string(),
  }),
  builder: (input) => ({ body: input }),
  output: User,
});

const [parseError, user] = struct.parse(User, {
  id: 7,
  name: "Ada",
  active: true,
});
if (!parseError) console.log(user.name);
void createUser;
// #endregion
