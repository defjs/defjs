---
title: "Tests"
description: "Teste den Definitionsvertrag mit injizierten Transporten, echten Tupeln und kontrollierter Zeit."
---

## Den Transport injizieren [#inject]

Nutze `withHTTPHandle`, `withSSEHandle` oder `withWebSocketHandle`, um den Plattform-Transport zu ersetzen. Die Operation baut weiterhin den Request, führt Interceptors aus und dekodiert die Response, sodass der Test die echte Vertragsgrenze ausübt.

```ts
const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
const [error, order] = await getOrder(client, { id: 7 });
expect(error).toBeNull();
expect(order?.status).toBe("paid");
```

## Das Tupel prüfen, nicht Interna [#tuple]

Prüfe den Fault-Code und den dekodierten Wert. Ein Test, der einen privaten Helper-Aufruf oder ein Implementierungsdetail des Transports prüft, bricht, wenn sich die Implementierung ändert, ohne dass sich der Vertrag ändert. Prüfe bei einem Fault `code`, die relevanten Felder und die Identität von `cause`, wenn die Cause Teil des Vertrags ist.

## Vertrags-Fixtures real halten [#fixtures]

Führe pro Transport einen Integrationstest gegen einen echten Server aus, wenn die Änderung Request-Bau, Dekodierung oder Stream-Abbau betrifft. Nutze die bereits im Repository vorhandenen Fixture-Server statt eines zweiten Mock-Protokolls. Ein reines Browser-Verhalten gehört in ein Browser-Projekt; ein reines Server-Verhalten gehört in das Server-Projekt.

## Zeit explizit kontrollieren [#time]

Nutze Fake-Timer für Timeouts, Backoff, Reconnect-Delay und Heartbeat. Schalte die Zeit vor, nachdem das getestete Event passiert ist, und prüfe den Codepfad, der hätte laufen sollen. Prüfe nie die verstrichene Wandzeit. Warte bei einem echten Socket auf ein konkretes Event wie `open`, `closed` oder den ersten Frame.

## Das SDK als Consumer testen [#consumer]

Ein SDK-Test sollte die Definitionen importieren, die die Anwendung importiert, einen Client mit dem Test-Transport erzeugen und die Operation aufrufen. Er sollte den Request nicht von Hand nachbauen; das testet den Test, nicht das SDK.
