---
title: Intercepteurs
description: Empile la politique HTTP, SSE et WebSocket à la frontière du transport en ordre oignon.
---

# Intercepteurs

Ajoute des en-têtes d’auth, short-circuit des fenêtres de maintenance, ou relance des lectures safe — sans toucher à la validation de commande. Chaque transport a sa propre chaîne. Tu reçois un `HttpRequest` ; tu renvoies le résultat de ce transport (`HttpResponse`, handle de flux d’événements, ou session WebSocket). La validation d’entrée tourne avant la chaîne ; le dispatch par statut et les résultats décodés après.

## Basic Setup

```typescript twoslash
import { createClient, createHttpInterceptor, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit))
void client
```

## Ordre oignon

`withInterceptors(...items)` accepte des intercepteurs mixtes. Le client filtre par `kind` pour le transport sélectionné et garde l’ordre relatif d’enregistrement. Chaque intercepteur peut tourner avant et après `next` :

| Factory                      | Requête       | Résultat de `next`                    |
| ---------------------------- | ------------- | ------------------------------------- |
| `createHttpInterceptor`      | `HttpRequest` | `Promise<HttpResponse<unknown>>`      |
| `createSSEInterceptor`       | `HttpRequest` | `Promise<EventStreamHandle<unknown>>` |
| `createWebSocketInterceptor` | `HttpRequest` | `Promise<WebSocketSessionLike>`       |

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

const order: string[] = []
const first = createHttpInterceptor(async (request, next) => {
  order.push('first:before')
  const response = await next(request)
  order.push('first:after')
  return response
})

const second = createHttpInterceptor(async (request, next) => {
  order.push('second:before')
  const response = await next(request)
  order.push('second:after')
  return response
})

// Request: first:before → second:before → transport
// Return: second:after → first:after
void [first, second, order]
```

Plusieurs appels `withInterceptors(...)` append. Mets l’observation large hors de la mutation/retry plus étroite quand la couche externe doit voir le résultat final.

## Cloner et ajouter des en-têtes de requête

Traite le `HttpRequest` entrant comme appartenant à la chaîne. Clone `Headers` avant de les changer ; passe une nouvelle requête à `next` :

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

function readAccessToken(): string | undefined {
  return undefined
}

const bearer = createHttpInterceptor((request, next) => {
  const token = readAccessToken()
  if (!token) return next(request)

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return next({ ...request, headers })
})
```

Même pattern pour SSE. Le WebSocket navigateur ne peut pas ajouter d’en-têtes de handshake arbitraires — changer `request.headers` n’authentifiera pas un socket navigateur. Utilise plutôt protocole, politique URL/query, ou un handshake supporté par le serveur.

Quand tu remplaces un body HTTP, remplace `body` sur la requête copiée. Fetch ignore les métadonnées content-type périmées quand la valeur du body a changé. Ne réutilise pas un body `ReadableStream` consommé.

## Short-circuit une requête

Tu peux sauter `next`, mais tu dois renvoyer le type de résultat attendu. Pour HTTP, `makeResponse(...)` construit un wrapper compatible :

```typescript twoslash
import { createHttpInterceptor, makeResponse } from '@defjs/core'

function isMaintenanceWindow(): boolean {
  return false
}

const maintenanceGate = createHttpInterceptor(async (_request, next) => {
  if (isMaintenanceWindow()) {
    return makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { message: 'Temporarily unavailable' },
    })
  }

  return next(_request)
})
```

La couche commande dispatche encore par statut. Déclare un seul struct `error` pour le côté non-2xx quand les appelants ont besoin d’`error.data` typé. Short-circuiter SSE ou WebSocket demande un handle/session compatible complet (promesses de fermeture, état live, propriété, et `[Symbol.asyncDispose]`). Les objets partiels ne sont pas une politique valide. Les implémentations structurelles d’`EventStreamHandle` et de `WebSocketSessionLike` exigent maintenant ce disposer standard à la compilation ; les consommateurs qui ne reçoivent que des handles Defjs n’ont aucun nouvel appel runtime à faire.

## Relancer des lectures safe

Les retries changent le comportement. Garde la politique étroite — cet exemple relance les `GET` / `HEAD` / `OPTIONS` rejouables pour les statuts `0`, `429`, `502`, `503`, `504`, plafonne `Retry-After` à 30s, et s’arrête après deux retries ou sur abort :

```typescript twoslash
import { createHttpInterceptor, type HttpRequest, type HttpResponse } from '@defjs/core'

const retryableMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const retryableStatuses = new Set([0, 429, 502, 503, 504])

function isReplayable(request: HttpRequest): boolean {
  return typeof ReadableStream === 'undefined' || !(request.body instanceof ReadableStream)
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get('retry-after')
  if (!value) return 250

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000)

  const date = Date.parse(value)
  return Number.isNaN(date) ? 250 : Math.min(Math.max(0, date - Date.now()), 30_000)
}

function waitForRetryAfter(response: HttpResponse<unknown>, signal?: AbortSignal): Promise<void> {
  const delay = retryAfterMs(response)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(done, delay)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason)
    }

    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (!retryableMethods.has(request.method.toUpperCase()) || !isReplayable(request)) return next(request)

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request)
    if (!retryableStatuses.has(response.status) || attempt >= 2) return response
    await waitForRetryAfter(response, request.abort)
  }
})
```

