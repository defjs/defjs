---
title: "Rendimiento"
description: "Haz streaming de cuerpos grandes, acota las colas, elige el failover con criterio y mide antes de cambiar una política."
---

## Haz streaming de cuerpos grandes [#streaming]

Envía un `ReadableStream` para un cuerpo que no deba almacenarse en búfer y lee una respuesta grande como stream cuando el consumidor pueda procesar fragmentos. Un cuerpo JSON debe materializarse por completo antes de enviarse; una subida grande no tiene por qué.

`onUploadProgress` y `onDownloadProgress` observan los bytes que cruzan el límite de Fetch. No son una promesa de que el servidor haya aceptado o procesado el cuerpo. Úsalos para feedback al usuario, no para control de flujo.

## Acota lo que puede crecer [#bounds]

Define `maxIncomingQueueSize` en las sesiones WebSocket y `maxBufferSize` / `maxQueueSize` en SSE. Un límite forma parte de la política de contrapresión de la aplicación: decide si un consumidor lento falla rápido o aplica presión al productor. Prueba la ruta de desbordamiento con los mismos límites que usa producción.

## Elige el failover con criterio [#failover]

`withEndpointFailover` reintenta un intento fallido solo bajo la política que configures. Mantén pequeños el presupuesto de intentos y el de reintentos, y no uses el failover para repetir una solicitud no idempotente que el servicio no pueda repetir. Una comprobación de salud o una penalización deben reflejar el transporte que realmente usas.

## Mide antes de ajustar [#measure]

Mide la operación, el transporte y el consumidor por separado. Un timeout demasiado corto parece un fallo de red; una cola demasiado pequeña convierte una ráfaga en un fault. Usa los hooks de telemetría existentes y un fixture que reproduzca la carga antes de cambiar un búfer, un timeout o un número de reintentos.
