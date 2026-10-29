// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getHealth } from "./get-health.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const command = getHealth();
  const [error, result] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(result.ok);
}

void main();
// #endregion
