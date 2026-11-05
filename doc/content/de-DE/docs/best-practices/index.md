---
title: "Übersicht"
description: "Die Verträge und Grenzen, die ein SDK für SDK-Autoren, Anwendungen und Runtimes vorhersehbar halten."
---

Diese Praktiken sind für das Funktionieren von Defjs nicht erforderlich. Sie halten ein SDK vorhersehbar, wenn mehrere Personen die Definition, die Anwendung und den Transport verantworten. Jede Seite beginnt mit einer Regel, zeigt eine bevorzugte und eine zu vermeidende Form und erklärt die Grenze dahinter.

## Definition und Ausführung getrennt halten [#definition-execution]

Eine Definition ist Daten. Sie deklariert Methode, Pfad, Input, Output und Fehlervertrag. Sie erzeugt keinen Client, liest keine Zugangsdaten und startet kein I/O. Die Anwendung erzeugt den Client und ruft die Operation auf. Der Aufruf der Operation ist das, was den Request ausführt.

Diese Trennung erlaubt es, ein SDK-Paket ohne Endpoint und ohne Zugangsdaten auszuliefern, und lässt dieselbe Definition mit unterschiedlichen Endpoints in einem Browser, einem Server oder einem Test laufen.

## Input deklarieren, explizit platzieren [#input-builder]

`input` beschreibt die Werte, die der Aufrufer liefert. `builder` entscheidet, wohin jeder Wert geht: Pfad, Query, Header oder Body. Die Platzierung wird nie aus einem Feldnamen oder aus dem Pfad-Template abgeleitet.

`builder` ist eine synchrone reine Funktion. Sie läuft zur Ausführungszeit. Ein Wurf wird zu `REQ_BUILD_FAILED`.

## Zuerst den Fehler-Slot lesen [#error-first]

Jede Operation gibt ein Error-first-Tupel zurück. Das erste Element ist ein Fault oder `null`. Request-, Response- und Transport-Failures werfen nicht an der Aufrufstelle.

Lies den Fault, bevor du den Erfolgswert verwendest. Enge nach `code` ein und lies dann die Felder, die zu diesem Fault gehören.

## Die Anwendung besitzt den Client [#client-ownership]

Die Anwendung besitzt Endpoint, Zugangsdaten, Interceptors, Transporte und die Lebensdauer von Streams und Sessions. Das SDK besitzt den Vertrag. Plugins dürfen einen Anwendungs-Client durch einen Framework-Baum reichen; sie erzeugen keinen und cachen keinen.

## Seiten in diesem Abschnitt [#pages]

- [SDK-Design](/de-DE/docs/best-practices/sdk-design) — Definitionen, Structs, Benennung und Veröffentlichung.
- [Anwendungsintegration](/de-DE/docs/best-practices/application) — Client-Erzeugung, Konfiguration, Interceptors und Framework-Plugins.
- [Fehlerbehandlung](/de-DE/docs/best-practices/errors) — Fault-Codes, Einengen, Logging und Retries.
- [Streaming und Echtzeit](/de-DE/docs/best-practices/streaming) — SSE, WebSocket, Ownership und Backpressure.
- [Tests](/de-DE/docs/best-practices/testing) — injizierte Transporte, Vertragstests und Timer.
- [Sicherheit](/de-DE/docs/best-practices/security) — Zugangsdaten, XSRF, URL-Validierung und Redaction.
- [Leistung](/de-DE/docs/best-practices/performance) — Streaming, Queues, Failover und Messung.
