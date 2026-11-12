# Consume an SSE stream [#consume-an-sse-stream]

Each `EventStreamHandle` exposes a single async iterator. Always place `stream.close(...)` and `await stream.closed` inside a `finally` block so early `break` or `return` statements never leak the underlying Fetch stream:

<Tabs items={["sdk/deployments.ts", "app/main.ts"]}>
  <Tab>
```typescript
import { defineEventStream, struct } from "@defjs/core";

export const deployEvents = defineEventStream({
  path: "/deployments/events",
  events: {
    line: struct.object({ text: struct.string() }),
  },
});
```

  </Tab>
  <Tab>
```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { deployEvents } from "../sdk/deployments.ts";

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, stream] = await deployEvents(client);
  if (error) {
    console.error(error.code);
    return;
  }
  try {
    for await (const event of stream) {
      if (event.event === "line") {
        console.log(event.data.text);
        break;
      }
    }
  } finally {
    stream.close("consumer-finished");
    await stream.closed;
  }
}

void main();
```

  </Tab>
</Tabs>

With a server whose first event is `line` with data `{ "text": "build started" }`, the script prints:

```txt
build started
```

- SSE does not automatically reconnect on network or read failures unless you configure [`withRetry(...)`](/api/core/withretry) on the client.
- When `withRetry(...)` is set, `maxRetries` defaults to `3` per outage and resets on a successful handshake (`maxRetries: 0` disables retries). Without a custom `shouldRetry`, only `GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT`, and `DELETE` requests are retried. A request with a `ReadableStream` body never is. See [SSE event streams](/docs/sse).
