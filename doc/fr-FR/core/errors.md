---
title: Errors
description: Branche sur un ensemble fermé de codes de fault pour les 404, timeouts, corps illisibles et échecs de transport.
---

# Errors

Traite un 404, un timeout ou un corps illisible en lisant le tuple error-first — pas en catchant des throws. Un `Fault` est un `Error` natif (`instanceof Error` est true), discriminé par un seul champ : `code`.

Il n’y a pas de `kind`. La classe d’un échec est le segment avant le premier `_` de son code : `NET_TIMEOUT` est un échec `NET` et `RES_STRUCT_MISMATCH` un échec `RES`. Lis le préfixe pour le tri grossier et le code entier pour le cas exact.

## Mise en place

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [err, user, response] = await client.execute(getUser({ id: 7 }))
if (err?.code === 'HTTP_STATUS' && err.status === 404) {
  console.log(err.data.message)
} else if (err?.code === 'NET_TIMEOUT') {
  console.log('timed out')
} else if (err?.code === 'RES_STRUCT_MISMATCH') {
  console.log('the response did not match what we declared', err.response.status)
} else if (!err) {
  console.log(user.name, response.status)
}
```

Comme l’ensemble est fermé, un `switch` sur `code` est exhaustif :

```typescript twoslash
import { createNetworkFault, ERR_ABORTED, type Fault } from '@defjs/core'

function triage(fault: Fault): string {
  switch (fault.code) {
    case 'HTTP_STATUS':
      return `status ${fault.status}`
    case 'RES_MEDIA_TYPE_INVALID':
    case 'RES_DECODE_FAILED':
    case 'RES_STRUCT_MISMATCH':
      return 'the contract did not hold'
    case 'NET_TIMEOUT':
    case 'NET_ABORTED':
    case 'NET_UNREACHABLE':
    case 'NET_BODY_INCOMPLETE':
      return 'retryable'
    case 'REQ_INPUT_INVALID':
    case 'REQ_OPTIONS_INVALID':
    case 'REQ_BUILD_FAILED':
      return 'fix the call'
    case 'EXT_INTERCEPTOR_FAILED':
    case 'EXT_HOOK_FAILED':
    case 'EXT_OBSERVER_FAILED':
      return 'fix the code you attached'
    case 'CAP_BUFFER_EXCEEDED':
    case 'CAP_QUEUE_OVERFLOW':
      return 'raise a declared limit or read faster'
    case 'ENV_UNSUPPORTED':
      return 'the host runtime is missing something'
  }
}

const example: Fault = createNetworkFault(ERR_ABORTED)
console.log(triage(example))
```

## Codes stables

| Classe | Codes                                                                  | Qui doit changer                                                 |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `HTTP` | `HTTP_STATUS`                                                          | Le pair a répondu non-2xx ; traite-le comme de la logique métier |
| `REQ`  | `REQ_INPUT_INVALID`, `REQ_OPTIONS_INVALID`, `REQ_BUILD_FAILED`         | L’appel ou la déclaration de l’endpoint                          |
| `NET`  | `NET_ABORTED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `NET_BODY_INCOMPLETE` | Personne, ou un retry                                            |
| `RES`  | `RES_MEDIA_TYPE_INVALID`, `RES_DECODE_FAILED`, `RES_STRUCT_MISMATCH`   | Il faut réconcilier la déclaration et le pair                    |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`     | Le code que tu as branché sur le pipeline                        |
| `CAP`  | `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`                            | Une limite déclarée, ou le rythme du consommateur                |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | La runtime hôte                                                  |

L’ensemble est fermé exprès : c’est ce qui garde un `switch` exhaustif. Les extensions rapportent leur propre détail via `cause`, pas via un nouveau code.

### Champs selon la forme

| Code          | `status` | `response`                                                     | `data`                               |
| ------------- | -------- | -------------------------------------------------------------- | ------------------------------------ |
| `HTTP_STATUS` | Toujours | Toujours ; n’a `body` que si `error` était déclaré et a décodé | Corps `error` décodé, ou `undefined` |
| `RES_*`       | Toujours | Toujours, métadonnées seules — **pas de `body`**               | Absent                               |
| Tout le reste | Absent   | Seulement là où le transport avait déjà des métadonnées        | Absent                               |

`cause` porte la valeur sous-jacente : un `StructError` pour un écart de struct, l’échec du parser pour une représentation illisible, ce qu’une extension a jeté.

## Formes de tuple par transport

```typescript twoslash
import type {
  DecodedResponse,
  EventStreamHandle,
  EventStreamOpenInfo,
  Fault,
  HttpMeta,
  WebSocketConnectionInfo,
  WebSocketSession,
} from '@defjs/core'

