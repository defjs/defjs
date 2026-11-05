---
title: "Integración de la aplicación"
description: "Crea el cliente en el límite de la aplicación y mantén las credenciales, las políticas y el cableado del framework fuera del SDK."
---

## Crea el cliente una vez en el límite [#client-boundary]

Crea el cliente donde la aplicación lee su configuración: un punto de entrada de servidor, un módulo que posee el despliegue o la configuración de una prueba. Pasa ese cliente al código que llama a las operaciones.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

Evita un cliente a nivel de módulo dentro de un SDK, el cuerpo de un componente o un handler de solicitud. Un cliente creado por render o por solicitud pierde la configuración compartida y hace que las pruebas dependan de estado ambiental.

## Pon la política transversal en interceptores [#interceptors]

La autenticación, el tracing, los headers por defecto y una política de reintentos revisada pertenecen a un interceptor. `builder` coloca el input actual; no sabe de credenciales ni de la telemetría de la aplicación.

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## Usa las opciones de cliente para una sola llamada [#per-call]

`client(options)` devuelve un valor de cliente para una llamada. El valor no es invocable. Úsalo para un signal, callbacks de progreso o un hook de WebSocket que solo aplique a esa llamada; conserva el cliente base para todo lo demás.

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## Deja que los plugins de framework pasen el cliente [#plugins]

`@defjs/react` y `@defjs/vue` pasan un cliente de la aplicación a través del árbol del framework. No lo crean, cachean, reintentan ni disponen. Aporta el cliente que la aplicación ya posee e inyecta el mismo valor donde se necesite.

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## Mantén el endpoint fuera del SDK [#endpoint]

La misma definición puede ejecutarse contra producción, staging, un fixture local o un transporte de prueba. Selecciona el endpoint en la aplicación; no codifiques un host de despliegue en el paquete del SDK.
