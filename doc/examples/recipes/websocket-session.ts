// #region example
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://quotes.example.com"));

const quotes = defineWebSocket({
  maxIncomingQueueSize: 100,
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
  const [error, session] = await quotes(client);
  if (error) {
    console.error(error.code);
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
