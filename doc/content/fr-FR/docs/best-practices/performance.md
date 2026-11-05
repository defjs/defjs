---
title: "Performance"
description: "Envoie les gros corps en flux, borne les files, choisis le basculement délibérément et mesure avant de changer de politique."
---

## Envoyer les gros corps en flux [#streaming]

Envoie un `ReadableStream` pour un corps qui ne doit pas être bufferisé, et lis une grosse réponse en flux quand le consommateur peut traiter les chunks. Un corps JSON doit être entièrement matérialisé avant l’envoi ; un gros upload n’y est pas obligé.

`onUploadProgress` et `onDownloadProgress` observent les octets qui traversent la frontière Fetch. Ce n’est pas la promesse que le serveur a accepté ou traité le corps. Utilise-les pour le retour utilisateur, pas pour le contrôle de flux.

## Borner ce qui peut grandir [#bounds]

Définis `maxIncomingQueueSize` pour les sessions WebSocket et `maxBufferSize` / `maxQueueSize` pour SSE. Une borne fait partie de la politique de contre-pression de l’application : elle décide si un consommateur lent échoue vite ou applique une pression au producteur. Teste le chemin de débordement avec les mêmes limites que la production.

## Choisir le basculement délibérément [#failover]

`withEndpointFailover` ne réessaie une tentative échouée que selon la politique que tu configures. Garde les budgets de tentative et de nouvelle tentative petits, et n’utilise pas le basculement pour répéter une requête non idempotente que le service ne peut pas rejouer. Une vérification de santé ou une pénalité doit refléter le transport que tu utilises réellement.

## Mesurer avant de régler [#measure]

Mesure l’opération, le transport et le consommateur séparément. Un timeout trop court ressemble à un échec réseau ; une file trop petite transforme une rafale en fault. Utilise les hooks de télémétrie existants et une fixture qui reproduit la charge avant de changer un buffer, un timeout ou un nombre de tentatives.
