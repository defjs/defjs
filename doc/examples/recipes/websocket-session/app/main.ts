// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { quotes } from "../sdk/quotes.ts";

const client = createClient(withEndpoint("https://quotes.example.com"));

async function main() {
  const [err, session] = await quotes(client);
  if (err) {
    console.error(err.code);
    return;
  }
  const unsubscribe = session.onRuntimeError((cause) =>
    console.error("runtime", cause),
  );
  try {
    session.send({ type: "subscribe", symbol: "ACME" });
    for await (const message of session.receive) {
      console.log(message.symbol, message.price);
      break;
    }
  } finally {
    unsubscribe();
    session.close(1000, "consumer-finished");
    await session.closed;
  }
}

void main();
// #endregion
