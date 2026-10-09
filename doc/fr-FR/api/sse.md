---
title: SSE
description: defineEventStream, options d’execute, et le handle de flux.
---

# SSE

Déclare un flux d’événements, exécute-le, itère les événements, puis ferme.

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`, map `events`, `method` optionnel (défaut `'GET'`), `input` optionnel, `builder` et `error` optionnels, limites de buffer/queue.
- **Renvoie** un endpoint. Appelle avec l’entrée pour obtenir un `EventStreamCommand`.

```ts twoslash
import { defineEventStream, struct } from '@defjs/core'

const ticks = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/ticks',
  events: { message: struct.object({ text: struct.string() }) },
})
```

## executeEventStreamCommand() {#executeEventStreamCommand}

```ts
function executeEventStreamCommand(
  clientConfig: ClientConfig,
  command: EventStreamCommand,
  options?: EventStreamExecuteOptions,
): Promise<StreamAwaitResult>
```

Point d’entrée bas niveau pour `client.execute`. Préfère le client dans le code applicatif.

- **Renvoie** `[null, stream, open]` ou `[error, undefined, open?]`. Quand `error` est déclaré, le fault est un `Fault` de ce struct ; sinon c’est `Fault<undefined>`.

## Options d’execute

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

Mêmes règles d’annulation que HTTP : `abort` ou `timeout`, pas les deux.

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open` est l’instantané de démarrage ; après reconnect il peut changer — lis aussi `stream.open`. Préfère `await using stream = handle` pour le nettoyage d’une portée possédée. Le disposer arrête la lecture et le travail de reconnect Defjs et attend que son reader lock soit relâché ; il ne promet pas qu’une promesse `ReadableStream.cancel()` bloquée, contrôlée par le provider, se terminera. `close()` / `closed` manuels restent disponibles.

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

Les implémentations structurelles d’`EventStreamHandle` doivent maintenant implémenter `[Symbol.asyncDispose]()` et renvoyer le même chemin de teardown possédé. C’est un changement breaking à la compilation pour les handles custom ; le code qui ne reçoit que des handles renvoyés par Defjs n’a aucune nouvelle exigence d’appel runtime.

### EventStreamOpenInfo {#EventStreamOpenInfo}

```ts
interface EventStreamOpenInfo {
  response: HttpResponse<unknown>
  url: string
}
```

### EventStreamCloseInfo {#EventStreamCloseInfo}

```ts
type EventStreamCloseInfo =
  | { kind: 'eof'; reason?: string; cause?: unknown }
  | { kind: 'aborted'; reason?: string; cause?: unknown }
  | { kind: 'error'; code: EventStreamFaultCode; reason?: string; cause?: unknown }
```

`EventStreamFaultCode` : `'CAP_BUFFER_EXCEEDED' | 'CAP_QUEUE_OVERFLOW' | 'EXT_HOOK_FAILED' | 'EXT_OBSERVER_FAILED' | 'NET_TIMEOUT' | 'NET_UNREACHABLE' | 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID'`.

## Map d’événements

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

Un struct d’événement `string` garde le texte `data` brut. Tout autre kind est du texte JSON : `JSON.parse`, puis le struct. Un `struct.literal` nu a donc besoin de texte JSON, pas d’un token non quoté. Les corps `error` de handshake suivent la même règle de kind que HTTP : `string` est du texte, `blob` / `file` sont des blobs, `arrayBuffer` est des octets, et tout le reste est du JSON.

Le reconnect vit sur le client (`withSSEReconnect`). Le `jitter` SSE est un **facteur multiplicatif 0–1**, comme WebSocket.

Voir le [guide SSE](/core/sse) et [Consommer un flux SSE](/recipes/consume-sse).

## EventStreamDefinition {#EventStreamDefinition}

`path`, `events`, `method` / `input` / `builder` / `error` optionnels, limites de buffer et de queue. La forme de requête suit HTTP, y compris `body`. `GET` et `HEAD` ne peuvent pas renvoyer un corps.

## EventStreamEndpoint {#EventStreamEndpoint}

Renvoyé par `defineEventStream`. Appelle avec l’entrée pour obtenir un `EventStreamCommand`.

## EventStreamRequestShape {#EventStreamRequestShape}

Mêmes champs que `HttpRequestShape` pour la méthode et le path du flux.

## EventStreamCommand {#EventStreamCommand}

Commande SSE opaque. Passe-la à `client.execute`.

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` ou `[error, undefined, open?]`.

## EventStreamData {#EventStreamData}

Payload d’événement parsé, inféré depuis une map `EventStructs`.
