// #region example
import { createClient, defineRequest, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const health = defineRequest({ method: "GET", path: "/health" });

async function main() {
  const command = health();
  const [error, data, response] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(data, response.status);
}

void main();
// #endregion
