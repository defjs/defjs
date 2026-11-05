---
title: "Streaming y tiempo real"
description: "Posee el handle del stream, acota las colas y decide la política de reconexión y replay en la aplicación."
---

## Posee el handle [#ownership]

Un event stream o una sesión WebSocket pertenece a quien la abre. Ciérralo cuando termine el trabajo y usa `await using` cuando el ámbito que lo rodea es su dueño, para que el handle se libere en todas las rutas de salida.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## Lee hasta el final o el EOF [#read-to-end]

Un evento no es una respuesta completa. En SSE, sigue leyendo hasta que el stream termine, quien llama aborte o una política de reconexión tome el control. En WebSocket, lee la cola de recepción hasta que la sesión se cierre o quien llama se detenga.

## Acota los búferes y las colas [#bounds]

Define `maxIncomingQueueSize` en las sesiones WebSocket y `maxBufferSize` / `maxQueueSize` en SSE. Un límite convierte a un consumidor lento en un fault en lugar de un crecimiento de memoria sin límite. Elige el límite a partir del tamaño de los mensajes y de la velocidad del consumidor, y luego prueba la ruta de desbordamiento.

## Decide la reconexión y el replay de forma explícita [#reconnect]

La reconexión SSE está desactivada hasta que la aplicación la habilita. Un POST u otro método no idempotente no se repite salvo que la política lo permita. Un intento de streaming fallido puede haber iniciado trabajo en el servidor; lee las reglas de reconexión en [Flujos de eventos SSE](/es-ES/docs/sse) y las reglas de replay en [Solicitudes HTTP](/es-ES/docs/http) antes de habilitar una política.

## Cierra, no filtres [#close]

`close()` inicia el teardown; `closed` informa el estado terminal. Espera a `closed` cuando el paso siguiente dependa de que el transporte se libere. Un abort termina el trabajo local; no es prueba de que el servicio detuviera el trabajo que ya aceptó.
