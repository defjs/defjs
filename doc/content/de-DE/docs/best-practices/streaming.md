---
title: "Streaming und Echtzeit"
description: "Besitze das Stream-Handle, begrenze die Queues und entscheide Reconnect- und Replay-Policy in der Anwendung."
---

## Das Handle besitzen [#ownership]

Ein Event-Stream oder eine WebSocket-Session gehört dem Aufrufer, der ihn geöffnet hat. Schließe ihn, wenn die Arbeit erledigt ist, und nutze `await using`, wenn der umgebende Scope ihn besitzt, damit das Handle auf jedem Exit-Pfad freigegeben wird.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## Bis zum Abschluss oder EOF lesen [#read-to-end]

Ein Event ist keine vollständige Response. Lies bei SSE weiter, bis der Stream endet, der Aufrufer abbricht oder eine Reconnect-Policy übernimmt. Lies bei WebSocket die Receive-Queue, bis die Session schließt oder der Aufrufer aufhört.

## Buffer und Queues begrenzen [#bounds]

Setze `maxIncomingQueueSize` für WebSocket-Sessions und `maxBufferSize` / `maxQueueSize` für SSE. Eine Grenze macht aus einem langsamen Consumer einen Fault statt unbegrenztem Speicherwachstum. Wähle die Grenze anhand der Message-Größe und der Geschwindigkeit des Consumers und teste dann den Overflow-Pfad.

## Reconnect und Replay explizit entscheiden [#reconnect]

SSE-Reconnect ist aus, bis die Anwendung ihn einschaltet. Ein POST oder eine andere nicht idempotente Methode wird nicht erneut gesendet, es sei denn, die Policy erlaubt es. Ein fehlgeschlagener Streaming-Versuch kann auf dem Server bereits Arbeit gestartet haben; lies die Reconnect-Regeln in [SSE-Ereignisströmen](/de-DE/docs/sse) und die Replay-Regeln in [HTTP-Anfragen](/de-DE/docs/http), bevor du eine Policy einschaltest.

## Schließen, nicht leaken [#close]

`close()` startet den Abbau; `closed` meldet den terminalen Zustand. Warte auf `closed`, wenn der nächste Schritt davon abhängt, dass der Transport freigegeben ist. Ein Abbruch beendet lokale Arbeit; er beweist nicht, dass der Service bereits angenommene Arbeit gestoppt hat.
