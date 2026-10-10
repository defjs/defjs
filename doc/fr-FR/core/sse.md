---
title: Server-Sent Events
description: Consomme un flux SSE typé, ferme-le, et attends la promesse closed terminale.
---

# Server-Sent Events

Ouvre un flux, itère-le, puis relâche le handle possédé avec `await using`. `close()` et `closed` manuels restent disponibles ; les clients et plugins ne disposent pas un flux renvoyé à ta place.

## Basic Setup

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: {
    message: struct.object({ text: struct.string() }),
  },
})

const [error, stream] = await client.execute(notifications())
if (error) {
  console.error(error.code)
} else {
  await using ownedStream = stream
  for await (const event of ownedStream) {
    if (event.event === 'message') console.log(event.data.text)
  }
}
```

## Définir le flux

`defineEventStream(...)` a besoin de `events`, d’un `maxBufferSize` entier sûr positif, d’un `maxQueueSize` entier sûr positif, et d’un `path` relatif. La méthode vaut `GET` par défaut.

La forme de requête suit HTTP : `builder` qui renvoie `path`, `query`, `headers` et `body`. `GET` / `HEAD` ne peuvent pas renvoyer un corps. Un struct `error` déclaré type le fault de démarrage et décode un corps de handshake non-2xx selon le kind du struct (`string` texte, `blob` / `file` blob, `arrayBuffer` octets, sinon JSON). Defjs envoie `Accept: text/event-stream` quand tu n’as pas déjà posé `Accept`. Un `input` déclaré exige toujours un `builder` explicite, même si l’entrée a déjà la forme de la requête. Seules les définitions sans `input` peuvent omettre `builder`.

Un flux logique peut couvrir plusieurs tentatives Fetch physiques **quand** tu optes pour le reconnect. Sans `withSSEReconnect`, les échecs réseau transitoires et de lecture de flux terminent le flux logique. Tu as toujours un handle et un itérateur async quand l’ouverture réussit.

## Ouvrir et inspecter

`client.execute(...)` ne résout qu’après les contrôles de statut, de content-type et de corps :

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: { message: struct.string() },
})

const [error, stream, startupOpen] = await client.execute(notifications())
if (error) {
  console.error(error.code, startupOpen?.response.status)
} else {
  console.log(stream.open.response.status, startupOpen.response.status, stream.open.url)
  stream.close('example-finished')
  await stream.closed
}
```

La réponse doit réussir, avoir l’essence de media type `text/event-stream`, et avoir un corps. Démarrage non-2xx → `HTTP_STATUS`. Quand `error` est déclaré, ce fault porte le corps de handshake décodé ; un mauvais media type est `RES_MEDIA_TYPE_INVALID` et un corps qui ne peut pas être lu comme le kind déclaré est `RES_DECODE_FAILED`. Un instantané de réponse peut encore occuper le troisième slot du tuple quand la validation échoue après l’arrivée de la réponse.

`startupOpen` est l’instantané initial. `stream.open` est live et change aux ouvertures physiques suivantes. Garde la valeur du tuple quand la première réponse compte.

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## Décoder les événements

Nom d’événement wire → `events[eventName]` ; sinon `events.default`. Pas de Struct correspondant → l’événement n’est pas livré. Champ SSE `event` manquant → nom logique `message`.

Le `data` SSE commence en texte. Un struct `string` garde ce texte. Tout autre kind est du JSON : parse le texte, puis décode avec le struct. `struct.object`, `struct.number`, `struct.boolean`, `struct.any` et `struct.unknown` sont du JSON, pas du texte trimé. Un token nu comme `ping` ne satisfait pas `struct.literal('ping')` ; le data doit être du JSON. Un serveur qui envoie la string JSON `"abc"` satisfait quand même `struct.string()` : la valeur livrée est ce texte brut, guillemets compris, et n'est pas décodée en JSON vers `abc`.

Valeur émise : `event`, `data` décodé, `id` optionnel non vide. Avec `default`, les noms d’événement inconnus sont `string` dans l’union inférée.

## Observer les événements invalides

Les événements invalides ou non déclarés sont jetés, pas mis en queue. `withSSEOnInvalidEvent(...)` peut observer l’ID brut, le nom, le data texte, plus `missing-struct` ou `validation-failed` et une cause optionnelle.

```ts
import { createClient, withEndpoint, withSSEOnInvalidEvent } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEOnInvalidEvent(({ reason, message, cause, signal }) => {
    if (signal.aborted) return
    console.info('Dropped SSE event', {
      reason,
      event: message.event,
      hasCause: cause !== undefined,
    })
  }),
)
```

L’observateur tourne à la frontière de transform. Son échec est isolé sauf si le signal de la tentative active est aborted. Garde-le court ; ne traite pas le data d’événement brut comme fiable.

## Reconnect

