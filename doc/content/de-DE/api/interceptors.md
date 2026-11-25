---
title: Interceptors
description: HTTP-, SSE- und WebSocket-Interceptor-Constructors.
---

# Interceptors

Umhülle `next` für einen Transport oder für einen ganzen Operationsaufruf. Registriere mit `withInterceptors`. Gemischte Listen werden nach Art gefiltert, wenn die Operation läuft.

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

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` führt den ganzen Aufruf aus: Input-Validierung, Endpunktauswahl, den Builder, jeden Versuch mit seinen Transport-Interceptors und Retries sowie das Dekodieren der Response. Es nimmt keine Argumente und führt den Aufruf nur einmal aus, egal wie oft es aufgerufen wird. Die Funktion ist im Ergebnis generisch und löst deshalb nur mit dem auf, womit `next()` aufgelöst hat. Operations-Interceptors laufen für jeden Transport, außerhalb der Transport-Interceptors. Ein Throw oder eine Ablehnung löst die Operation mit `EXT_INTERCEPTOR_FAILED` auf, und ein Stream oder eine Session, die der Aufruf schon geöffnet hatte, wird geschlossen.

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## Getaggte Typen

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## Basic Auth

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Setzt bei jedem Request `Authorization: Basic <encoded>`. `fn` gibt `{ username, password }` zurück und wird pro Request aufgerufen. Das optionale zweite Argument `{ encode }` erhält diese Credentials und liefert den Teil nach `Basic `; standardmäßig wird ``btoa(`${username}:${password}`)`` kodiert. Ohne `encode` schlägt das Erzeugen des Interceptors fehl, wenn `btoa` nicht verfügbar ist.

## Concurrency-Limit

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

Begrenzt gleichzeitige laufende HTTP-Versuche pro Bucket (`key`, Standard ist ein gemeinsamer Bucket). Requests über `maxConcurrency` warten in FIFO-Reihenfolge bis `maxQueue` (Standard `Infinity`) oder werden mit `BulkheadOverflowError` abgelehnt (als `EXT_INTERCEPTOR_FAILED` mit `{ attempted: false }` weitergereicht). Permits werden während `withRetry`-Backoff-Wartezeiten freigegeben, und bereits vorab oder in der Warteschlange abgebrochene Requests lösen mit `NET_ABORTED` oder `NET_TIMEOUT` auf. Siehe [Concurrency-Limits & gepoolte Aufrufe](/de-DE/recipes/concurrency-limit).

## Idempotenzschlüssel

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

Klont `req.headers` und setzt `headerName` (Standard `'Idempotency-Key'`) bei Requests, deren Methode zu `methods` (Standard `['POST', 'PATCH']`) passt; Requests, die den Header bereits tragen, werden übersprungen, wenn `respectExisting` `true` (Standard) ist. Ohne `generate` wird `req.correlationId` wiederverwendet (oder auf eine v4-UUID zurückgefallen), sodass jeder `withRetry`-Versuch eines Aufrufs denselben Schlüssel sendet; mit `generate` erfolgt Memoisierung nach `req.correlationId` in einem begrenzten Cache mit 4.096 Einträgen. Siehe [Idempotenzschlüssel](/de-DE/recipes/idempotency-key).

Siehe [Interceptors-Leitfaden](/de-DE/docs/interceptors).
