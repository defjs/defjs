// #region example
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://quotes.example.com"));
const quotes = defineWebSocket({
  path: "/quotes",
  incoming: struct.object({
    type: struct.literal("tick"),
    symbol: struct.string(),
    price: struct.number(),
  }),
  outgoing: struct.object({
    type: struct.literal("subscribe"),
    symbol: struct.string(),
  }),
});

async function main() {
  const [error, session, startupConnection] = await quotes(client);
  if (error) {
    console.error(error.code, startupConnection?.generation);
    return;
  }
  await using ownedSession = session;
  const unsubscribe = ownedSession.onRuntimeError((cause) =>
    console.error("runtime", cause),
  );
  try {
    ownedSession.send({ type: "subscribe", symbol: "ACME" });
    // wire: {"type":"subscribe","symbol":"ACME"}
    for await (const message of ownedSession.receive) {
      console.log(message.symbol, message.price);
      break;
    }
  } finally {
    unsubscribe();
  }
}

void main();
// #endregion
