---
title: "Conception du SDK"
description: "Conçois des opérations, des Structs et des paquets qui décrivent un contrat sans posséder de client applicatif."
---

## Une opération par définition [#one-operation]

Donne à chaque opération sa propre définition et son propre module. Une opération a une méthode, une forme de chemin, une entrée et un contrat de sortie. Un découpage par opération garde le contrat lisible et permet à une application de n’importer que les opérations qu’elle appelle.

Préfère :

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

Évite un module qui crée un client ou stocke un endpoint à côté des définitions.

## Associer l’entrée à un builder explicite [#builder]

Déclare chaque valeur de l’appelant dans `input` et place-la dans `builder`. Ne compte pas sur un nom de champ qui correspondrait à un paramètre de chemin. `builder` est synchrone et pur : il peut remodeler des valeurs, mais il ne doit pas lire d’identifiants, appeler le réseau ni modifier un état partagé.

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## Les Structs décrivent la forme sur le fil [#structs]

Utilise Struct pour les données qui traversent le fil. Utilise des alias quand le nom sur le fil diffère du nom TypeScript. Considère les règles métier, la validation croisée et la normalisation comme une politique applicative, pas comme un comportement de Struct.

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## Utiliser un nom d’opération stable [#operation-name]

Règle `operation` sur une identité à faible cardinalité comme `orders.read`. Elle étiquette la télémétrie et les diagnostics sans transporter l’URL, l’entrée utilisateur ni une valeur propre à la requête.

## Garder le SDK exempt d’état d’exécution [#no-client]

Un paquet SDK exporte des définitions, des Structs et des types. Il n’appelle pas `createClient`, ne détient pas de client singleton et ne lit pas de variables d’environnement. L’application décide de l’endpoint et des identifiants.

## Versionner le contrat délibérément [#versioning]

Traite un champ supprimé, une méthode ou un chemin modifié et une entrée restreinte comme des changements cassants. Les ajouts sont généralement compatibles. Garde une plage de peer dependencies honnête pour le paquet, publie avec le même texte de définition que celui contre lequel l’application compile, et enregistre le tag de release du paquet publié.
