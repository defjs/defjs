---
title: "Skill"
description: "Installe le skill Defjs, demande une opération GET typée et vérifie le résultat avec le SDK installé."
---

# Skill

Le skill Defjs transmet à un assistant le contrat entre la définition du SDK et l’exécution dans l’application. Un assistant compatible peut le charger pour une tâche pertinente ; l’activation automatique dépend de l’outil.

## Installer le skill [#install]

Exécutez la commande dans le projet qui doit recevoir le skill. Par défaut, la CLI installe dans le projet courant et peut détecter l’agent courant ou vous demander d'en choisir un ; `-a` permet de le préciser.

```sh
bunx skills add defjs/defjs --skill defjs
```

Après publication, les instructions du skill se lisent dans [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). La source GitHub est la branche par défaut et peut différer de la version de `@defjs/core` installée dans un projet.

## Demander une opération [#prompt]

Donnez une tâche à l'assistant. Cette invite demande une opération `GET /orders/:id` typée dont le client reste dans l’application :

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## Vérifier le résultat [#verify]

Lisez la définition et l'application séparément. La définition exporte l’opération et ne crée pas le client. L’application crée le client et appelle l’opération, par exemple `getOrder(client, { id: 1 })`. Là où `input` est déclaré, `builder` est une fonction synchrone et pure, écrite explicitement. La valeur de succès n’est utilisée que lorsque l’emplacement d’erreur est vide : le point d’appel vérifie `if (err)` juste après l’appel et retourne depuis ce bloc, et une fonction utilitaire susceptible d’échouer renvoie son propre tuple `[err, value]` au lieu de journaliser ou de renvoyer `undefined`.

Exécutez ensuite la vérification de types de ce projet et les tests qui couvrent le contrat. L'installation des dépendances et les règles de CI restent dans ce projet.
