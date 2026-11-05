---
title: "Gestión de errores"
description: "Lee los faults en el lugar de la llamada, estrecha por código y mantén el logging y los reintentos fuera de la definición."
---

## Lee el fault antes que el valor [#fault-first]

Cada operación devuelve `[error, data, response]`. El valor de éxito solo tiene sentido cuando el primer elemento es `null`.

Prefiere:

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

Evita:

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // order is undefined when the call failed
```

## Estrecha por código y después por datos [#narrow]

`fault.code` selecciona la clase de fallo. Lee `status` para `HTTP_STATUS`, `data` para un cuerpo de error decodificado y `response` para metadatos. `cause` conserva el fallo subyacente del parser o del transporte; no lo sustituyas por un mensaje genérico.

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

Los códigos `RES_*` significan que la respuesta no se pudo leer como se declaró. Los códigos `NET_*` significan que la solicitud no produjo una respuesta usable. No reintentes un fallo de decodificación o de contrato como si fuera un fallo de red.

## Registra una vez, en el límite que posee el resultado [#logging]

Registra en la capa que decide lo que pasa después: el handler de la solicitud, el runner del job o el límite de la UI. Usa el plugin de OpenTelemetry o un interceptor para la telemetría; la definición se queda libre de logging. Redacta las URLs, las query strings, los headers y los cuerpos antes de que lleguen a un log.

## Reintenta solo lo que es seguro repetir [#retry]

Defjs no reintenta HTTP por su cuenta. Un reintento pertenece a la aplicación o a una política explícita de failover de endpoints. Reintenta un método seguro o una operación que el servicio documente como idempotente. Un POST que puede haber iniciado trabajo facturable no es seguro de repetir sin un contrato de replay.

## No te tragues los errores [#no-swallow]

Devolver éxito después de un error oculta un contrato roto. Mapea el fault a un resultado de la aplicación, relanza un error de programación o termina la operación con un fallo tipado. No captures un fault solo para registrarlo y continuar con un valor `undefined`.
