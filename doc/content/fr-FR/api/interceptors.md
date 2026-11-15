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

Voir le [guide Intercepteurs](/fr-FR/docs/interceptors).
