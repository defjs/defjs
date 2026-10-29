---
title: Interceptors
description: HTTP-, SSE- und WebSocket-Interceptor-Constructors.
---

# Interceptors

Wrappe `next` für einen Transport. Registriere mit `withInterceptors`. Gemischte Listen werden zur Execute-Zeit nach kind gefiltert.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Ruf `next(req)` auf (optional ein mutierter Request) oder short-circuite mit `makeResponse`. `next` geht nur nach innen: zu den Interceptors, die nach diesem registriert wurden, dann zum Transport. Ein erneuter Aufruf spielt diesen inneren Teil ab diesem Interceptor noch einmal ab; äußere Interceptors laufen nicht doppelt.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` erweitert `AsyncDisposable`. Eine strukturelle Short-Circuit-Implementierung muss `[Symbol.asyncDispose](): PromiseLike<void>` liefern und ihn an denselben Close-Lifecycle hängen.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` ist die interceptor-seitige Session:

<ApiSignature name="WebSocketSessionLike" />

Ein Wrapper oder eine Short-Circuit-Session muss denselben `[Symbol.asyncDispose]()`-Teardown wie ihren `close`- / `closed`-Lifecycle weiterleiten; ein fremdes, bereits aufgelöstes Promise reicht nicht. Dieses Member zu verlangen ist eine Compile-Time-Breaking-Änderung für strukturelle Implementierungen. Code, der nur von Defjs zurückgegebene Sessions akzeptiert, hat keine zusätzliche Runtime-Aufrufpflicht.

## Getaggte Typen

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## Basic Auth

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Setzt bei jedem Request `Authorization: Basic <encoded>`. `fn` gibt `{ username, password }` zurück und wird pro Request aufgerufen. Das optionale zweite Argument `{ encode }` erhält dieses Credential und liefert den Teil nach `Basic `; der Default kodiert ``btoa(`${username}:${password}`)``. Ohne `encode` wirft das Erzeugen des Interceptors, wenn `btoa` nicht verfügbar ist.

Siehe [Interceptors-Guide](/de-DE/docs/interceptors).
