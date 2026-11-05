---
title: "Error handling"
description: "Read faults at the call site, narrow by code, and keep logging and retries outside the definition."
---

## Read the fault before the value [#fault-first]

Every operation returns `[error, data, response]`. The success value is only meaningful when the first element is `null`.

Prefer:

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

Avoid:

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // order is undefined when the call failed
```

## Narrow by code, then by data [#narrow]

`fault.code` selects the failure class. Read `status` for `HTTP_STATUS`, `data` for a decoded error body, and `response` for metadata. `cause` keeps the underlying parser or transport failure; do not replace it with a generic message.

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

`RES_*` codes mean the response could not be read as declared. `NET_*` codes mean the request did not produce a usable response. Do not retry a decode or contract failure as if it were a network failure.

## Log once, at the boundary that owns the outcome [#logging]

Log at the layer that decides what happens next: the request handler, the job runner, or the UI boundary. Use the OpenTelemetry plugin or an interceptor for telemetry; the definition stays free of logging. Redact URLs, query strings, headers, and bodies before they reach a log.

## Retry only what is safe to replay [#retry]

Defjs does not retry HTTP on its own. A retry belongs to the application or to an explicit endpoint-failover policy. Retry a safe method or an operation the service documents as idempotent. A POST that may have started billable work is not safe to repeat without a replay contract.

## Do not swallow [#no-swallow]

Returning success after an error hides a broken contract. Map the fault to an application result, rethrow a programming error, or end the operation with a typed failure. Do not catch a fault only to log it and continue with an undefined value.
