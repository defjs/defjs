---
title: "WebSocket"
description: "Sé dueño de la sesión, lee la cola de recepción, acota ambas colas y gestiona los errores de runtime y las reconexiones."
---

## Sé dueño de la sesión [#ownership]

Una sesión WebSocket pertenece a quien llama y la abrió. Ciérrala cuando termine el trabajo y usa `await using` cuando el ámbito que la rodea sea su dueño, para que la sesión se disponga en cada ruta de salida.

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## Lee hasta que la sesión se cierre [#read-to-end]

Lee `session.receive` hasta que la sesión se cierre o quien llama se detenga. No des por hecho que el primer mensaje es el último. Registra `onRuntimeError` cuando la aplicación deba observar un fallo de transporte que ocurra después de que la sesión se abriera.

## Acota ambas colas [#bounds]

Ajusta `maxIncomingQueueSize` para los mensajes que esperan al consumidor y `maxOutgoingQueueSize` para los mensajes en cola durante una reconexión. Un límite convierte a un consumidor lento o una reconexión larga en un fault en lugar de un crecimiento ilimitado de memoria. Prueba la ruta de desbordamiento con los mismos límites que usa producción.

## Decide la reconexión y el heartbeat de forma deliberada [#reconnect]

La reconexión y el heartbeat son opciones del cliente. Una reconexión crea un nuevo intento de conexión; los mensajes salientes en cola siguen la política de cola. Un heartbeat que no recibe acuse es un fallo que la aplicación debe clasificar, no un motivo para seguir enviando indefinidamente.

## Cierra, no dejes fugas [#close]

`close()` inicia el teardown; `closed` informa el estado terminal. Un send cuando la sesión ya no admite escritura lanza una excepción; comprueba el estado o gestiona el throw. Espera a `closed` cuando el siguiente paso dependa de que el transporte se haya liberado.
