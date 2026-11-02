---
title: "Développement assisté par IA"
description: "Installe le skill Defjs, demande un endpoint GET typé et vérifie le résultat avec le SDK installé."
---

Faire écrire du code Defjs par un assistant et appeler un service d’IA depuis l’application sont deux tâches distinctes. Cette page décrit le parcours de l’assistant. [Appeler des API d’IA](/fr-FR/docs/ai-api) décrit le parcours de l’application. Un assistant compatible peut charger le Skill installé pour une tâche pertinente ; le chargement automatique dépend de l’outil.

## Installer le skill [#install]

La CLI skills exige Node.js 22.20 ou plus récent. Cette exigence concerne l’installateur. Ce n’est pas le runtime de `@defjs/core`. Le runtime est décrit dans le [démarrage rapide](/fr-FR/docs/start).

Exécute la commande dans le projet qui doit recevoir le skill. Par défaut, la CLI installe dans le projet courant et peut détecter l’agent courant ou te demander d’en choisir un ; `-a` permet de le préciser.

```sh
npx skills add defjs/defjs --skill defjs
```

Après publication, les instructions du skill se lisent dans [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). La source GitHub est la branche par défaut et peut différer de la version de `@defjs/core` installée dans un projet.

## Demander un endpoint [#prompt]

Donne une tâche à l’assistant. Cette invite demande un `GET /orders/:id` typé dont le client reste dans l’application :

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## Vérifier le résultat [#verify]

Lis la définition et l’application séparément. La définition exporte l’opération et ne crée pas le client. L’application crée le client et appelle l’opération, par exemple `getOrder(client, { id: 1 })`. Là où `input` est déclaré, `builder` est une fonction synchrone et pure, écrite explicitement. La valeur de succès n’est utilisée que lorsque l’emplacement d’erreur est vide.

Exécute ensuite la vérification de types de ce projet et les tests qui couvrent le contrat. L’installation des dépendances et les règles de CI restent dans ce projet.

## Markdown anglais pour les assistants [#resources]

Les guides, exemples et aperçus d’API de ce site sont écrits pour des personnes et existent dans chaque langue. Les trois adresses ci-dessous sont produites seulement à partir des pages anglaises. Elles n’ont pas de préfixe de langue et ne sont pas la traduction de la page que tu lis.

- [Index des pages anglaises](/llms.txt) liste les pages anglaises et lie leurs adresses web.
- [Guides anglais compilés](/llms-full.txt) réunit ces pages dans un fichier.
- [Démarrage rapide en Markdown](/llms.mdx/docs/start/content.md) est le texte anglais d’une page. Chaque autre page anglaise a la même forme, `/llms.mdx/…/content.md`.

Lis le [démarrage rapide](/fr-FR/docs/start) pour ce guide dans cette langue. Donne l’adresse Markdown à l’assistant quand il doit suivre l’API. Il doit encore respecter la version de `@defjs/core` installée dans le projet : la documentation du site peut différer de la version installée, donc vérifie les API de cette version. La source GitHub de la documentation est aussi la branche par défaut et peut différer de la version installée. Retire les secrets et vérifie la politique de données du projet avant de partager du code ou du contexte avec un outil d’IA.
