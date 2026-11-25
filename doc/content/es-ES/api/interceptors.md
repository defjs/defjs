---
title: Interceptores
description: Constructores de interceptor HTTP, SSE y WebSocket.
---

# Interceptores

Envuelve `next` para un transporte, o para una llamada de operación completa. Regístralos con `withInterceptors`. Las listas mixtas se filtran por tipo cuando se ejecuta la operación.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Llama a `next(req)` (opcionalmente con una solicitud modificada) o cortocircuita con `makeResponse`. `next` solo avanza hacia dentro: a los interceptores registrados después de este y luego al transporte. Llamarlo otra vez reproduce esa parte interior desde este interceptor; los interceptores exteriores no se ejecutan dos veces.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` extiende `AsyncDisposable`. Una implementación estructural de cortocircuito debe aportar `[Symbol.asyncDispose](): PromiseLike<void>` y conectarlo al mismo ciclo de vida de cierre.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` es la sesión que ve el interceptor:

<ApiSignature name="WebSocketSessionLike" />

Un wrapper o una sesión de cortocircuito debe reenviar el mismo teardown de `[Symbol.asyncDispose]()` que su ciclo de vida `close` / `closed`; devolver una promesa resuelta ajena no basta.

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` ejecuta la llamada completa: validación de la entrada, elección del endpoint, `builder`, cada intento con sus interceptores de transporte y reintentos, y la decodificación de la respuesta. No recibe argumentos y ejecuta la llamada una sola vez, por muchas veces que se invoque. La función es genérica en el resultado, así que solo se resuelve con lo que devolvió `next()`. Los interceptores de operación se ejecutan para todos los transportes, por fuera de los interceptores de transporte. Un throw o un rechazo resuelve la operación con `EXT_INTERCEPTOR_FAILED`, y se cierra el stream o la sesión que la llamada ya hubiera abierto.

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## Tipos etiquetados

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## Basic auth

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Pone `Authorization: Basic <encoded>` en cada solicitud. `fn` devuelve `{ username, password }` y se llama por solicitud. El segundo argumento opcional `{ encode }` recibe esa credencial y devuelve la parte que va después de `Basic `; el valor por defecto codifica ``btoa(`${username}:${password}`)``. Sin `encode`, crear el interceptor lanza cuando `btoa` no está disponible.

## Límite de concurrencia

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

Limita los intentos HTTP en curso simultáneos por cubo (`key`, por defecto un único cubo compartido). Las solicitudes por encima de `maxConcurrency` esperan en orden FIFO hasta `maxQueue` (`Infinity` por defecto), o se rechazan con `BulkheadOverflowError` (expuesto como `EXT_INTERCEPTOR_FAILED` con `{ attempted: false }`). Los permisos se liberan durante las esperas de backoff de `withRetry`, y las solicitudes ya abortadas o abortadas en cola se resuelven con `NET_ABORTED` o `NET_TIMEOUT`. Consulta [Límites de concurrencia y llamadas agrupadas](/es-ES/recipes/concurrency-limit).

## Clave de idempotencia

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

Clona `req.headers` y establece `headerName` (`'Idempotency-Key'` por defecto) en las solicitudes cuyo método coincide con `methods` (`['POST', 'PATCH']` por defecto), omitiendo las solicitudes que ya llevan la cabecera cuando `respectExisting` es `true` (por defecto). Sin `generate`, reutiliza `req.correlationId` (o recurre a un UUID v4) para que cada intento `withRetry` de una misma llamada envíe la misma clave; con `generate`, memoiza por `req.correlationId` en una caché acotada de 4 096 entradas. Consulta [Claves de idempotencia](/es-ES/recipes/idempotency-key).

Consulta la [guía de Interceptores](/es-ES/docs/interceptors).
