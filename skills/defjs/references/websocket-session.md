# Open a WebSocket session [#open-a-websocket-session]

Declare `incoming` and `outgoing` Structs on `defineWebSocket`. In your application, subscribe to `session.onRuntimeError(...)`, consume `session.receive`, and always unsubscribe, call `session.close(...)`, and `await session.closed` in `finally`:

<Tabs items={["sdk/quotes.ts", "app/main.ts"]}>
  <Tab>
```typescript
import { defineWebSocket, struct } from "@defjs/core";

export const quotes = defineWebSocket({
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
```

  </Tab>
  <Tab>
```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { quotes } from "../sdk/quotes.ts";

const client = createClient(withEndpoint("https://quotes.example.com"));

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
```

  </Tab>
</Tabs>

With a server that replies to `{ "type": "subscribe", "symbol": "ACME" }` with `{ "type": "tick", "symbol": "ACME", "price": 142.5 }`, the script prints:

```txt
ACME 142.5
```

- Both reconnection (`withRetry`) and heartbeat (`withWebSocketHeartbeat`) are opt-in on the client.
- Browser WebSockets cannot send arbitrary HTTP headers during the upgrade handshake; use cookies, subprotocols, or short-lived tickets instead. See [WebSocket sessions](/docs/web-socket).
