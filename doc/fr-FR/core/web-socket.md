---
title: WebSocket
description: Démarre une session JSON typée, reçois et envoie des enveloppes, puis ferme et attends closed.
---

# WebSocket

Démarre → reçois → envoie → relâche avec `await using`. Tu possèdes le désabonnement et le dispose. `close()` / `closed` manuels restent disponibles ; les clients, providers et intercepteurs ne ferment pas les sessions tout seuls.

## Basic Setup

```typescript twoslash
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
  outgoing: struct.object({ type: struct.literal('send'), text: struct.string() }),
})

const [error, session, startupConnection] = await client.execute(room())
if (error) {
  console.error(error.code, startupConnection?.generation)
} else {
  await using ownedSession = session
  const unsubscribe = ownedSession.onRuntimeError((cause) => console.error('runtime', cause))
  try {
    ownedSession.send({ type: 'send', text: 'Hello' })
    // wire: {"type":"send","text":"Hello"}
    for await (const message of ownedSession.receive) {
      console.log(message.type, message.text)
      break
    }
  } finally {
    unsubscribe()
  }
}
```

## Un struct par direction

`incoming` est un struct pour chaque frame texte. `outgoing` est un struct pour `session.send(...)`. Modélise plusieurs kinds avec `struct.discriminatedUnion`. L’alias sur ces champs est le nom wire dans les deux sens. Il n’y a pas d’enveloppe de type séparée ni de normalizer.

```json
{ "type": "message", "text": "Hello" }
```

Les frames entrantes texte, `ArrayBuffer`, typed-array et `Blob` sont lues en UTF-8, parsées en JSON, puis vérifiées contre `incoming`. Le JSON malformé et les échecs de struct vont à `session.onRuntimeError` et ne sont pas mis en queue. La session reste ouverte. Les frames qui ne sont ni texte, ni octets, ni `Blob` sont ignorées. Il n’y a pas de `withWebSocketOnInvalidEvent`.

`session.send(...)` valide et sérialise de façon synchrone : encode du struct, puis `JSON.stringify`. Il envoie tout de suite quand c’est open, met en queue pendant `reconnecting` quand une queue sortante est activée, et throw `InvalidStateError` quand ce n’est pas writable. Il throw aussi quand il n’y a pas de struct sortant, que le payload échoue au struct, que la queue sortante est désactivée ou pleine, ou que le send natif échoue. Une liste `protocols` statique sur la définition est le contrat de l’endpoint (par exemple `graphql-transport-ws`). Les options d’execute et `withWebSocketProtocols` peuvent encore l’overrider ; un token dans un sous-protocole appartient à `beforeConnect` ou à un intercepteur, pas au builder. Le builder ne peut renvoyer que `path` et `query`.

`receive` est à un seul consommateur. Un second itérateur est rejeté.

## Instantanés d’état

| Membre                     | Sens                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `state`                    | `idle`, `connecting`, `open`, `reconnecting`, `closing`, `closed`, `aborted`, ou `error`      |
| `connection`               | Dernière connexion physique : `generation`, URL, protocole négocié, extensions si disponibles |
| `bufferedAmount`           | Nombre d’octets natifs non envoyés, ou `0` sans socket physique                               |
| `receive`                  | Itérable async à un consommateur, de messages entrants validés                                |
| `onStateChange(listener)`  | S’abonne aux transitions d’état logique ; renvoie le désabonnement                            |
| `onRuntimeError(listener)` | S’abonne aux erreurs runtime hors démarrage ; renvoie le désabonnement                        |
| `closed`                   | Promesse du résultat de fermeture terminal logique                                            |

`open` = socket physique ouvert. `reconnecting` inclut la préparation + le délai avant un remplacement. `connection.generation` s’incrémente pour chaque socket physique qui atteint `open`. Le tuple `startupConnection` reste le premier instantané réussi ; `session.connection` avance.

Échec de démarrage → `[error, undefined, connection?]`. Un échec de constructeur avant l’ouverture peut n’avoir aucune connexion ; un timeout/close pendant le démarrage peut encore fournir un instantané. Après le retour de la session, les erreurs runtime passent par les observateurs, `receive` et `closed` — pas un second tuple d’execute.

```typescript twoslash
import type { Fault, WebSocketConnectionInfo, WebSocketSession } from '@defjs/core'

type SocketResult<TIncoming, TOutgoing> =
  | [error: null, session: WebSocketSession<TIncoming, TOutgoing>, connection: WebSocketConnectionInfo]
  | [error: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const result: SocketResult<unknown, never> | undefined = undefined
void result
```

## Reconnect

Le reconnect est opt-in. Pas d’objet `reconnect` → une fermeture physique termine la session logique. Une fois configuré, les défauts sont `attempts: 3`, `delayMs: 1000`, `factor: 2`, `maxDelayMs: 30000`, `jitter: 0`. `attempts` compte les retries après la tentative initiale ; `attempts: 0` désactive. Le prédicat par défaut accepte chaque résultat de close.

