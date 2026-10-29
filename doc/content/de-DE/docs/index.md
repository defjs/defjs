---
title: "Leitfaden"
description: SDK-Endpoints entwerfen, Verträge definieren und mit einem eigenen Anwendungsclient testen, integrieren und veröffentlichen.
---

Defjs begleitet dich vom API-Vertrag bis zum veröffentlichten SDK. Lies zuerst den [Schnellstart](/de-DE/docs/start), dann [Commands](/de-DE/docs/commands) und [Client](/de-DE/docs/client): Das SDK exportiert Endpoints, die Anwendung konfiguriert deren Ausführung. [Struct](/de-DE/docs/struct) beschreibt die gemeinsamen Datenverträge; die [Entwurfsentscheidungen](/de-DE/docs/design-decisions) erklären die Grenzen.

Wenn der erste Endpoint funktioniert, folgen [lokale Tests](/de-DE/recipes/test-with-handle) und die [Veröffentlichung als npm-Paket](/de-DE/recipes/publish-http-sdk). Die Transport- und Plugin-Leitfäden vertiefen jeweils den Vertrag des SDKs und die Verantwortung der Anwendung.

## SDK-Entwicklung [#erste-schritte]

- [Projektübersicht](/de-DE)
- [Schnellstart](/de-DE/docs/start)

## Verträge und Ausführung [#aufrufe-und-verträge]

- [Datenverträge / Struct](/de-DE/docs/struct)
- [Definieren und ausführen / Command](/de-DE/docs/commands)
- [Client-Konfiguration / Client](/de-DE/docs/client)

## Anfragen und Echtzeit

- [HTTP-Anfragen](/de-DE/docs/http)
- [SSE-Ereignisströme](/de-DE/docs/sse)
- [WebSocket-Sitzungen](/de-DE/docs/web-socket)

## Fehler und Interceptors

- [Fehlerbehandlung](/de-DE/docs/errors)
- [Interceptors](/de-DE/docs/interceptors)

## Plugins

- [Plugins](/de-DE/docs/integrations)
- [React](/de-DE/docs/integrations/react)
- [Vue](/de-DE/docs/integrations/vue)
- [OpenTelemetry Server](/de-DE/docs/integrations/opentelemetry-server)

[Entwurfsentscheidungen](/de-DE/docs/design-decisions)
