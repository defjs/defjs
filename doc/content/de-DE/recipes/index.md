---
title: "Praxisbeispiele"
description: Ein wiederverwendbares SDK bauen und veröffentlichen, dann Authentifizierung, Aufrufe und Echtzeit in konsumierenden Anwendungen konfigurieren.
---

Starte mit [SDK entwickeln und veröffentlichen](/de-DE/recipes/publish-http-sdk) für den vollständigen Weg von der exportierten Definition zum npm-Paket und zur konsumierenden Anwendung. Jedes der folgenden Rezepte stellt einzelne Operationsverträge und Anwendungsregeln vor – mit Multi-File-Code-Tabs, die demonstrieren, wie SDK-Definition und Anwendungsausführung nahtlos zusammenpassen.

## HTTP

- [JSON senden](/de-DE/recipes/post-json) — Logische camelCase-Felder auf snake_case-Schlüssel der Wire-Ebene abbilden und eine typisierte 201-Antwort dekodieren.
- [Deklarierte 404 behandeln](/de-DE/recipes/get-declared-404) — Zwischen einer typisierten 200-Ausgabe und einem deklarierten 404-`HTTP_STATUS`-Fehler-Body verzweigen.
- [Abbruch und Zeitlimits](/de-DE/recipes/cancel-http) — Einen aufruferseitigen `AbortController` mit `AbortSignal.timeout(...)` kombinieren und `NET_ABORTED` von `NET_TIMEOUT` unterscheiden.
- [ETag-Bedingungsanfragen](/de-DE/recipes/etag-revalidate) — `If-None-Match` senden, `304 Not Modified` als `HTTP_STATUS`-Fehler behandeln und die Cache-`Map` im Anwendungscode verwalten.
- [GraphQL-Anfragen](/de-DE/recipes/graphql-http-envelope) — Eine GraphQL-Abfrage über HTTP `POST` senden und `errors[]` gegenüber `.nullish()` `data` in einem Anwendungs-Helper auflösen.

## Authentifizierung

- [Token nach 401 erneuern](/de-DE/recipes/refresh-bearer-once) — Einen `Bearer`-Token anhängen, parallele Refresh-Aufrufe deduplizieren und innerhalb eines einzigen HTTP-Interceptors genau einmal wiederholen.

## Echtzeit

- [SSE-Ereignisse verarbeiten](/de-DE/recipes/consume-sse) — Einen typisierten Server-Sent-Events-Stream öffnen, einmalig iterieren und `stream.close()` + `await stream.closed` zuverlässig im `finally`-Block sicherstellen.
- [WebSocket-Sitzungen verwalten](/de-DE/recipes/websocket-session) — Typisierte eingehende und ausgehende JSON-Frames austauschen, `onRuntimeError` abonnieren und sauber schließen.

## SDK-Tests und Veröffentlichung [#testing-and-packaging]

- [Lokale HTTP-Tests](/de-DE/recipes/test-with-handle) — URL-Erstellung, Interceptors und Struct-Dekodierung mit `withHTTPHandle(...)` vollständig im Speicher testen.
- [SDK entwickeln und veröffentlichen](/de-DE/recipes/publish-http-sdk) — Ein SDK ohne gebundenen Client mit `tsdown` paketieren, veröffentlichen und in einer Anwendung konsumieren.
