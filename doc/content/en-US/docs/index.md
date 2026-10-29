---
title: "Guide"
description: Design SDK contracts and operations, publish them, and configure execution in consuming applications.
---

Defjs separates the API a team publishes from the client an application uses. Follow the SDK authoring path to define and package operations; follow the application path to configure execution and handle results.

## SDK development [#getting-started]

- [Project overview](/)
- [Quick start](/docs/start)
- [Build and publish an SDK](/recipes/publish-http-sdk)
- [Why definitions and execution are separate](/docs/design-decisions)

## Contracts and execution [#calls-and-contracts]

SDK authors own Structs and endpoint definitions. Applications supply the Client and call `execute`.

- [Data contracts / Struct](/docs/struct)
- [Define and execute / Command](/docs/commands)
- [Client configuration / Client](/docs/client)

## Requests and realtime

- [HTTP requests](/docs/http)
- [SSE event streams](/docs/sse)
- [WebSocket sessions](/docs/web-socket)

## Errors and interception

- [Error handling](/docs/errors)
- [Interceptors](/docs/interceptors)

## Plugins

Optional packages for the consuming application's client. SDK definitions stay independent of them.

- [Plugins](/docs/integrations)
- [React](/docs/integrations/react)
- [Vue](/docs/integrations/vue)
- [OpenTelemetry server](/docs/integrations/opentelemetry-server)

[Design decisions](/docs/design-decisions)
