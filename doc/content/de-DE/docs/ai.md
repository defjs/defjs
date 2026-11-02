---
title: "KI-gestützte Entwicklung"
description: "Installiere den Defjs-Skill, bitte um einen typisierten GET-Endpunkt und prüfe das Ergebnis am installierten SDK."
---

Defjs-Code von einem Assistenten schreiben zu lassen und einen KI-Dienst aus der Anwendung aufzurufen, sind zwei verschiedene Aufgaben. Diese Seite ist der Ablauf für den Assistenten. [KI-APIs aufrufen](/de-DE/docs/ai-api) ist der Ablauf in der Anwendung. Ein unterstützter Assistent kann den installierten Skill bei passenden Aufgaben laden; die automatische Aktivierung hängt vom Tool ab.

## Den Skill installieren [#install]

Die skills-CLI braucht Node.js 22.20 oder neuer. Das ist eine Anforderung des Installers, nicht die Laufzeit von `@defjs/core`. Die Laufzeit steht im [Schnellstart](/de-DE/docs/start).

Führe den Befehl im gewünschten Projekt aus. Die CLI installiert standardmäßig im aktuellen Projekt und erkennt den aktuellen Agenten oder fragt nach einer Auswahl; mit `-a` kannst du ihn ausdrücklich festlegen.

```sh
npx skills add defjs/defjs --skill defjs
```

Nach der Veröffentlichung stehen die Skill-Anweisungen unter [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). Der GitHub-Quelltext ist der Standardbranch und kann von der im Projekt installierten `@defjs/core`-Version abweichen.

## Einen Endpunkt verlangen [#prompt]

Gib dem Assistenten eine Aufgabe. Dieser Prompt verlangt ein typisiertes `GET /orders/:id`, dessen Client in der Anwendung bleibt:

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## Das Ergebnis prüfen [#verify]

Lies Definition und Anwendung getrennt. Die Definition exportiert die Operation und erzeugt den Client nicht. Die Anwendung erzeugt den Client und ruft die Operation auf, zum Beispiel `getOrder(client, { id: 1 })`. Ist `input` deklariert, ist `builder` eine explizite synchrone reine Funktion. Der Erfolgswert wird nur gelesen, wenn der Fehlerplatz leer ist.

Führe danach die Typprüfung dieses Projekts und die Tests aus, die den Vertrag wirklich ausführen. Installation von Abhängigkeiten und CI-Regeln bleiben bei diesem Projekt.

## Englisches Markdown für Assistenten [#resources]

Die Anleitungen, Beispiele und API-Übersichten dieser Site sind für Menschen geschrieben und liegen in jeder Sprache vor. Die drei Adressen unten entstehen nur aus den englischen Seiten. Sie haben kein Sprachpräfix und sind keine Übersetzung der Seite, die du gerade liest.

- [Index der englischen Seiten](/llms.txt) listet die englischen Seiten und verlinkt ihre Webadressen.
- [Zusammengestellte englische Anleitungen](/llms-full.txt) fügt diese Seiten zu einer Datei zusammen.
- [Schnellstart als Markdown](/llms.mdx/docs/start/content.md) ist der englische Text einer Seite. Jede andere englische Seite hat dieselbe Form, `/llms.mdx/…/content.md`.

Lies den [Schnellstart](/de-DE/docs/start), wenn du die Anleitung in dieser Sprache willst. Gib dem Assistenten die Markdown-Adresse, wenn er der API folgen soll. Er muss sich an die im Projekt installierte Version von `@defjs/core` halten: Die Dokumentation dieser Site kann von der installierten Version abweichen, also prüfe die APIs dieser Version. Auch der GitHub-Quelltext der Dokumentation ist der Standardbranch und kann von der installierten Version abweichen. Entferne Geheimnisse und prüfe die Datenrichtlinie des Projekts, bevor du Code oder Kontext an ein KI-Werkzeug gibst.
