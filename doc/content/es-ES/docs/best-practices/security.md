---
title: "Seguridad"
description: "Mantén las credenciales en el límite de la aplicación, valida las URLs, habilita XSRF cuando haga falta y redacta la telemetría."
---

## Mantén los secretos fuera del SDK y del navegador [#secrets]

Una definición del SDK no contiene endpoint, token ni credencial. La aplicación coloca las credenciales en un cliente que se ejecuta donde se permite usarlas: un proceso de servidor, un worker o una prueba de confianza. No pongas el secreto de un proveedor en un bundle de navegador, en una variable de build pública ni en un cliente enviado al navegador.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(serverAuth),
);
```

## Usa un interceptor para la autenticación [#auth]

Adjunta un token en un interceptor que se ejecute en el límite de la aplicación. `builder` debe seguir siendo una función pura de colocación; no puede leer un almacén de tokens ni mutar un header que use otra llamada.

## Configura XSRF en el cliente [#xsrf]

Cuando el servicio usa un token de cookie a header, configura `withXsrf` en el cliente de la aplicación. `withCredentials` solo selecciona el modo de cookies de Fetch; no crea ni verifica un token. El servidor debe seguir emitiendo y validando el token.

## Valida lo que controla la aplicación [#urls]

Defjs rechaza los paths de solicitud ilegales, los escapes de directorio, las barras invertidas, `?`, `#` y los caracteres de control antes de que se ejecute un transporte. No sabe qué hosts confía tu aplicación. Mantén explícita la lista de endpoints, valida los valores que aporta el usuario antes de que lleguen a `builder` y no construyas una URL base a partir de input no confiable.

## Redacta antes de registrar o trazar [#redaction]

Las URLs, las query strings, los headers y los cuerpos pueden contener secretos o datos personales. El plugin de OpenTelemetry no captura cuerpos ni headers completos por defecto; manténlo así. Redacta en `startSpanHook` o en el exporter de la aplicación, y no copies valores de solicitud en bruto en telemetría personalizada.

## Trata el abort como local [#abort]

La cancelación detiene el trabajo local. No prueba que un servicio detuviera el trabajo que ya aceptó ni revierte un efecto del lado del servidor. Para una operación no idempotente, empareja el abort con el contrato de cancelación del propio servicio.
