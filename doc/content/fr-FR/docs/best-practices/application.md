---
title: "Intégration applicative"
description: "Crée le client à la frontière de l’application et garde les identifiants, les politiques et le câblage de framework hors du SDK."
---

## Créer le client une fois à la frontière [#client-boundary]

Crée le client là où l’application lit sa configuration : un point d’entrée serveur, un module qui possède le déploiement ou une mise en place de test. Passe ce client au code qui appelle les opérations.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

Évite un client au niveau du module dans un SDK, dans le corps d’un composant ou dans un handler de requête. Un client créé à chaque rendu ou à chaque requête perd la configuration partagée et fait dépendre les tests d’un état ambiant.

## Placer la politique transverse dans les intercepteurs [#interceptors]

L’authentification, le tracing, les en-têtes par défaut et une politique de nouvelle tentative revue appartiennent à un intercepteur. `builder` place l’entrée courante ; il ne connaît ni les identifiants ni la télémétrie de l’application.

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## Utiliser les options de client pour un appel [#per-call]

`client(options)` renvoie une valeur de client pour un appel. La valeur n’est pas appelable. Utilise-la pour un signal, des callbacks de progression ou un hook WebSocket qui ne s’applique qu’à cet appel ; garde le client de base pour tout le reste.

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## Laisser les plugins de framework transmettre le client [#plugins]

`@defjs/react` et `@defjs/vue` transmettent un client applicatif dans l’arbre du framework. Ils n’en créent, n’en mettent en cache, n’en réessaient ni n’en disposent. Fournis le client que l’application possède déjà et injecte la même valeur là où elle est nécessaire.

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## Garder l’endpoint hors du SDK [#endpoint]

La même définition peut tourner contre la production, le staging, une fixture locale ou un transport de test. Choisis l’endpoint dans l’application ; n’encode pas un host de déploiement dans le paquet SDK.
