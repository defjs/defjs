---
title: Interceptores
description: Constructores de interceptor HTTP, SSE y WebSocket.
---

# Interceptores

Envuelve `next` para un transporte. Regístralos con `withInterceptors`. Las listas mixtas se filtran por kind en el momento de execute.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Llama a `next(req)` (opcionalmente una solicitud mutada) o cortocircuita con `makeResponse`. `next` solo avanza hacia dentro: hacia los interceptores registrados después de este y luego hacia el transporte. Llamarlo de nuevo repite esa parte interna desde este interceptor; los interceptores externos no se ejecutan dos veces.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` extiende `AsyncDisposable`. Una implementación estructural de cortocircuito debe proporcionar `[Symbol.asyncDispose](): PromiseLike<void>` y conectarlo al mismo ciclo de vida de close.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` es la sesión que ve el interceptor:

<ApiSignature name="WebSocketSessionLike" />

Un wrapper o una sesión de cortocircuito debe reenviar el mismo teardown de `[Symbol.asyncDispose]()` que su ciclo de vida `close` / `closed`; devolver una promise resuelta ajena no basta. Exigir este miembro es un cambio breaking en tiempo de compilación para implementaciones estructurales. El código que solo acepta sesiones devueltas por Defjs no tiene un requisito adicional de llamada en runtime.

## Tipos con tag

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## Auth básica

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Pone `Authorization: Basic <encoded>` en cada solicitud. `fn` devuelve `{ username, password }` y se llama por solicitud. El segundo argumento opcional `{ encode }` recibe esa credencial y devuelve la parte que va después de `Basic `; el valor por defecto codifica ``btoa(`${username}:${password}`)``. Sin `encode`, crear el interceptor lanza si `btoa` no está disponible.

Mira la [guía de Interceptores](/es-ES/docs/interceptors).
