---
title: "Testing"
description: "Test the definition contract with injected transports, real tuples, and controlled time."
---

## Inject the transport [#inject]

Use `withHTTPHandle`, `withSSEHandle`, or `withWebSocketHandle` to replace the platform transport. The operation still builds the request, runs interceptors, and decodes the response, so the test exercises the real contract boundary.

```ts
const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
const [error, order] = await getOrder(client, { id: 7 });
expect(error).toBeNull();
expect(order?.status).toBe("paid");
```

## Assert the tuple, not internals [#tuple]

Check the fault code and the decoded value. A test that asserts a private helper call or a transport implementation detail breaks when the implementation changes without the contract changing. For a fault, assert `code`, the relevant fields, and the `cause` identity when the cause is part of the contract.

## Keep contract fixtures real [#fixtures]

Run one integration test against a real server for each transport when the change touches request building, decoding, or stream teardown. Use the fixture servers already in the repository rather than a second mock protocol. A browser-only behavior belongs in a browser project; a server-only behavior belongs in the server project.

## Control time explicitly [#time]

Use fake timers for timeouts, backoff, reconnect delay, and heartbeat. Advance time after the event under test has happened, and assert the code path that should have run. Never assert on elapsed wall time. For a real socket, wait for a concrete event such as `open`, `closed`, or the first frame.

## Test the SDK as a consumer [#consumer]

An SDK test should import the definitions the application imports, create a client with the test transport, and call the operation. It should not recreate the request by hand; that tests the test, not the SDK.
