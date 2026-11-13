// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getHealth } from "./get-health.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, result] = await getHealth(client);
  if (err) {
    console.error(err.code);
    return;
  }
  console.log(result.ok);
}

void main();
// #endregion