type HttpResult =
  [err: null, data: unknown, response: DecodedResponse<unknown> | HttpMeta] | [err: Fault, data: undefined, response: undefined]
type SseResult =
  | [err: null, stream: EventStreamHandle<unknown>, open: EventStreamOpenInfo]
  | [err: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]
type SocketResult =
  | [err: null, session: WebSocketSession<unknown>, connection: WebSocketConnectionInfo]
  | [err: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const results: [HttpResult, SseResult, SocketResult] | undefined = undefined
void results
```

Lors d’un échec HTTP, le troisième emplacement vaut `undefined` : le fault porte déjà les métadonnées de réponse qui existaient. C’est important parce que c’est le fault que tu passes à un handler, que tu logues ou que tu rethrow — les métadonnées doivent donc voyager _avec_ lui, pas à côté.

Pour SSE et WebSocket, le troisième emplacement est un instantané de démarrage, qui peut être présent même quand le démarrage a échoué. Après qu’un handle ou une session est renvoyé, les échecs ultérieurs vivent sur son cycle de vie — ils ne réécrivent jamais le tuple de démarrage déjà arrêté.

## Comment un corps est lu

`ok` est le seul embranchement, et un seul côté décode. `output` lit un corps 2xx ; `error` lit tout le reste. Omettre l’un veut dire que ce corps n’est jamais lu.

| Situation                                                | Résultat                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| 2xx, `output` déclaré, le corps décode                   | Succès ; `data` et `response.body` typés                        |
| 2xx, `output` omis                                       | Succès ; `data` vaut `undefined`, la réponse n’a pas de `body`  |
| Non-2xx, `error` déclaré, le corps décode                | `HTTP_STATUS` avec `data` typé                                  |
| Non-2xx, `error` omis                                    | `HTTP_STATUS` avec `data: undefined`                            |
| Le media type n’est pas celui qu’exige la représentation | `RES_MEDIA_TYPE_INVALID`, signalé **avant** la lecture du corps |
| Les octets ne sont pas cette représentation              | `RES_DECODE_FAILED`                                             |
| La valeur n’est pas ce struct                            | `RES_STRUCT_MISMATCH`                                           |
| Un corps illisible du côté que tu n’as **pas** déclaré   | Entièrement ignoré — voir plus bas                              |

C’est la dernière ligne qui mérite d’être retenue. Si tu as déclaré `output` mais pas `error`, une 500 dont le corps est du JSON malformé est signalée comme `HTTP_STATUS` avec `status: 500`. Tu as dit que les corps d’erreur ne t’intéressaient pas, et cela inclut de ne pas t’intéresser au fait que l’un n’ait pas pu être lu.

Le décodage a lieu une seule fois, après la chaîne d’intercepteurs. Une réponse qu’un intercepteur a construite avec `makeResponse(...)` passe par la même vérification de media type et le même struct qu’une réponse venue du réseau.

`HttpResponse.ok` signifie seulement `200 <= status < 300`. Un échec de transport est un fault, jamais une réponse — il n’y a pas de réponse au statut 0 qui en tiendrait lieu.

## Restreindre une union de corps d’erreur

Un seul struct `error` couvre tous les statuts non-2xx : quand les formes diffèrent, tu déclares donc une union. Ce que tu peux faire ensuite avec `fault.data` dépend entièrement de la façon dont tu as déclaré cette union — la bibliothèque te rend exactement le type que tu as demandé.

`struct.or(...)` produit une union simple, que TypeScript ne peut pas restreindre tout seul. Teste le champ dont tu as besoin :

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` restreint sur un champ que le corps porte réellement, la forme confortable quand l’API tague déjà ses erreurs :

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('validation'), fields: struct.array(struct.string()) }),
  struct.object({ kind: struct.literal('rateLimit'), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS') {
  switch (fault.data.kind) {
    case 'validation':
      console.log(fault.data.fields.length)
      break
    case 'rateLimit':
      console.log(fault.data.retryAfter)
      break
  }
}
```

Quand l’API met le statut **dans** le corps, discrimine là-dessus plutôt que sur `fault.status` :

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.discriminatedUnion('status', [
  struct.object({ status: struct.literal(404), resource: struct.string() }),
  struct.object({ status: struct.literal(429), retryAfter: struct.number() }),
])

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && fault.data.status === 429) {
  console.log(fault.data.retryAfter)
}
```

Cette dernière forme est à préférer là où l’API la permet. `fault.status` est le nombre de la couche HTTP, qu’un proxy, une gateway ou un CDN peuvent réécrire ; `data.status` a été décodé du corps que ton struct `error` a affirmé — y accéder prouve donc que le backend l’a produit.

Une union non discriminée qui ne se restreint pas est une propriété de la déclaration, pas de la bibliothèque : elle te rend le type que tu as déclaré. Ajoute un discriminant au struct si tu en veux un.

## Démarrage et après ouverture

SSE valide le statut, `text/event-stream` et la présence d’un corps avant de resolve le handle. Non-2xx → `HTTP_STATUS`. Mauvais media type → `RES_MEDIA_TYPE_INVALID`. Corps manquant → `RES_DECODE_FAILED`. L’instantané d’ouverture peut tout de même atterrir dans le troisième emplacement du tuple.

Le démarrage WebSocket couvre le handshake plus la première ouverture physique. Un échec du constructeur, une fermeture avant l’ouverture, un timeout ou une annulation produisent tous un tuple de démarrage. Un instantané de connexion peut exister même si le socket n’a jamais atteint `open`.

| Transport | Après le démarrage                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSE       | L’itérateur reject sur une erreur fatale ; `stream.closed` resolve avec `kind: 'error'` et le `code` du fault                                                          |
| WebSocket | `onRuntimeError` pour les échecs de message/file/heartbeat ; `receive` échoue sur les erreurs terminales ; `session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP      | La promesse d’execute settle une fois. Le code d’intercepteur et de callback peut encore throw en dehors de la normalisation du tuple                                  |

`NET_ABORTED` / `NET_TIMEOUT` décrivent ce que l’appelant a vu au démarrage. Tu fermes quand même un stream ou une session renvoyés et tu await leur promesse terminale.

## Logging d’Error natif et cause

Les faults sont des instances d’`Error` natif : aucun adaptateur de diagnostic n’est nécessaire. `String(fault)` donne la forme native stable `DefjsFault: <message>`. `code` et les champs de variante — `status`, `response`, `data` — restent énumérables pour le logging structuré ; `name` et la chaîne native `cause` ne le sont pas.

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

Restreins `fault.cause instanceof StructError` avant d’appeler `format()`, `flatten()` ou `prettify()`. Ces helpers vivent sur la cause du Struct ; ils ne sont pas copiés sur le fault. Ne fais pas parser `message` ou `String(fault)` par le flux de contrôle — le contrat, c’est `code` et un `status` revu.

## Référence

| Branche                   | Test de flux de contrôle           | Champs stables utiles                | Souvent absent / sensible                 |
| ------------------------- | ---------------------------------- | ------------------------------------ | ----------------------------------------- |
| Politique de statut HTTP  | `fault.code === 'HTTP_STATUS'`     | `fault.status`, `fault.data` revu    | Corps, headers, URL, `cause`              |
| Annulation par l’appelant | `fault.code === 'NET_ABORTED'`     | `code`                               | Raison d’annulation et stack              |
| Timeout                   | `fault.code === 'NET_TIMEOUT'`     | `code`                               | URL de requête et cause sous-jacente      |
| Le contrat a cassé        | `fault.code.startsWith('RES_')`    | `code`, `fault.response.status` revu | Issues de Struct, corps, valeurs d’entrée |
| Ton propre code a throwé  | `fault.code.startsWith('EXT_')`    | `code`, `cause`                      | Ce que l’extension a attaché              |
| Runtime de stream/session | `stream.closed` / `session.closed` | `kind` et `code` terminaux           | Payloads d’événements, frames, causes     |

Traite `cause`, `data`, les headers et corps de réponse, les URLs, les issues de Struct, les valeurs d’entrée et les stacks comme sensibles. Un résumé conservateur :

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`, `createPreflightFault`, `createDecodeFault`, `createHttpStatusFault` et `createUndecodedHttpStatusFault` construisent ces valeurs d’Error natif. Les échecs de requête normaux sont toujours renvoyés dans le tuple ; ils ne sont pas jetés simplement parce qu’ils héritent du comportement d’Error natif. `ERR_ABORTED` et `ERR_TIMEOUT` sont les causes partagées que le normaliseur de transport reconnaît.

## Recettes liées

- [GET avec un 404 déclaré](../recipes/get-declared-404.md)
- [Annuler un appel HTTP](../recipes/cancel-http.md)
