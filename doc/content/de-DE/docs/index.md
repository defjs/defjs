---
title: "Leitfaden"
description: SDK-Verträge und Operationen entwerfen, sie veröffentlichen und die Ausführung in konsumierenden Anwendungen konfigurieren.
---

Defjs trennt die API, die ein Team veröffentlicht, vom Client, den eine Anwendung nutzt. Folge dem Pfad für SDK-Autoren, um Operationen zu definieren und zu paketieren; folge dem Anwendungspfad, um die Ausführung zu konfigurieren und Ergebnisse zu behandeln.

## Vorwort [#getting-started]

- [Projektübersicht](/de-DE)
- [Schnellstart](/de-DE/docs/start)
- [SDK entwickeln und veröffentlichen](/de-DE/recipes/publish-http-sdk)
- [Warum Definitionen und Ausführung getrennt sind](/de-DE/docs/design-decisions)

## Verträge und Ausführung [#calls-and-contracts]

SDK-Autoren besitzen Structs und Endpoint-Definitionen. Anwendungen stellen den Client bereit und rufen Operationen damit auf.

- [Datenverträge / Struct](/de-DE/docs/struct)
- [Client-Konfiguration / Client](/de-DE/docs/client)

## Anfragen und Echtzeit

- [HTTP-Anfragen](/de-DE/docs/http)
- [SSE-Ereignisströme](/de-DE/docs/sse)
- [WebSocket-Sitzungen](/de-DE/docs/web-socket)

## Fehler und Abfangen

- [Fehlerbehandlung](/de-DE/docs/errors)
- [Interceptors](/de-DE/docs/interceptors)

## Plugins

Optionale Pakete für den Client der konsumierenden Anwendung. SDK-Definitionen bleiben davon unabhängig.

- [Plugins](/de-DE/docs/integrations)
- [React](/de-DE/docs/integrations/react)
- [Vue](/de-DE/docs/integrations/vue)
- [OpenTelemetry Server](/de-DE/docs/integrations/opentelemetry-server)

## KI

- [KI-gestützte Entwicklung](/de-DE/docs/ai)
- [KI-APIs aufrufen](/de-DE/docs/ai-api)

[Entwurfsentscheidungen](/de-DE/docs/design-decisions)
