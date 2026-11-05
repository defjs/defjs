---
title: "Overview"
description: "The contracts and boundaries that keep an SDK predictable across SDK authors, applications, and runtimes."
---

These practices are not required for Defjs to work. They keep an SDK predictable when several people own the definition, the application, and the transport. Each page starts from a rule, shows a preferred and an avoided shape, and explains the boundary behind it.

## Keep definition and execution separate [#definition-execution]

A definition is data. It declares the method, path, input, output, and error contract. It does not create a client, read credentials, or start I/O. The application creates the client and calls the operation. Calling the operation is what performs the request.

This split lets an SDK package ship with no endpoint and no credentials, and lets one definition run with different endpoints in a browser, a server, or a test.

## Declare input, place it explicitly [#input-builder]

`input` describes the values the caller provides. `builder` decides where each value goes: path, query, headers, or body. Placement is never inferred from a field name or from the path template.

`builder` is a synchronous pure function. It runs at execution time. A throw becomes `REQ_BUILD_FAILED`.

## Read the error slot first [#error-first]

Every operation returns an error-first tuple. The first element is a fault or `null`. Request, response, and transport failures do not throw at the call site.

Read the fault before using the success value. Narrow by `code`, then read the fields that belong to that fault.

## The application owns the client [#client-ownership]

The application owns the endpoint, credentials, interceptors, transports, and the lifetime of streams and sessions. The SDK owns the contract. Plugins may pass an application client through a framework tree; they do not create or cache one.

## Pages in this section [#pages]

- [SDK design](/docs/best-practices/sdk-design) — definitions, Structs, naming, and publishing.
- [Application integration](/docs/best-practices/application) — client creation, configuration, interceptors, and framework plugins.
- [Error handling](/docs/best-practices/errors) — fault codes, narrowing, logging, and retries.
- [Streaming and realtime](/docs/best-practices/streaming) — SSE, WebSocket, ownership, and backpressure.
- [Testing](/docs/best-practices/testing) — injected transports, contract tests, and timers.
- [Security](/docs/best-practices/security) — credentials, XSRF, URL validation, and redaction.
- [Performance](/docs/best-practices/performance) — streaming, queues, failover, and measurement.
