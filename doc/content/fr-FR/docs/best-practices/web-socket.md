---
title: "WebSocket"
description: "Possède la session, lis la file de réception, borne les deux files, et gère les erreurs runtime et les reconnexions."
---

## Posséder la session [#ownership]

Une session WebSocket appartient à l’appelant qui l’a ouverte. Ferme-la quand le travail est terminé, et utilise `await using` quand la portée environnante la possède, pour que la session soit disposée sur chaque chemin de sortie.

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## Lire jusqu’à la fermeture de la session [#read-to-end]

Lis `session.receive` jusqu’à ce que la session se ferme ou que l’appelant s’arrête. Ne suppose pas que le premier message est le dernier. Enregistre `onRuntimeError` quand l’application doit observer un échec de transport qui survient après l’ouverture de la session.

## Borner les deux files [#bounds]

Définis `maxIncomingQueueSize` pour les messages en attente du consommateur et `maxOutgoingQueueSize` pour les messages mis en file pendant la reconnexion. Une borne transforme un consommateur lent ou une longue reconnexion en fault au lieu d’une croissance de mémoire sans limite. Teste le chemin de dépassement avec les mêmes limites que la production.

## Rendre la reconnexion et le heartbeat délibérés [#reconnect]

La reconnexion et le heartbeat sont des options de client. Une reconnexion crée une nouvelle tentative de connexion ; les messages sortants en file suivent la politique de file. Un heartbeat qui ne reçoit aucun acquittement est un échec que l’application doit classer, pas une raison de continuer à envoyer indéfiniment.

## Fermer, pas fuir [#close]

`close()` démarre le teardown ; `closed` rapporte l’état terminal. Un envoi après que la session n’est plus inscriptible lève ; vérifie l’état ou gère la levée. Attends `closed` quand l’étape suivante dépend de la libération du transport.
