// #region example
import { createClient, defineRequest, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const health = defineRequest({ method: "GET", path: "/health" });
const [error, data, response] = await client.execute(health());
if (!error) console.log(data, response.status);
// #endregion
