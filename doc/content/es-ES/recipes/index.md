---
title: "Ejemplos prácticos"
description: Crea y publica un SDK reutilizable, y luego configura autenticación, llamadas y trabajo en tiempo real en las aplicaciones consumidoras.
---

Comienza con [Crear y publicar un SDK](/es-ES/recipes/publish-http-sdk) para conocer el recorrido completo de extremo a extremo, desde la definición exportada del SDK hasta el paquete npm y su uso en la aplicación. Cada una de las recetas siguientes muestra un contrato de operación individual y la política de aplicación correspondiente, con pestañas de código multifichero que enseñan cómo encajan la definición del SDK y los módulos de ejecución de la aplicación.

## HTTP

- [Enviar JSON](/es-ES/recipes/post-json) — asigna campos lógicos en camelCase a claves `snake_case` de la red y decodifica una respuesta tipada `201`.
- [Manejar una 404 declarada](/es-ES/recipes/get-declared-404) — bifurca entre una salida tipada `200` y un cuerpo de error `HTTP_STATUS` declarado para `404`.
- [Cancelación y tiempos de espera](/es-ES/recipes/cancel-http) — combina un `AbortController` de quien llama con `AbortSignal.timeout(...)` y distingue `NET_ABORTED` de `NET_TIMEOUT`.
- [Solicitudes condicionales ETag](/es-ES/recipes/etag-revalidate) — envía `If-None-Match`, trata `304 Not Modified` como un fallo `HTTP_STATUS` y mantén el `Map` de caché en el código de la aplicación.
- [Solicitudes GraphQL](/es-ES/recipes/graphql-http-envelope) — envía una consulta GraphQL mediante HTTP `POST` y desempaqueta `errors[]` frente a datos `.nullish()` en un asistente de la aplicación.

## Autenticación

- [Renovar un token tras 401](/es-ES/recipes/refresh-bearer-once) — adjunta un token `Bearer`, desduplica renovaciones concurrentes y reintenta una sola vez dentro de un interceptor HTTP.

## Tiempo real

- [Consumir eventos SSE](/es-ES/recipes/consume-sse) — abre un flujo tipado de Server-Sent Events, itera una vez y garantiza `stream.close()` + `await stream.closed` en un bloque `finally`.
- [Gestionar sesiones WebSocket](/es-ES/recipes/websocket-session) — intercambia tramas JSON entrantes y salientes tipadas, suscríbete a `onRuntimeError` y cierra limpiamente.

## Pruebas y publicación de SDK [#testing-and-packaging]

- [Pruebas HTTP locales](/es-ES/recipes/test-with-handle) — prueba la construcción de URLs, interceptores y decodificación con Struct en memoria mediante `withHTTPHandle(...)`.
- [Crear y publicar un SDK](/es-ES/recipes/publish-http-sdk) — empaqueta y publica un SDK sin cliente con `tsdown` y consúmelo desde una aplicación.
