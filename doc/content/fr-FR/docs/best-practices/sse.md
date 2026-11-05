---
title: "SSE"
description: "Possède le handle du flux d’événements, lis jusqu’au bout, borne le buffer et décide explicitement la politique de reconnexion."
---

## Posséder le handle [#ownership]

Un flux d’événements appartient à l’appelant qui l’a ouvert. Ferme-le quand le travail est terminé, et utilise `await using` quand la portée environnante le possède, pour que le handle soit disposé sur chaque chemin de sortie.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## Lire jusqu’au bout ou jusqu’à EOF [#read-to-end]

Un événement n’est pas une réponse complète. Continue à lire jusqu’à ce que le flux se termine, que l’appelant abandonne, ou qu’une politique de reconnexion prenne le relais. Traite un échec de lecture comme un échec de transport, pas comme une fin propre.

## Borner le buffer et la file [#bounds]

Définis `maxBufferSize` et `maxQueueSize` à partir de la taille des messages et de la vitesse du consommateur. Une borne transforme un consommateur lent en fault au lieu d’une croissance de mémoire sans limite. Teste le chemin de dépassement avec les mêmes limites que la production.

## Décider explicitement la politique de reconnexion [#reconnect]

La reconnexion SSE est désactivée tant que l’application ne l’active pas. Une méthode non idempotente comme POST n’est pas rejouée sauf si la politique l’autorise. Une tentative échouée peut déjà avoir démarré du travail sur le serveur ; lis les règles de reconnexion dans [les flux d’événements SSE](/fr-FR/docs/sse) avant d’activer une politique.

## Fermer, pas fuir [#close]

`close()` démarre le teardown ; `closed` rapporte l’état terminal. Attends `closed` quand l’étape suivante dépend de la libération du transport. Un abandon termine le travail local ; ce n’est pas la preuve que le service a arrêté le travail qu’il a déjà accepté.
