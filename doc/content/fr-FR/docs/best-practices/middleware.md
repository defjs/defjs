---
title: "Middleware"
description: "Compose les intercepteurs comme des politiques petites et ordonnées qui restent à la frontière de l’application."
---

## Un intercepteur, une responsabilité [#one-concern]

Donne à chaque intercepteur un seul travail : attacher l’authentification, ajouter un en-tête de trace, enregistrer le timing, ou court-circuiter un cas approuvé. Un middleware qui authentifie, réécrit le corps, réessaie et journalise est difficile à tester et à raisonner.

Préfère :

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

Évite un intercepteur unique qui change plusieurs parties sans rapport de la requête.

## L’ordre est une politique [#order]

Les intercepteurs s’exécutent dans l’ordre d’enregistrement. Le premier intercepteur enregistré est le plus externe : il voit la requête en premier et la réponse en dernier. Place la politique qui doit envelopper toute la tentative au plus externe ; place la politique qui doit être la plus proche du transport au plus interne.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(trace, auth),
);
```

`trace` enveloppe `auth` ; `auth` s’exécute avant le transport.

## Court-circuiter délibérément [#short-circuit]

Un intercepteur peut renvoyer une réponse avec `makeResponse` sans appeler `next`. Utilise-le pour un cache approuvé, une réponse de maintenance ou un test local. La réponse doit tout de même satisfaire la sortie déclarée de l’opération ; ne transforme pas un échec en succès.

## Ne pas réécrire le contrat [#contract]

Un middleware peut ajuster les en-têtes, le contexte de trace ou l’URL de la requête dans les règles de validation de la bibliothèque. Il ne doit pas changer la signification déclarée de l’entrée ou de la sortie. L’authentification et le tracing appartiennent ici, pas à `builder`.

## Rester sans état [#stateless]

Ne stocke pas de données par requête sur un client partagé ou un module. Passe une valeur par la requête, la configuration du client ou une closure créée pour ce client. Un middleware qui modifie un état partagé provoque des fuites entre les appels concurrents.

## Gérer les échecs à la frontière [#failures]

Une levée de middleware est un échec ; renvoie une réponse seulement quand le middleware a traité la requête volontairement. N’attrape pas un fault juste pour le journaliser et continuer avec `undefined`. Utilise le hook de télémétrie de l’application ou un intercepteur pour la journalisation, et garde la définition exempte des deux.
