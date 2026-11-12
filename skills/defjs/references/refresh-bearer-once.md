# Refresh a Bearer token once on 401 [#refresh-a-bearer-token-once-on-401]

In Defjs, `next(request)` invokes the remainder of the interceptor chain inward—it does not re-dispatch from the outermost interceptor. Place token attachment, single-flight refresh deduplication, and the one-time `401` replay inside **one** HTTP interceptor so outer logging or timing interceptors do not run twice:

<Tabs items={["sdk/billing.ts", "app/auth-interceptor.ts", "app/main.ts"]}>
  <Tab>
```typescript
import { defineRequest, struct } from "@defjs/core";

export const getInvoice = defineRequest({
  method: "GET",
  path: "/v1/invoice",
  output: struct.object({ total: struct.number() }),
  error: struct.object({ code: struct.literal("expired_token") }),
});
```

  </Tab>
  <Tab>
```typescript
import { createHttpInterceptor } from "@defjs/core";

export type Credential = { accessToken: string };

export function refreshingBearer(
  read: () => Credential,
  refresh: (stale: Credential) => Promise<Credential>,
) {
  let flight: Promise<Credential> | undefined;

  return createHttpInterceptor(async (request, next) => {
    const authorize = (credential: Credential) => {
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${credential.accessToken}`);
      return { ...request, headers };
    };

    const used = read();
    const response = await next(authorize(used));
    const body = response.body;
    if (
      (typeof ReadableStream !== "undefined" &&
        request.body instanceof ReadableStream) ||
      response.status !== 401 ||
      typeof body !== "object" ||
      body === null ||
      !("code" in body) ||
      body.code !== "expired_token"
    ) {
      return response;
    }

    const current = read();
    if (current.accessToken !== used.accessToken) {
      return next(authorize(current));
    }

    flight ??= refresh(used).finally(() => {
      flight = undefined;
    });
    const refreshed = await flight;
    return next(authorize(refreshed));
  });
}
```

  </Tab>
  <Tab>
```typescript
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
} from "@defjs/core";
import { getInvoice } from "../sdk/billing.ts";
import { refreshingBearer, type Credential } from "./auth-interceptor.ts";

let credential: Credential = { accessToken: "v1" };
const client = createClient(
  withEndpoint("https://billing.example.test"),
  // Stands in for the server: it rejects the stale token and accepts any other.
  withHTTPHandle((input, init) => {
    const auth = new Request(input, init).headers.get("authorization");
    if (auth === "Bearer v1")
      return Promise.resolve(
        Response.json({ code: "expired_token" }, { status: 401 }),
      );
    return Promise.resolve(Response.json({ total: 42 }, { status: 200 }));
  }),
  withInterceptors(
    refreshingBearer(
      () => credential,
      () => {
        credential = { accessToken: "v2" };
        return Promise.resolve(credential);
      },
    ),
  ),
);

async function main() {
  const [error, invoice] = await getInvoice(client);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(invoice.total);
}

void main();
```

  </Tab>
</Tabs>

```txt
42
```

A replayable body is not the same as a repeatable business operation. This interceptor also resends a JSON `POST` after a matching 401: two HTTP deliveries, first rejected and then accepted. Use it for writes only when authentication rejects the first delivery before the business handler runs; preserve a stable idempotency key across both deliveries and use server-side deduplication. If that contract is unavailable, return the 401 instead of automatically replaying the write. The complete example does not replay a `ReadableStream` request body.

See [Interceptors](/docs/interceptors) for onion ordering and retry boundaries.
