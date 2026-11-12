# Cancel an HTTP call [#cancel-an-http-call]

Combine a caller `AbortController` with a deadline using `AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)])` and pass the combined signal via `client({ signal })`. Defjs classifies a manual caller abort as `NET_ABORTED` and a timeout abort as `NET_TIMEOUT`.

<Tabs items={["sdk/reports.ts", "app/main.ts"]}>
  <Tab>
```typescript
import { defineRequest } from "@defjs/core";

export const getReport = defineRequest({
  method: "GET",
  path: "/report",
});
```

  </Tab>
  <Tab>
```typescript
import { createClient, withEndpoint } from "@defjs/core";
import { getReport } from "../sdk/reports.ts";

const client = createClient(withEndpoint("https://api.example.com"));

const controller = new AbortController();
const pending = getReport(
  client({
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
  }),
);

controller.abort("screen closed");

async function main() {
  const [error] = await pending;
  if (error?.code === "NET_ABORTED") {
    console.log("caller cancelled");
    return;
  }
  if (error?.code === "NET_TIMEOUT") {
    console.log("timed out");
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log("got the report");
}

void main();
```

  </Tab>
</Tabs>

```txt
caller cancelled
```

Cancellation reports what the client observed—it does not guarantee that a server-side write rolled back. Guard mutation retries behind an idempotency key. See [HTTP cancellation and timeouts](/docs/http#cancel-the-work).
