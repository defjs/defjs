---
title: "Pruebas"
description: "Prueba el contrato de la definición con transportes inyectados, tuplas reales y tiempo controlado."
---

## Inyecta el transporte [#inject]

Usa `withHTTPHandle`, `withSSEHandle` o `withWebSocketHandle` para sustituir el transporte de la plataforma. La operación sigue construyendo la solicitud, ejecutando los interceptores y decodificando la respuesta, así que la prueba ejercita el límite real del contrato.

```ts
const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
const [error, order] = await getOrder(client, { id: 7 });
expect(error).toBeNull();
expect(order?.status).toBe("paid");
```

## Comprueba la tupla, no los detalles internos [#tuple]

Comprueba el código del fault y el valor decodificado. Una prueba que comprueba la llamada a un helper privado o un detalle de implementación del transporte se rompe cuando la implementación cambia sin que cambie el contrato. Para un fallo, comprueba `code`, los campos relevantes y la identidad de `cause` cuando la causa forma parte del contrato.

## Mantén reales los fixtures del contrato [#fixtures]

Ejecuta una prueba de integración contra un servidor real para cada transporte cuando el cambio toque la construcción de solicitudes, la decodificación o el teardown del stream. Usa los servidores de fixture que ya existen en el repositorio en lugar de un segundo protocolo simulado. Un comportamiento exclusivo del navegador pertenece a un proyecto de navegador; un comportamiento exclusivo del servidor pertenece al proyecto de servidor.

## Controla el tiempo de forma explícita [#time]

Usa temporizadores falsos para timeouts, backoff, retraso de reconexión y heartbeat. Avanza el tiempo después de que haya ocurrido el evento bajo prueba y comprueba la ruta de código que debería haberse ejecutado. Nunca compruebes el tiempo transcurrido real. Para un socket real, espera un evento concreto como `open`, `closed` o el primer frame.

## Prueba el SDK como consumidor [#consumer]

Una prueba del SDK debe importar las definiciones que importa la aplicación, crear un cliente con el transporte de prueba y llamar a la operación. No debe reconstruir la solicitud a mano; eso prueba la prueba, no el SDK.
