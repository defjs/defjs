---
title: Interceptores
description: Constructores de interceptor HTTP, SSE y WebSocket.
---

# Interceptores

Envuelve `next` para un transporte. Regístralos con `withInterceptors`. Las listas mixtas se filtran por tipo cuando se ejecuta la operación.

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

## Tipos etiquetados

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## Basic auth

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Pone `Authorization: Basic <encoded>` en cada solicitud. `fn` devuelve `{ username, password }` y se llama por solicitud. El segundo argumento opcional `{ encode }` recibe esa credencial y devuelve la parte que va después de `Basic `; el valor por defecto codifica ``btoa(`${username}:${password}`)``. Sin `encode`, crear el interceptor lanza cuando `btoa` no está disponible.

Consulta la [guía de Interceptores](/es-ES/docs/interceptors).
