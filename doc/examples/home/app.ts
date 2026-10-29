// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getHealth } from "./get-health.ts";

const client = createClient(withEndpoint("https://api.example.com"));
const [error, result] = await client.execute(getHealth());

if (error) console.error(error.code);
else console.log(result.ok);
// #endregion
