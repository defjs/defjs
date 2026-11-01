// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getHealth } from "./get-health.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, result] = await getHealth(client);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(result.ok);
}

void main();
// #endregion
