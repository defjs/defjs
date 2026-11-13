---
title: "Skill"
description: "Installiere den Defjs-Skill, frage eine typisierte GET-Operation an und prüfe das Ergebnis am installierten SDK."
---

# Skill

Der Defjs-Skill vermittelt einem Assistenten den Vertrag zwischen SDK-Definition und Anwendungsausführung. Ein unterstützter Assistent kann ihn bei passenden Aufgaben laden; die automatische Aktivierung hängt vom Tool ab.

## Den Skill installieren [#install]

Führe den Befehl im gewünschten Projekt aus. Die CLI installiert standardmäßig im aktuellen Projekt und erkennt den aktuellen Agenten oder fragt nach einer Auswahl; mit `-a` kannst du ihn ausdrücklich festlegen.

```sh
bunx skills add defjs/defjs --skill defjs
```

Nach der Veröffentlichung stehen die Skill-Anweisungen unter [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). Der GitHub-Quelltext ist der Standardbranch und kann von der im Projekt installierten `@defjs/core`-Version abweichen.

## Eine Operation anfragen [#prompt]

Gib dem Assistenten eine Aufgabe. Dieser Prompt fordert ein typisiertes `GET /orders/:id`, dessen Client in der Anwendung bleibt:

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## Das Ergebnis prüfen [#verify]

Lies Definition und Anwendung getrennt. Die Definition exportiert die Operation und erzeugt den Client nicht. Die Anwendung erzeugt den Client und ruft die Operation auf, zum Beispiel `getOrder(client, { id: 1 })`. Ist `input` deklariert, ist `builder` eine explizite synchrone reine Funktion. Der Erfolgswert wird nur gelesen, wenn der Fehlerplatz leer ist: Die Aufrufstelle prüft `if (err)` direkt nach dem Aufruf und kehrt innerhalb dieses Blocks zurück, und ein Helfer, der fehlschlagen kann, gibt sein eigenes `[err, value]`-Tupel zurück, statt zu protokollieren oder `undefined` zurückzugeben.

Führe danach die Typprüfung dieses Projekts und die Tests aus, die den Vertrag abdecken. Installation von Abhängigkeiten und CI-Regeln bleiben bei diesem Projekt.
