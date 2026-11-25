---
title: Intercepteurs
description: Constructeurs d’intercepteurs HTTP, SSE et WebSocket.
---

# Intercepteurs

Enveloppez `next` pour un transport, ou pour un appel d’opération entier. Enregistrez avec `withInterceptors`. Les listes mixtes sont filtrées par type quand l’opération s’exécute.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Appelez `next(req)` (éventuellement une requête mutée) ou court-circuite avec `makeResponse`. `next` ne va que vers l’intérieur : vers les intercepteurs enregistrés après celui-ci, puis le transport. L’appeler à nouveau rejoue cette partie intérieure depuis cet intercepteur ; les intercepteurs extérieurs ne tournent pas deux fois.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` étend `AsyncDisposable`. Une implémentation structurelle de court-circuit doit fournir `[Symbol.asyncDispose](): PromiseLike<void>` et la relier au même cycle de vie de fermeture.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` est la session vue par l’intercepteur :

<ApiSignature name="WebSocketSessionLike" />

Un wrapper ou une session de court-circuit doit transmettre la même libération `[Symbol.asyncDispose]()` que son cycle de vie `close` / `closed` ; renvoyer une promesse résolue sans rapport ne suffit pas.

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` exécute l’appel entier : validation de l’entrée, choix de l’endpoint, `builder`, chaque tentative avec ses intercepteurs de transport et ses retries, et le décodage de la réponse. Il ne prend aucun argument et n’exécute l’appel qu’une fois, quel que soit le nombre de ses appels. La fonction est générique sur le résultat : elle ne se résout donc qu’avec ce que `next()` a renvoyé. Les intercepteurs d’opération s’exécutent pour tous les transports, à l’extérieur des intercepteurs de transport. Une levée ou un rejet résout l’opération avec `EXT_INTERCEPTOR_FAILED`, et un flux ou une session que l’appel avait déjà ouvert est fermé.

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## Types marqués

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## Auth basic

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Définit `Authorization: Basic <encoded>` sur chaque requête. `fn` renvoie `{ username, password }` et est appelée par requête. Le second argument facultatif `{ encode }` reçoit ces identifiants et renvoie la partie après `Basic ` ; l’encodage par défaut est ``btoa(`${username}:${password}`)``. Sans `encode`, créer l’intercepteur lève une erreur quand `btoa` n’est pas disponible.

## Limite de concurrence

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

Limite les tentatives HTTP en cours simultanément par compartiment (`key`, avec un compartiment partagé par défaut). Les requêtes au-delà de `maxConcurrency` attendent en ordre FIFO jusqu’à `maxQueue` (`Infinity` par défaut), ou échouent avec `BulkheadOverflowError` (remontée comme `EXT_INTERCEPTOR_FAILED` avec `{ attempted: false }`). Les permis sont relâchés pendant les attentes de backoff de `withRetry`, et les requêtes déjà annulées ou annulées en file d’attente se résolvent avec `NET_ABORTED` ou `NET_TIMEOUT`. Voir [Limites de concurrence et appels groupés](/fr-FR/recipes/concurrency-limit).

## Clé d’idempotence

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

Clone `req.headers` et définit `headerName` (`'Idempotency-Key'` par défaut) sur les requêtes dont la méthode correspond à `methods` (`['POST', 'PATCH']` par défaut), en ignorant celles qui portent déjà l’en-tête lorsque `respectExisting` vaut `true` (par défaut). Sans `generate`, réutilise `req.correlationId` (ou se rabat sur un UUID v4) afin que chaque tentative `withRetry` d’un même appel envoie la même clé ; avec `generate`, mémoïse par `req.correlationId` dans un cache borné à 4 096 entrées. Voir [Clés d’idempotence](/fr-FR/recipes/idempotency-key).

Voir le [guide Intercepteurs](/fr-FR/docs/interceptors).
