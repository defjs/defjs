---
title: "Exemples pratiques"
description: Construire et publier un SDK réutilisable, puis configurer l'authentification, les appels et le travail temps réel dans les applications consommatrices.
---

Commencez par [Créer et publier un SDK](/fr-FR/recipes/publish-http-sdk) pour découvrir le parcours complet, de la définition exportée jusqu'au paquet npm consommé par une application. Chaque recette ci-dessous associe un contrat d'opération aux politiques applicatives qui l'entourent, avec des onglets de code multi-fichiers montrant l'articulation entre définition du SDK et exécution applicative.

## HTTP

- [Envoyer du JSON](/fr-FR/recipes/post-json) — projeter des champs camelCase en clés réseau `snake_case` et décoder une réponse `201` typée.
- [Traiter une 404 déclarée](/fr-FR/recipes/get-declared-404) — aiguiller entre une sortie `200` typée et un corps d'erreur `404` `HTTP_STATUS` déclaré.
- [Annulation et délais d'attente](/fr-FR/recipes/cancel-http) — combiner un `AbortController` appelant avec `AbortSignal.timeout(...)` et distinguer `NET_ABORTED` de `NET_TIMEOUT`.
- [Requêtes conditionnelles ETag](/fr-FR/recipes/etag-revalidate) — envoyer `If-None-Match`, traiter `304 Not Modified` comme un fault `HTTP_STATUS` et conserver le cache `Map` dans le code applicatif.
- [Requêtes GraphQL](/fr-FR/recipes/graphql-http-envelope) — envoyer une requête GraphQL par HTTP `POST` et extraire `errors[]` en traitant `data` comme `.nullish()` dans une fonction utilitaire.

## Authentification

- [Renouveler un jeton après 401](/fr-FR/recipes/refresh-bearer-once) — attacher un jeton `Bearer`, dédupliquer les rafraîchissements concurrents et rejouer la requête une seule fois dans un unique intercepteur HTTP.

## Temps réel

- [Consommer les événements SSE](/fr-FR/recipes/consume-sse) — ouvrir un flux Server-Sent Events typé, itérer une seule fois et garantir `stream.close()` + `await stream.closed` dans un bloc `finally`.
- [Gérer les sessions WebSocket](/fr-FR/recipes/websocket-session) — échanger des trames JSON entrantes et sortantes typées, souscrire à `onRuntimeError` et fermer proprement la session.

## Tests et publication de SDK [#testing-and-packaging]

- [Tests HTTP locaux](/fr-FR/recipes/test-with-handle) — tester la construction d'URL, les intercepteurs et le décodage Struct en mémoire avec `withHTTPHandle(...)`.
- [Créer et publier un SDK](/fr-FR/recipes/publish-http-sdk) — empaqueter et publier un SDK sans client avec `tsdown`, puis le consommer depuis une application.
