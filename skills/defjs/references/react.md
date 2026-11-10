# React integration (`@defjs/react`)

Contents: [Boundary and exports](#boundary-and-exports) · [`ClientProvider` setup](#clientprovider-setup) · [Effect requests with cancellation](#effect-requests-with-cancellation) · [Event handlers and explicit client override](#event-handlers-and-explicit-client-override) · [Owning SSE or WebSocket work in React](#owning-sse-or-websocket-work-in-react)

## Boundary and exports

`@defjs/react` exports `ClientProvider` and `useClient`.

- It is a thin Context bridge, **not** a query, cache, or state management library.
- `ClientProvider` accepts, and `useClient` returns, a root `DerivableClient` (created by `createClient`); a derived `client(options)` value is never accepted.
- Do not pass the `client` returned by `useClient()` into `useState(client)` or `setState(client)`—because `DerivableClient` is a function, React would invoke it as a lazy initializer or state updater.

## `ClientProvider` setup

```tsx
import { createClient, withEndpoint } from "@defjs/core";
import { ClientProvider } from "@defjs/react";
import type { ReactNode } from "react";

const client = createClient(withEndpoint("https://api.example.com"));

export function ApiProvider({ children }: { children: ReactNode }) {
  return <ClientProvider client={client}>{children}</ClientProvider>;
}
```

- For SSR, when headers, cookies, or credentials differ per request, create the client inside the request boundary and render `<ClientProvider client={requestClient}>`.

## Effect requests with cancellation

Always define operations (`defineRequest`, `defineEventStream`, `defineWebSocket`) at module scope, outside components. Inside `useEffect`, create an `AbortController`, derive `client({ signal: controller.signal })` at the call site, ignore results after abort, and abort in the cleanup function:

```tsx
import { defineRequest, struct } from "@defjs/core";
import { useClient } from "@defjs/react";
import { useEffect, useState } from "react";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ status: struct.string() }),
});

export function OrderStatus({ id }: { id: number }) {
  const client = useClient();
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    void getOrder(client({ signal: controller.signal }), { id }).then(
      ([error, order]) => {
        if (controller.signal.aborted) return;
        if (error) {
          setStatus(undefined);
          return;
        }
        setStatus(order.status);
      },
    );

    return () => controller.abort();
  }, [client, id]);

  return <span>{status ?? "Loading..."}</span>;
}
```

## Event handlers and explicit client override

- `useClient(overrideClient?)` must always be called unconditionally at the top level of a component or custom Hook. Never write `overrideClient ?? useClient()`.
- If `overrideClient` is provided, `useClient(overrideClient)` returns it directly; if `undefined`, it reads the nearest `ClientProvider`.

## Owning SSE or WebSocket work in React

When opening a stream or WebSocket inside `useEffect`, track disposal so that unmount aborts startup, closes an already-open session, and suppresses expected abort errors:

```tsx
import { defineWebSocket, struct } from "@defjs/core";
import { useClient } from "@defjs/react";
import { useEffect } from "react";

const quotes = defineWebSocket({
  path: "/quotes",
  incoming: struct.object({
    symbol: struct.string(),
    price: struct.number(),
  }),
});

export function QuoteTicker() {
  const client = useClient();

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let closeActive: (() => void) | undefined;

    void (async () => {
      const [error, session] = await quotes(
        client({ signal: controller.signal }),
      );
      if (error) return;

      const close = () => session.close(1000, "effect-disposed");
      closeActive = close;
      if (disposed) {
        close();
        await session.closed;
        return;
      }

      try {
        for await (const message of session.receive) {
          console.info(message.symbol, message.price);
        }
      } catch (cause) {
        if (!disposed) console.error("quotes failed", cause);
      } finally {
        close();
        await session.closed;
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      closeActive?.();
    };
  }, [client]);

  return null;
}
```
