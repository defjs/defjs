---
title: "SSE"
description: "Besitze das Event-Stream-Handle, lies bis zum Ende, begrenze den Buffer und entscheide die Reconnect-Policy explizit."
---

## Das Handle besitzen [#ownership]

Ein Event-Stream gehört dem Aufrufer, der ihn geöffnet hat. Schließe ihn, wenn die Arbeit erledigt ist, und nutze `await using`, wenn der umgebende Scope ihn besitzt, damit das Handle auf jedem Exit-Pfad freigegeben wird.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## Bis zum Ende oder zum EOF lesen [#read-to-end]

Ein Event ist keine vollständige Response. Lies weiter, bis der Stream endet, der Aufrufer abbricht oder eine Reconnect-Policy übernimmt. Behandle einen Lesefehler als Transportfehler, nicht als sauberes Ende.

## Buffer und Queue begrenzen [#bounds]

Setze `maxBufferSize` und `maxQueueSize` anhand der Message-Größe und der Geschwindigkeit des Consumers. Ein Limit macht aus einem langsamen Consumer einen Fault statt unbegrenztem Speicherwachstum. Teste den Overflow-Pfad mit denselben Limits, die die Produktion nutzt.

## Reconnect-Policy explizit entscheiden [#reconnect]

SSE-Reconnect ist aus, bis die Anwendung ihn einschaltet. Eine nicht idempotente Methode wie POST wird nicht erneut gesendet, es sei denn, die Policy erlaubt es. Ein fehlgeschlagener Versuch kann auf dem Server bereits Arbeit gestartet haben; lies die Reconnect-Regeln in [SSE-Ereignisströme](/de-DE/docs/sse), bevor du eine Policy einschaltest.

## Schließen, nicht leaken [#close]

`close()` startet den Abbau; `closed` meldet den terminalen Zustand. Warte auf `closed`, wenn der nächste Schritt davon abhängt, dass der Transport freigegeben ist. Ein Abbruch beendet lokale Arbeit; er ist kein Beweis, dass der Service bereits angenommene Arbeit gestoppt hat.
