---
title: "WebSocket"
description: "Besitze die Session, lies die Receive-Queue, begrenze beide Queues und behandle Runtime-Fehler und Reconnects."
---

## Die Session besitzen [#ownership]

Eine WebSocket-Session gehört dem Aufrufer, der sie geöffnet hat. Schließe sie, wenn die Arbeit erledigt ist, und nutze `await using`, wenn der umgebende Scope sie besitzt, damit die Session auf jedem Exit-Pfad freigegeben wird.

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## Lesen, bis die Session schließt [#read-to-end]

Lies `session.receive`, bis die Session schließt oder der Aufrufer stoppt. Nimm nicht an, dass die erste Nachricht die letzte ist. Registriere `onRuntimeError`, wenn die Anwendung einen Transportfehler beobachten muss, der nach dem Öffnen der Session auftritt.

## Beide Queues begrenzen [#bounds]

Setze `maxIncomingQueueSize` für Nachrichten, die auf den Consumer warten, und `maxOutgoingQueueSize` für Nachrichten, die während eines Reconnects eingereiht werden. Ein Limit macht aus einem langsamen Consumer oder einem langen Reconnect einen Fault statt unbegrenztem Speicherwachstum. Teste den Overflow-Pfad mit denselben Limits, die die Produktion nutzt.

## Reconnect und Heartbeat bewusst gestalten [#reconnect]

Reconnect und Heartbeat sind Client-Options. Ein Reconnect erzeugt einen neuen Verbindungsversuch; eingereihte ausgehende Nachrichten folgen der Queue-Policy. Ein Heartbeat, der keine Bestätigung erhält, ist ein Fehler, den die Anwendung klassifizieren muss — kein Grund, ewig weiterzusenden.

## Schließen, nicht leaken [#close]

`close()` startet den Abbau; `closed` meldet den terminalen Zustand. Ein `send`, nachdem die Session nicht mehr beschreibbar ist, wirft; prüfe den Zustand oder behandle den Throw. Warte auf `closed`, wenn der nächste Schritt davon abhängt, dass der Transport freigegeben ist.