Les erreurs d’intercepteur/Fetch throwées ne sont pas relancées par cette boucle — un échec de transport reject au lieu de produire un statut que cette boucle pourrait matcher. Relancer `POST` / `PUT` / `PATCH` / `DELETE` demande des octets rejouables, le support serveur, un contrat d’idempotence et une politique de statut revue. Le retry t’appartient : Core n’exporte pas `retryAfter()`.

Un intercepteur qui throw (ou reject) en dehors de cet exemple revient à l’appelant en
`EXT_INTERCEPTOR_FAILED`, avec la valeur jetée sur `cause` — voir [Erreurs](./errors.md). Thrower
`ERR_ABORTED` ou `ERR_TIMEOUT` est au contraire la façon dont un intercepteur exprime une annulation.

`next(request)` peut reject. Un échec de transport est un fault, pas une réponse au statut 0 : un
intercepteur qui veut en observer un met donc `try` / `catch` autour de `next`. Defjs l’attribue quand
même correctement — un reject venu du transport reste un fault `NET_*` et n’est pas mis sur le dos de
ton intercepteur.

## Wrapper des sessions WebSocket

Un intercepteur WebSocket peut appeler `next` au plus une fois. Si tu wrap la session, délègue explicitement les getters live et les membres de cycle de vie :

```typescript twoslash
import { createWebSocketInterceptor } from '@defjs/core'

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request)

  return {
    get bufferedAmount() {
      return session.bufferedAmount
    },
    get connection() {
      return session.connection
    },
    get state() {
      return session.state
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason)
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]()
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener)
    },
    onStateChange(listener) {
      return session.onStateChange(listener)
    },
    send(message: unknown) {
      session.send(message)
    },
  }
})
```

Spreader une session fige `state` / `connection` / `bufferedAmount` une fois. Préserve `closed`, `receive`, `close`, la délégation exacte de `[Symbol.asyncDispose]()`, et le cleanup des écouteurs, sauf si tu changes délibérément la propriété. Un wrapper doit renvoyer la promesse de teardown de la session interne, pas une promesse résolue sans rapport. Si une chaîne crée une session qui n’est pas livrée, Core la règle et la ferme ; si un intercepteur réussi renvoie une autre session, Core jette celle qui a été créée.

## Référence

Les factories renvoient des valeurs de transport taguées :

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — credentials Basic sur HTTP
- `basicAuthSSEInterceptor(provider, options?)` — credentials Basic sur SSE

`HttpRequest` peut inclure `endpoint`, `baseEndpoint`, `method`, `headers`, `body`, `queryParams`, `queryString`, `abort`, `timeout` et `operation` statique. C’est une valeur d’intégration transport — pas l’entrée parsée de l’appelant. `queryParams` est `new URLSearchParams(queryString)` après sérialisation. Un serializer de query configuré n’est pas appelé quand le builder n’a produit aucune query, et un `URLSearchParams` du builder est utilisé tel quel. Garde la validation de commande, la validation de sortie et le mapping d’erreurs de domaine dans leurs couches.

Les observateurs SSE/WebSocket sont des hooks de cycle de vie, pas du contrôle de flux. Désabonne les écouteurs WebSocket quand le propriétaire se termine. Les échecs d’observateur suivent le contrat du transport ; un intercepteur lui-même peut throw ou reject.

Journalise une allowlist revue : `operation` statique, méthode, statut, durée, code d’erreur stable. Ne journalise pas par défaut les URL résolues, query strings, en-têtes d’auth, corps, causes brutes, IDs d’événements SSE ou payloads WebSocket.

Les credentials Basic sont en base64, pas chiffrés. Utilise TLS, garde les providers de credentials scopés à la requête sur un serveur, ne journalise jamais l’en-tête généré. L’encodeur par défaut est `globalThis.btoa` ; passe `BasicAuthInterceptorOptions.encode` quand le runtime n’a pas `btoa` ou a besoin d’un encodeur revu.

Un intercepteur peut appliquer une politique de transport. Ce n’est pas de la validation d’entrée, de l’autorisation, ni de la propriété de ressource. Le code qui démarre un travail SSE/WebSocket long-lived utilise encore `await using` ou annule, ferme et attend manuellement la promesse terminale. Le HTTP ordinaire reste request-scoped et est géré avec son timeout / `AbortSignal` ; `Client` n’est pas `AsyncDisposable`.

## Recettes liées

- [Rafraîchir un Bearer une fois sur 401](../recipes/refresh-bearer-once.md)
- [Publier un SDK HTTP sans cacher execute](../recipes/publish-http-sdk.md)
- [Tester avec un handle Fetch local](../recipes/test-with-handle.md)
- [Annuler un appel HTTP](../recipes/cancel-http.md)
