---
title: "SSE"
description: "Sé dueño del handle del event-stream, lee hasta el final, acota el búfer y decide la política de reconexión de forma explícita."
---

## Sé dueño del handle [#ownership]

Un event-stream pertenece a quien llama y lo abrió. Ciérralo cuando termine el trabajo y usa `await using` cuando el ámbito que lo rodea sea su dueño, para que el handle se disponga en cada ruta de salida.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## Lee hasta el final o el EOF [#read-to-end]

Un evento no es una respuesta completa. Sigue leyendo hasta que el stream termine, quien llama aborte o una política de reconexión tome el control. Trata un fallo de lectura como un fallo de transporte, no como un final limpio.

## Acota el búfer y la cola [#bounds]

Ajusta `maxBufferSize` y `maxQueueSize` a partir del tamaño de los mensajes y la velocidad del consumidor. Un límite convierte a un consumidor lento en un fault en lugar de un crecimiento ilimitado de memoria. Prueba la ruta de desbordamiento con los mismos límites que usa producción.

## Decide la política de reconexión de forma explícita [#reconnect]

La reconexión de SSE está desactivada hasta que la aplicación la habilite. Un método no idempotente como POST no se reintenta a menos que la política lo permita. Un intento fallido puede haber iniciado ya trabajo en el servidor; lee las reglas de reconexión en [Flujos de eventos SSE](/es-ES/docs/sse) antes de habilitar una política.

## Cierra, no dejes fugas [#close]

`close()` inicia el teardown; `closed` informa el estado terminal. Espera a `closed` cuando el siguiente paso dependa de que el transporte se haya liberado. Un abort termina el trabajo local; no es prueba de que el servicio haya detenido el trabajo que ya aceptó.
