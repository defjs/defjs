// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { getUser } from "./define-request.ts";

const client = createClient(withEndpoint("https://api.example.com/v1"));

async function main() {
  const command = getUser({ id: 7 });
  const [error, user] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.name);
}

void main();
// #endregion
