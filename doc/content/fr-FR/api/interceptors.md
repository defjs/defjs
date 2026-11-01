---
title: Intercepteurs
description: Constructeurs d’intercepteurs HTTP, SSE et WebSocket.
---

# Intercepteurs

Enveloppe `next` pour un transport. Enregistre avec `withInterceptors`. Les listes mixtes sont filtrées par kind quand l’opération s’exécute.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Appelle `next(req)` (éventuellement une requête mutée) ou court-circuite avec `makeResponse`. `next` ne va que vers l’intérieur : vers les intercepteurs enregistrés après celui-ci, puis le transport. L’appeler à nouveau rejoue cette partie intérieure depuis cet intercepteur ; les intercepteurs extérieurs ne tournent pas deux fois.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` étend `AsyncDisposable`. Une implémentation structurelle de court-circuit doit fournir `[Symbol.asyncDispose](): PromiseLike<void>` et la relier au même cycle de vie de fermeture.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` est la session vue par l’intercepteur :

<ApiSignature name="WebSocketSessionLike" />

Un wrapper ou une session de court-circuit doit transmettre le même teardown `[Symbol.asyncDispose]()` que son cycle de vie `close` / `closed` ; renvoyer une promesse résolue sans rapport ne suffit pas. Exiger ce membre est un breaking change à la compilation pour les implémentations structurelles. Le code qui n’accepte que des sessions renvoyées par Defjs n’a pas d’appel runtime supplémentaire à faire.

## Types marqués

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## Auth basic

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Pose `Authorization: Basic <encoded>` sur chaque requête. `fn` renvoie `{ username, password }` et est appelée par requête. Le second argument facultatif `{ encode }` reçoit ces identifiants et renvoie la partie après `Basic ` ; l’encodage par défaut est ``btoa(`${username}:${password}`)``. Sans `encode`, créer l’intercepteur lève une erreur quand `btoa` n’est pas disponible.

Voir le [guide Intercepteurs](/fr-FR/docs/interceptors).
