// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getUser } from "./define-request.ts";

const client = createClient(withEndpoint("https://api.example.com/v1"));
const [error, user] = await client.execute(getUser({ id: 7 }));

if (error) console.error(error.code);
else console.log(user.name);
// #endregion
