# Testing [#testing]

Because Defjs separates operation definitions from client execution, you can test your real SDK operations and application interceptors offline without starting a network server or mocking internal library functions.

## 1. Inject a local transport handle [#1-inject-a-local-transport-handle]

Use `withHTTPHandle`, `withSSEHandle`, or `withWebSocketHandle` on `createClient(...)` to replace the underlying platform transport. Defjs still runs the full operation pipeline: input `struct` validation, `builder` mapping, URL confinement checks, interceptors, status dispatch, and response `struct` decoding.

<Tabs items={["sdk/orders.ts", "test/orders.spec.ts"]}>
<Tab>

```typescript
import { defineRequest, struct } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
});

export const NotFound = struct.object({
  message: struct.string(),
});

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: Order,
  error: NotFound,
});
```

</Tab>
<Tab>

```typescript
import { expect, test } from "vitest";
import { createClient, withEndpoint, withHTTPHandle } from "@defjs/core";
import { getOrder } from "../sdk/orders.ts";

const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle((input, init) => {
    const request = new Request(input, init);
    expect(request.method).toBe("GET");
    if (new URL(request.url).pathname === "/orders/7") {
      return Promise.resolve(Response.json({ id: 7, status: "paid" }));
    }
    return Promise.resolve(
      Response.json({ message: "Order not found" }, { status: 404 }),
    );
  }),
);

test("getOrder decodes the successful response", async () => {
  const [error, order, response] = await getOrder(client, { id: 7 });
  expect(error).toBeNull();
  if (error) throw error;
  expect(order).toEqual({ id: 7, status: "paid" });
  expect(response.status).toBe(200);
});

test("getOrder decodes the declared error response", async () => {
  const [error, order, response] = await getOrder(client, { id: 8 });
  expect(order).toBeUndefined();
  expect(response).toBeUndefined();
  expect(error?.code).toBe("HTTP_STATUS");
  if (error?.code !== "HTTP_STATUS") throw new Error("Expected HTTP_STATUS");
  expect(error.status).toBe(404);
  expect(error.data).toEqual({ message: "Order not found" });
  expect(error.response.status).toBe(404);
});
```

</Tab>
</Tabs>

## 2. Testing best practices [#2-testing-best-practices]

### Assert the error-first tuple, not internals [#assert-the-error-first-tuple-not-internals]

Always call the exported SDK operation with your test client and assert the returned `[error, data, response]` tuple:

- For `2xx` cases, assert `expect(error).toBeNull()` and check the decoded `data` fields (including `.alias()` wire-to-logical mapping).
- For failure cases, assert `error?.code`, `error?.status`, `error?.data`, and `error?.cause` when part of the contract.

### Verify wire bytes on outbound requests [#verify-wire-bytes-on-outbound-requests]

Inside your `withHTTPHandle(async (input, init) => ...)` function, construct `const request = new Request(input, init)` and inspect `request.url`, `request.method`, `request.headers`, and `await request.text()` (or `await request.json()`) to verify that your `builder` and struct aliases serialized the exact wire format your backend expects.

### Control time deterministically with fake timers [#control-time-deterministically-with-fake-timers]

For interceptor retry backoff, SSE/WebSocket reconnect delays, or WebSocket heartbeats, use `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })` in Vitest. These fake timers do not advance the native `AbortSignal.timeout` clock. For a deterministic request deadline in Vitest, abort an `AbortController` from a controlled `setTimeout` with a `TimeoutError` reason:

```typescript
import { expect, test, vi } from "vitest";
import {
  createClient,
  defineRequest,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

const getStatus = defineRequest({ method: "GET", path: "/status" });

test("request deadline follows the controlled timer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("request deadline", "TimeoutError"));
  }, 100);
  try {
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client = createClient(
      withEndpoint("https://fixture.invalid"),
      withHTTPHandle(() => {
        started?.();
        return new Promise<Response>(() => {});
      }),
    );
    const pending = getStatus(client({ signal: controller.signal }));
    await ready;
    await vi.advanceTimersByTimeAsync(100);
    const [error] = await pending;
    expect(error?.code).toBe("NET_TIMEOUT");
  } finally {
    clearTimeout(timer);
    controller.abort();
    vi.useRealTimers();
  }
});
```

In Bun test, use `jest.useFakeTimers()` and `jest.advanceTimersByTime()`; Bun's fake timers also control `AbortSignal.timeout`. Do not assume the runners control the same native clocks. Advance timers only after the awaited phase has started, assert state transitions or attempt counts rather than elapsed wall-clock time, and restore real timers after each test.

## Related reading [#related-reading]

- [Test with a local Fetch handle](/recipes/test-with-handle)
- [Build and publish an SDK](/recipes/publish-http-sdk)
- [Client configuration](/docs/client)
