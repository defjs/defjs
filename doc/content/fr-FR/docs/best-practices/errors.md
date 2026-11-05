---
title: "Gestion des erreurs"
description: "Lis les faults au site d’appel, restreins par code et garde la journalisation et les nouvelles tentatives hors de la définition."
---

## Lire le fault avant la valeur [#fault-first]

Chaque opération renvoie `[error, data, response]`. La valeur de succès n’a de sens que quand le premier élément est `null`.

Préfère :

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

Évite :

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // order is undefined when the call failed
```

## Restreindre par code, puis par données [#narrow]

`fault.code` sélectionne la classe d’échec. Lis `status` pour `HTTP_STATUS`, `data` pour un corps d’erreur décodé et `response` pour les métadonnées. `cause` conserve l’échec du parser ou du transport sous-jacent ; ne le remplace pas par un message générique.

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

Les codes `RES_*` signifient que la réponse n’a pas pu être lue comme déclaré. Les codes `NET_*` signifient que la requête n’a pas produit de réponse exploitable. Ne réessaie pas un échec de décodage ou de contrat comme s’il s’agissait d’un échec réseau.

## Journaliser une fois, à la frontière qui possède l’issue [#logging]

Journalise à la couche qui décide de la suite : le handler de requête, l’exécuteur de tâches ou la frontière de l’UI. Utilise le plugin OpenTelemetry ou un intercepteur pour la télémétrie ; la définition reste exempte de journalisation. Masque les URL, les query strings, les en-têtes et les corps avant qu’ils n’atteignent un journal.

## Ne réessayer que ce qui peut être rejoué sans risque [#retry]

Defjs ne réessaie pas HTTP de lui-même. Une nouvelle tentative appartient à l’application ou à une politique explicite de basculement d’endpoint. Réessaie une méthode sûre ou une opération que le service documente comme idempotente. Un POST qui a pu démarrer un travail facturable n’est pas sûr à répéter sans contrat de rejeu.

## Ne pas avaler les erreurs [#no-swallow]

Renvoyer un succès après une erreur masque un contrat cassé. Mappe le fault vers un résultat applicatif, relance une erreur de programmation ou termine l’opération par un échec typé. N’attrape pas un fault juste pour le journaliser et continuer avec une valeur `undefined`.