```ts
import { createClient, defineWebSocket, struct, withEndpoint, withWebSocketReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://chat.example.com'),
  withWebSocketReconnect({
    attempts: 3,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldReconnect({ attempt, code, wasClean }) {
      return attempt <= 3 && (wasClean !== true || code === 1006)
    },
  }),
)
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
})
const [error, session] = await client.execute(room())
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`shouldReconnect` reçoit la prochaine tentative de retry, la cause de close, le code, la reason et `wasClean`. Un `session.close(...)` manuel n’entre pas dans le prédicat. Une préparation ou une politique qui throw termine la session logique avec une erreur.

Le jitter de backoff WebSocket est **multiplicatif** (`jitter: 0.2` → délai entre `0.8x` et `1.2x`). Le jitter SSE est un facteur multiplicatif 0–1, comme WebSocket. Les valeurs de delay/factor/jitter/attempt sont validées avant le constructeur ; les délais de timer ne peuvent pas dépasser `2_147_483_647` ms.

`beforeConnect({ attempt, signal })` tourne avant le constructeur initial et chaque reconnect. Passe son signal au refresh de token pour que l’annulation arrête à la fois la prep et le connect.

## Heartbeat

Opt-in au scope execute ou client. L’intervalle envoie `message()` à travers le struct sortant. Un `isAck(message)` optionnel reconnaît un ack — ce message efface le timeout et n’est **pas** livré à `receive`.

```ts
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.discriminatedUnion('type', [struct.object({ type: struct.literal('pong'), ok: struct.boolean() })]),
  outgoing: struct.object({ type: struct.literal('ping') }),
})

const [error, session] = await client.execute(room(), {
  heartbeat: {
    intervalMs: 30_000,
    timeoutMs: 10_000,
    message: () => ({ type: 'ping' }),
    isAck: (message) => message.type === 'pong',
  },
})
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`intervalMs` et `timeoutMs` doivent être des timers finis positifs ≤ `2_147_483_647`. Le message de heartbeat doit être valide pour le struct sortant. Les échecs de sérialisation, de send natif, de classification d’ack et de timeout sont fatals pour la session logique — ils ne deviennent pas des reconnects ordinaires.

## Queues

| Réglage                | Valeur requise                                | Comportement                                                                                                                |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `maxIncomingQueueSize` | Entier sûr positif                            | Borne les messages parsés en attente de `receive` et les frames brutes en attente de transform. Overflow → `state: 'error'` |
| `maxOutgoingQueueSize` | Entier sûr non négatif optionnel ; défaut `0` | FIFO seulement tant que `state === 'reconnecting'`. Pleine/désactivée → `send(...)` throw                                   |

Les frames sortantes en queue sont flushées avant que le socket de remplacement publie `open`. Les frames déjà envoyées sur un socket précédent ne sont jamais rejouées auto. Les queues de reconnect sont pour les messages que tu envoies pendant le reconnect — pas pour reconstruire l’état de l’app.

L’overflow entrant vide la séquence en attente, fait échouer `receive`, arrête la session, résout `session.closed` avec `kind: 'error'`. Garde le consommateur assez rapide ou relève la borne d’après la taille/mémoire mesurée.

## Protocoles et authentification

Les `protocols` de définition, `withWebSocketProtocols(...)` du client, et `protocols` d’execute posent la liste de sous-protocoles du constructeur. Précédence : exécution → client → définition. La première liste définie est copiée pour la session logique et réutilisée au reconnect.

Les constructeurs WebSocket navigateur n’acceptent pas d’en-têtes de handshake arbitraires, et le builder ne peut pas renvoyer `headers` ni `body`. Defjs convertit `http:` → `ws:` et `https:` → `wss:`, encode les placeholders de path une fois, et utilise les mêmes règles de query que HTTP : scalaires et clés répétées par défaut, `withQuerySerializer` pour les objets imbriqués, et pas d’appel de serializer quand il n’y a pas de query.

`withCredentials(true)` est les credentials Fetch pour HTTP/SSE — pas l’auth WebSocket. Utilise une politique cookie/session revue, un sous-protocole, ou un ticket de connexion de courte durée. Ne mets pas de credentials généraux ni de secrets longue durée dans la query string.

## Fermeture et propriété

`session.close(code?, reason?)` demande la fermeture terminale et arrête le heartbeat. Le code doit être `1000` ou `3000..4999` ; la reason ≤ 123 octets UTF-8. Des arguments de close invalides throw avant de changer l’état. Utilise-le avec `await session.closed` quand tu as besoin d’une raison de close manuel ou du résultat terminal logique.

```typescript twoslash
import type { WebSocketSession } from '@defjs/core'

async function observeSession(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  console.log(ownedSession.state)
}

void observeSession
```

`session.closed` est l’instantané terminal logique : `'closed'`, `'aborted'`, ou `'error'`, avec `code` / `reason` / `wasClean` natifs optionnels et une `cause` pour aborted/error. Les champs de close natif observés l’emportent sur le fallback demandé par le propriétaire.

Le disposer async standard demande une fermeture native best-effort, puis attend le teardown du cycle de vie, de la pompe de messages, des timers, des écouteurs, de la queue et des références de socket possédés par Defjs. Si un événement de close n’est pas observé dans la seconde, le teardown est forcé et le disposer peut reject avec un `DOMException` nommé `TimeoutError` ; cela ne prouve pas que la connexion TCP physique s’est fermée. Les appels répétés du disposer partagent le même teardown. Les implémentations structurelles de session custom doivent maintenant fournir le même contrat `[Symbol.asyncDispose](): PromiseLike<void>`.

## Frontière GraphQL

Defjs fournit un struct entrant, un struct sortant, et un cycle de vie de session logique. Il n’implémente **pas** un protocole applicatif WebSocket. Les fonctions GraphQL-over-WebSocket — connection init, IDs d’opération, `next`/`error`/`complete`, dispose, replay d’abonnement — sont hors du contrat core.

Utilise un client de protocole comme `graphql-ws` quand le serveur exige ce protocole, ou modélise les frames avec `defineWebSocket(...)`. Pose un sous-protocole statique comme `graphql-transport-ws` sur `protocols`. Un struct seul ne négocie pas la sémantique GraphQL.

## Recettes liées

- [Ouvrir une session WebSocket](../recipes/websocket-session.md)
- [Consommer un flux SSE](../recipes/consume-sse.md)
