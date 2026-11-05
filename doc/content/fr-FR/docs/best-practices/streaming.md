---
title: "Streaming et temps réel"
description: "Possède le handle du flux, borne les files et décide de la politique de reconnexion et de rejeu dans l’application."
---

## Posséder le handle [#ownership]

Un flux d’événements ou une session WebSocket appartient à l’appelant qui l’a ouverte. Ferme-le quand le travail est terminé, et utilise `await using` quand la portée environnante le possède, pour que le handle soit disposé sur chaque chemin de sortie.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## Lire jusqu’à la fin ou l’EOF [#read-to-end]

Un événement n’est pas une réponse complète. Pour SSE, continue de lire jusqu’à la fin du flux, l’annulation par l’appelant ou la prise en charge par une politique de reconnexion. Pour WebSocket, lis la file de réception jusqu’à la fermeture de la session ou l’arrêt par l’appelant.

## Borner les buffers et les files [#bounds]

Définis `maxIncomingQueueSize` pour les sessions WebSocket et `maxBufferSize` / `maxQueueSize` pour SSE. Une borne transforme un consommateur lent en fault au lieu d’une croissance mémoire non bornée. Choisis la borne d’après la taille des messages et la vitesse du consommateur, puis teste le chemin de débordement.

## Décider explicitement de la reconnexion et du rejeu [#reconnect]

La reconnexion SSE reste désactivée tant que l’application ne l’active pas. Un POST ou une autre méthode non idempotente n’est pas rejoué sauf si la politique l’autorise. Une tentative de streaming échouée a peut-être déjà démarré un travail sur le serveur ; lis les règles de reconnexion dans [Flux d’événements SSE](/fr-FR/docs/sse) et les règles de rejeu dans [Requêtes HTTP](/fr-FR/docs/http) avant d’activer une politique.

## Fermer, ne pas fuir [#close]

`close()` démarre le démontage ; `closed` signale l’état terminal. Attends `closed` quand l’étape suivante dépend de la libération du transport. Une annulation termine le travail local ; ce n’est pas la preuve que le service a arrêté un travail qu’il a déjà accepté.
