---
title: Intercepteurs
description: Constructeurs d’intercepteurs HTTP, SSE et WebSocket.
---

# Intercepteurs

Enveloppe `next` pour un transport. Enregistre-les avec `withInterceptors`. Les listes mixtes sont filtrées par kind à l’execute.

## createHttpInterceptor()

```ts
function createHttpInterceptor(fn: InterceptorFn): HttpInterceptor

type InterceptorFn = (req: HttpRequest, next: HttpInterceptorNext) => Promise<HttpResponse<unknown>>
type HttpInterceptorNext = (req: HttpRequest) => Promise<HttpResponse<unknown>>
```

Appelle `next(req)` (éventuellement une requête mutée) ou court-circuite avec `makeResponse`. `next` ne va que vers l’intérieur : vers les intercepteurs enregistrés après celui-ci, puis le transport. L’appeler de nouveau rejoue cette partie interne depuis cet intercepteur ; les intercepteurs externes ne s’exécutent pas deux fois.

## createSSEInterceptor()

```ts
function createSSEInterceptor(fn: SSEInterceptorFn): SSEInterceptor

type SSEHandler = (req: HttpRequest) => Promise<EventStreamHandle<unknown>>
type SSEInterceptorFn = (req: HttpRequest, next: SSEHandler) => Promise<EventStreamHandle<unknown>>
```

`EventStreamHandle` étend `AsyncDisposable`. Une implémentation structurelle de short-circuit doit fournir `[Symbol.asyncDispose](): PromiseLike<void>` et le relier au même cycle de vie de fermeture.

## createWebSocketInterceptor()

```ts
function createWebSocketInterceptor(fn: WebSocketInterceptorFn): WebSocketInterceptor

type WebSocketHandler = (req: HttpRequest) => Promise<WebSocketSessionLike>
type WebSocketInterceptorFn = (req: HttpRequest, next: WebSocketHandler) => Promise<WebSocketSessionLike>
```

`WebSocketSessionLike` est la session vue par l’intercepteur :

```ts
interface WebSocketSessionLike extends AsyncDisposable {
  readonly bufferedAmount: number
  readonly connection: WebSocketConnectionInfo
  readonly closed: Promise<WebSocketCloseInfo>
  readonly receive: AsyncIterable<unknown>
  readonly state: WebSocketState
  close(code?: number, reason?: string): void
  [Symbol.asyncDispose](): PromiseLike<void>
  onRuntimeError(listener: (error: unknown) => void): () => void
  onStateChange(listener: (state: WebSocketState) => void): () => void
  send(message: unknown): void
}
```

Un wrapper ou une session de short-circuit doit transférer le même teardown `[Symbol.asyncDispose]()` que son cycle de vie `close` / `closed` ; renvoyer une promesse résolue sans rapport ne suffit pas. Exiger ce membre est un changement breaking à la compilation pour les implémentations structurelles. Le code qui n’accepte que des sessions renvoyées par Defjs n’a aucune exigence d’appel runtime supplémentaire.

## Types étiquetés

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

```ts
type Interceptor = HttpInterceptor | SSEInterceptor | WebSocketInterceptor

interface HttpInterceptor {
  kind: 'http'
  fn: InterceptorFn
}
interface SSEInterceptor {
  kind: 'sse'
  fn: SSEInterceptorFn
}
interface WebSocketInterceptor {
  kind: 'web-socket'
  fn: WebSocketInterceptorFn
}
```

## Authentification Basic

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

```ts
function basicAuthHttpInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): HttpInterceptor

function basicAuthSSEInterceptor(fn: () => { username: string; password: string }, options?: BasicAuthInterceptorOptions): SSEInterceptor

type BasicAuthInterceptorOptions = {
  encode?: (credential: { username: string; password: string }) => string
}
```

Pose `Authorization: Basic <encoded>` sur chaque requête. `fn` est appelée par requête. `encode` renvoie la partie après `Basic ` ; la valeur par défaut est `btoa('username:password')`. Sans `encode`, créer l’intercepteur lève une exception quand `btoa` n’est pas disponible.

Voir le [guide Intercepteurs](/fr-FR/docs/interceptors).
