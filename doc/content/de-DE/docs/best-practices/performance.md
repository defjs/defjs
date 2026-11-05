---
title: "Leistung"
description: "Streame große Bodys, begrenze Queues, wähle Failover bewusst und miss, bevor du eine Policy änderst."
---

## Große Bodys streamen [#streaming]

Sende einen `ReadableStream` für einen Body, der nicht gepuffert werden soll, und lies eine große Response als Stream, wenn der Consumer Chunks verarbeiten kann. Ein JSON-Body muss vollständig materialisiert sein, bevor er gesendet wird; ein großer Upload muss das nicht.

`onUploadProgress` und `onDownloadProgress` beobachten die Bytes, die die Fetch-Grenze passieren. Sie sind kein Versprechen, dass der Server den Body angenommen oder verarbeitet hat. Nutze sie für Nutzerfeedback, nicht für Flusskontrolle.

## Begrenzen, was wachsen kann [#bounds]

Setze `maxIncomingQueueSize` für WebSocket-Sessions und `maxBufferSize` / `maxQueueSize` für SSE. Eine Grenze ist Teil der Backpressure-Policy der Anwendung: Sie entscheidet, ob ein langsamer Consumer schnell scheitert oder Druck auf den Producer ausübt. Teste den Overflow-Pfad mit denselben Limits, die die Produktion nutzt.

## Failover bewusst wählen [#failover]

`withEndpointFailover` wiederholt einen fehlgeschlagenen Versuch nur unter der Policy, die du konfigurierst. Halte das Attempt-Budget und das Retry-Budget klein, und nutze Failover nicht, um einen nicht idempotenten Request zu wiederholen, den der Service nicht erneut ausführen kann. Ein Health-Check oder eine Penalty sollte den Transport widerspiegeln, den du tatsächlich nutzt.

## Messen, bevor du abstimmst [#measure]

Miss die Operation, den Transport und den Consumer getrennt. Ein zu kurzer Timeout sieht wie ein Netzwerkfehler aus; eine zu kleine Queue macht aus einem Burst einen Fault. Nutze die vorhandenen Telemetrie-Hooks und eine Fixture, die die Last reproduziert, bevor du einen Buffer, einen Timeout oder eine Retry-Anzahl änderst.
