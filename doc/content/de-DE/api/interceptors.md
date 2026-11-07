---
title: Interceptors
description: HTTP-, SSE- und WebSocket-Interceptor-Constructors.
---

# Interceptors

Umhülle `next` für einen Transport. Registriere mit `withInterceptors`. Gemischte Listen werden nach Art gefiltert, wenn die Operation läuft.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Ruf `next(req)` auf (optional einen mutierten Request) oder verkürze den Ablauf mit `makeResponse`. `next` geht nur nach innen: zu den Interceptors, die nach diesem registriert wurden, dann zum Transport. Ein erneuter Aufruf spielt diesen inneren Teil ab diesem Interceptor noch einmal ab; äußere Interceptors laufen nicht doppelt.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` erweitert `AsyncDisposable`. Eine strukturelle Short-Circuit-Implementierung muss `[Symbol.asyncDispose](): PromiseLike<void>` liefern und diese an denselben Close-Lebenszyklus binden.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` ist die Session aus Interceptor-Sicht:

<ApiSignature name="WebSocketSessionLike" />

Ein Wrapper oder eine Short-Circuit-Session muss denselben `[Symbol.asyncDispose]()`-Teardown weiterleiten wie ihren `close`- / `closed`-Lebenszyklus; ein fremdes, bereits aufgelöstes Promise reicht nicht.

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

Setzt bei jedem Request `Authorization: Basic <encoded>`. `fn` gibt `{ username, password }` zurück und wird pro Request aufgerufen. Das optionale zweite Argument `{ encode }` erhält diese Credentials und liefert den Teil nach `Basic `; standardmäßig wird ``btoa(`${username}:${password}`)`` kodiert. Ohne `encode` schlägt das Erzeugen des Interceptors fehl, wenn `btoa` nicht verfügbar ist.

Siehe [Interceptors-Leitfaden](/de-DE/docs/interceptors).
