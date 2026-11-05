---
title: "Vue d’ensemble"
description: "Les contrats et les frontières qui rendent un SDK prévisible entre auteurs de SDK, applications et runtimes."
---

Ces pratiques ne sont pas nécessaires au fonctionnement de Defjs. Elles rendent un SDK prévisible quand plusieurs personnes possèdent la définition, l’application et le transport. Chaque page part d’une règle, montre une forme préférée et une forme à éviter, puis explique la frontière qui la sous-tend.

## Garder la définition et l’exécution séparées [#definition-execution]

Une définition est une donnée. Elle déclare la méthode, le chemin, l’entrée, la sortie et le contrat d’erreur. Elle ne crée pas de client, ne lit pas d’identifiants et ne démarre aucune I/O. L’application crée le client et appelle l’opération. C’est l’appel de l’opération qui effectue la requête.

Cette séparation permet à un paquet SDK d’être livré sans endpoint ni identifiants, et à une même définition de tourner avec des endpoints différents dans un navigateur, un serveur ou un test.

## Déclarer l’entrée, la placer explicitement [#input-builder]

`input` décrit les valeurs fournies par l’appelant. `builder` décide où va chaque valeur : chemin, query, en-têtes ou corps. Le placement n’est jamais déduit d’un nom de champ ni du template de chemin.

`builder` est une fonction pure et synchrone. Elle s’exécute au moment de l’exécution. Une exception devient `REQ_BUILD_FAILED`.

## Lire d’abord l’emplacement de l’erreur [#error-first]

Chaque opération renvoie un tuple error-first. Le premier élément est un fault ou `null`. Les échecs de requête, de réponse et de transport ne lèvent pas au site d’appel.

Lis le fault avant d’utiliser la valeur de succès. Restreins par `code`, puis lis les champs qui appartiennent à ce fault.

## L’application possède le client [#client-ownership]

L’application possède l’endpoint, les identifiants, les intercepteurs, les transports et la durée de vie des flux et des sessions. Le SDK possède le contrat. Les plugins peuvent transmettre un client applicatif dans un arbre de framework ; ils n’en créent ni n’en mettent en cache.

## Pages de cette section [#pages]

- [Conception du SDK](/fr-FR/docs/best-practices/sdk-design) — définitions, Structs, nommage et publication.
- [Intégration applicative](/fr-FR/docs/best-practices/application) — création du client, configuration, intercepteurs et plugins de framework.
- [Gestion des erreurs](/fr-FR/docs/best-practices/errors) — codes de fault, restriction, journalisation et nouvelles tentatives.
- [Streaming et temps réel](/fr-FR/docs/best-practices/streaming) — SSE, WebSocket, propriété et contre-pression.
- [Tests](/fr-FR/docs/best-practices/testing) — transports injectés, tests de contrat et timers.
- [Sécurité](/fr-FR/docs/best-practices/security) — identifiants, XSRF, validation d’URL et masquage.
- [Performance](/fr-FR/docs/best-practices/performance) — streaming, files, basculement et mesure.
