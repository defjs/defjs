// #region example
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import { getUser } from "./users-sdk.ts";

const handle: FetchHandle = async () =>
  Response.json({ id: 7, name: "Ada" }, { status: 200 });

const client = createClient(
  withEndpoint("https://api.example.test"),
  withHTTPHandle(handle),
);
const [error, user] = await client.execute(getUser({ id: 7 }));

if (error) console.error(error.code);
else console.log(user.name);
// #endregion
