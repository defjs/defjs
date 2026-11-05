---
title: "Sécurité"
description: "Garde les identifiants à la frontière de l’application, valide les URL, active XSRF là où c’est nécessaire et masque la télémétrie."
---

## Garder les secrets hors du SDK et du navigateur [#secrets]

Une définition de SDK ne contient ni endpoint, ni jeton, ni identifiant. L’application place les identifiants sur un client qui tourne là où ils peuvent être dépensés : un processus serveur, un worker ou un test de confiance. Ne mets pas un secret de fournisseur dans un bundle navigateur, une variable de build publique ou un client livré au navigateur.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(serverAuth),
);
```

## Utiliser un intercepteur pour l’authentification [#auth]

Attache un jeton dans un intercepteur qui tourne à la frontière de l’application. `builder` doit rester une fonction de placement pure ; il ne peut pas lire un store de jetons ni modifier un en-tête utilisé par un autre appel.

## Configurer XSRF sur le client [#xsrf]

Quand le service utilise un jeton cookie-vers-header, configure `withXsrf` sur le client applicatif. `withCredentials` ne fait que choisir le mode cookie de Fetch ; il ne crée ni ne vérifie de jeton. Le serveur doit toujours émettre et valider le jeton.

## Valider ce que l’application contrôle [#urls]

Defjs rejette les chemins de requête illégaux, les évasions de répertoire, les antislashs, `?`, `#` et les caractères de contrôle avant qu’un transport ne s’exécute. Il ne sait pas quels hosts ton application fait confiance. Garde la liste des endpoints explicite, valide les valeurs fournies par l’utilisateur avant qu’elles n’atteignent `builder`, et ne construis pas d’URL de base à partir d’une entrée non fiable.

## Masquer avant journalisation ou tracing [#redaction]

Les URL, les query strings, les en-têtes et les corps peuvent contenir des secrets ou des données personnelles. Le plugin OpenTelemetry ne capture pas les corps ni les en-têtes complets par défaut ; garde-le ainsi. Masque dans `startSpanHook` ou dans l’exporter de l’application, et ne copie pas de valeurs de requête brutes dans une télémétrie personnalisée.

## Traiter l’annulation comme locale [#abort]

L’annulation arrête le travail local. Elle ne prouve pas qu’un service a arrêté un travail qu’il a déjà accepté, et elle n’annule pas un effet côté serveur. Pour une opération non idempotente, associe l’annulation au contrat d’annulation propre au service.