**Changement de comportement :** le reconnect SSE est opt-in. Sans `withSSEReconnect(...)`, les échecs réseau et de lecture de flux ne sont **pas** relancés (comme `attempts: 0`). Passe `withSSEReconnect({ attempts: 3 })` (ou un autre budget revu) pour relancer ces échecs. Un EOF normal n’est pas relancé. La validation de statut/content-type, les limites du parser, les échecs de transform de message, l’overflow de queue et l’EOF normal restent terminaux pour le flux logique.

```ts
import { createClient, withEndpoint, withSSEReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEReconnect({
    attempts: 3,
    delayMs: 1_000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.5,
    shouldReconnect({ attempt, open }) {
      return attempt <= 3 && (open?.response.status ?? 0) !== 401
    },
  }),
)
```

`attempts` compte les retries après la tentative initiale ; il vaut `3` par défaut quand un objet reconnect est posé. `attempts: 0` désactive le retry. Omettre `withSSEReconnect` désactive aussi le retry. `delayMs` est l’intervalle initial ; `factor` le fait croître ; `maxDelayMs` plafonne la base. Le `jitter` SSE est un **facteur multiplicatif 0–1**, comme WebSocket. Un champ `retry:` du flux met à jour l’intervalle courant. Un callback de politique qui renvoie false, throw ou reject termine le flux logique.

Le dernier ID d’événement parsé devient `Last-Event-ID` sur une tentative suivante. Une tentative suivante renvoie la même requête Fetch, méthode et corps compris. Connais la sémantique de replay du serveur avant de reconnecter.

## Limites de buffer et de queue

Les deux doivent être des entiers sûrs positifs. L’overflow est fatal — pas de jet silencieux des événements plus anciens.

| Limite          | Protège                                                | Code terminal         |
| --------------- | ------------------------------------------------------ | --------------------- |
| `maxBufferSize` | Ligne/événement SSE incomplet ou trop gros au parse    | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | Événements produits plus vite que le seul consommateur | `CAP_QUEUE_OVERFLOW`  |

Un flux fatal vide aussi les événements bufferisés, annule le corps actif, reject l’itérateur, et résout `stream.closed` avec `kind: 'error'`.

## Fermer et disposer

`EventStreamHandle` : un instantané d’ouverture live, une promesse terminale, un `close`, un itérateur async, et un disposer async standard.

```typescript twoslash
import type { EventStreamCloseInfo, EventStreamHandle, EventStreamOpenInfo } from '@defjs/core'

interface StreamApi<T> extends AsyncIterable<T>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}

const handle = null as unknown as EventStreamHandle<string>
const api: StreamApi<string> = handle
void api
```

Codes terminaux : `eof`, `aborted`, ou `error`. Un résultat `error` porte aussi un `EventStreamFaultCode` : `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `RES_DECODE_FAILED`, ou `RES_MEDIA_TYPE_INVALID`.

`close(reason)` abort la tentative active, ferme la queue, se règle en `aborted`. Un `break` / `return` / throw de boucle invoque le return de l’itérateur et ferme avec `iterator-return`. Le code qui exécute la commande possède la fermeture.

`await using` appelle le même chemin de close possédé et attend que le travail de lecture/reconnect Defjs se soit arrêté et que le reader lock actif ait été relâché. Il est volontairement borné autour d’une promesse `ReadableStream.cancel()` contrôlée par le provider qui ne se règle jamais, donc il ne garantit pas qu’une telle promesse de provider se soit terminée. `stream.close(reason)` explicite plus `await stream.closed` reste valide quand tu as besoin d’une raison ou du résultat terminal.

Les implémentations structurelles custom d’`EventStreamHandle` doivent maintenant fournir `[Symbol.asyncDispose](): PromiseLike<void>` et le relier au même cycle de vie. C’est un changement breaking à la compilation pour les implémenteurs ; les consommateurs qui ne reçoivent qu’un handle Defjs n’ont rien de nouveau à invoquer au runtime.

Le contrat lib minimum validé et supporté par le dépôt est `ES2022`, `ESNext.Disposable`, `DOM` et `DOM.Iterable`, le dépôt étant épinglé sur TypeScript 7. Ces quatre entrées sont vérifiées ensemble comme une seule baseline ; cela ne prétend pas que chaque déclaration force indépendamment chaque entrée, et les compilateurs plus anciens non testés ne sont pas promis. Un client HTTP ordinaire n’est pas `AsyncDisposable` ; gère chaque requête avec son timeout ou son `AbortSignal`.

Garde credentials, data d’événement, IDs d’événement, causes et URL de flux hors des logs de routine. `withCredentials(true)` affecte les cookies Fetch pour SSE ; il ne configure pas l’auth WebSocket.

## Recettes liées

- [Consommer un flux SSE](../recipes/consume-sse.md)
- [Annuler un appel HTTP](../recipes/cancel-http.md)
