---
title: "Guide"
description: Concevoir des endpoints de SDK et leurs contrats, puis les tester, les intégrer et les publier avec un client propre à l’application.
---

Defjs accompagne le passage du contrat d’API au SDK publié. Lis le [démarrage rapide](/fr-FR/docs/start), puis les [commandes](/fr-FR/docs/commands) et le [client](/fr-FR/docs/client) : le SDK exporte les endpoints, l’application configure leur exécution. [Struct](/fr-FR/docs/struct) décrit les contrats de données partagés ; les [décisions de conception](/fr-FR/docs/design-decisions) en expliquent les limites.

Une fois le premier endpoint opérationnel, passe aux [tests locaux](/fr-FR/recipes/test-with-handle) et à la [publication sur npm](/fr-FR/recipes/publish-http-sdk). Les guides de transport et les plugins détaillent ensuite le contrat du SDK et les responsabilités de l’application.

## Développement de SDK [#premiers-pas]

- [Présentation du projet](/fr-FR)
- [Démarrage rapide](/fr-FR/docs/start)

## Contrats et exécution [#appels-et-contrats]

- [Contrats de données / Struct](/fr-FR/docs/struct)
- [Définir et exécuter / Command](/fr-FR/docs/commands)
- [Configuration du client / Client](/fr-FR/docs/client)

## Requêtes et temps réel

- [Requêtes HTTP](/fr-FR/docs/http)
- [Flux d’événements SSE](/fr-FR/docs/sse)
- [Sessions WebSocket](/fr-FR/docs/web-socket)

## Erreurs et interception

- [Gestion des erreurs](/fr-FR/docs/errors)
- [Intercepteurs](/fr-FR/docs/interceptors)

## Plugins

- [Plugins](/fr-FR/docs/integrations)
- [React](/fr-FR/docs/integrations/react)
- [Vue](/fr-FR/docs/integrations/vue)
- [Serveur OpenTelemetry](/fr-FR/docs/integrations/opentelemetry-server)

[Décisions de conception](/fr-FR/docs/design-decisions)
