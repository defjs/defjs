// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { openTicker } from "../sdk/ticks-socket.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, session] = await openTicker(client);
  if (err) {
    console.error(err.code);
    return;
  }

  await using active = session;
  active.send({ type: "subscribe", symbol: "ACME" });

  for await (const message of active.receive) {
    if (message.type === "tick") {
      console.log(message.symbol, message.price);
      break;
    }
  }
}

void main();
// #endregion
