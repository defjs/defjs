---
title: "Middleware"
description: "Compón los interceptores como políticas pequeñas y ordenadas que permanecen en el límite de la aplicación."
---

## Una responsabilidad por interceptor [#one-concern]

Da a cada interceptor una sola tarea: adjuntar la autenticación, añadir una cabecera de tracing, registrar el tiempo o cortocircuitar un caso aprobado. Un middleware que autentica, reescribe el cuerpo, reintenta y registra es difícil de probar y de razonar.

Prefiere:

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

Evita un único interceptor que cambie varias partes no relacionadas de la solicitud.

## El orden es política [#order]

Los interceptores se ejecutan en el orden de registro. El primer interceptor registrado es el más externo: ve la solicitud primero y la respuesta al final. Pon en la capa más externa la política que debe envolver todo el intento; pon en la capa más interna la política que debe quedar más cerca del transporte.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(trace, auth),
);
```

`trace` envuelve a `auth`; `auth` se ejecuta antes del transporte.

## Cortocircuita a propósito [#short-circuit]

Un interceptor puede devolver una respuesta con `makeResponse` sin llamar a `next`. Úsalo para una caché aprobada, una respuesta de mantenimiento o una prueba local. La respuesta debe seguir satisfaciendo el output declarado de la operación; no conviertas un fallo en un éxito.

## No reescribas el contrato [#contract]

El middleware puede ajustar cabeceras, el contexto de tracing o la URL de la solicitud dentro de las reglas de validación de la librería. No debe cambiar el significado del input o del output declarados. La autenticación y el tracing pertenecen aquí, no a `builder`.

## Mantenlo sin estado [#stateless]

No guardes datos por solicitud en un cliente compartido ni en un módulo. Pasa un valor a través de la solicitud, la configuración del cliente o un closure creado para ese cliente. Un middleware que muta estado compartido filtra datos entre llamadas concurrentes.

## Gestiona los fallos en el límite [#failures]

Un throw del middleware es un fallo; devuelve una respuesta solo cuando el middleware haya gestionado la solicitud de forma intencionada. No captures un fault solo para registrarlo y continuar con `undefined`. Usa el hook de telemetría o el interceptor de la aplicación para el registro, y mantén la definición libre de ambos.
