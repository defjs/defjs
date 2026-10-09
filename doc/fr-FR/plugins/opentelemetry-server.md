---
title: OpenTelemetry server
description: Active l’instrumentation de transport Defjs sortante avec ton propre Tracer et un Meter optionnel.
---

# OpenTelemetry server

Active l’instrumentation sortante quand tu crées le client. `@defjs/opentelemetry-server` append des intercepteurs HTTP, SSE et WebSocket. Ce n’est **pas** de l’instrumentation serveur inbound, et ça n’initialise **pas** un SDK OpenTelemetry.

## Basic Setup

Initialise le SDK ailleurs. Passe ses objets API :

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { metrics, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const meter = metrics.getMeter('orders-service')
const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer, meter }))

const [error] = await client.execute(readOrders())
if (error) console.error(error.code)
```

`tracer` est requis. `meter` est optionnel — omets-le pour désactiver les métriques du package. Pas de `propagator` → l’adapter construit un propagator composite W3C Trace Context + W3C Baggage. Il ne lit ni n’initialise la config SDK globale pour toi.

`withOpenTelemetryServer(options)` renvoie une `ClientOption` core. Applique-la à `createClient` pour qu’un intercepteur soit appendé par transport activé. HTTP, SSE et WebSocket sont activés par défaut ; `{ enabled: false }` désactive un transport.

L’adapter peut créer de la télémétrie de transport même quand la requête échoue à la couche transport. Si quelque chose est exporté dépend de ton SDK et de tes exporters.

## Portée

Tu possèdes l’init SDK, providers, exporters, processors, context, sampling, redaction, flush et shutdown. Ce package consomme le `Tracer`, le `Meter` optionnel et le `TextMapPropagator` optionnel que tu passes. Il n’inclut aucun redactor ni politique de clés sensibles.

Pas de cache, retries, spans au niveau message, ni politique d’outcome de commande applicative. Destiné au Node.js côté serveur. Le package publié veut Node.js 22+, peers `@defjs/core`, `@opentelemetry/api` 1.x, `@opentelemetry/core` 2.x.

API publique : `withOpenTelemetryServer` plus `OpenTelemetryServerOptions`, `OpenTelemetryServerHttpOptions`, `OpenTelemetryServerSSEOptions`, `OpenTelemetryServerWebSocketOptions`.

## Options et hooks

Les hooks siègent à côté du transport qu’ils changent. Le `startSpanHook(request)` synchrone s’exécute avant la création du span et renvoie les `Attributes` initiaux ; les attributs applicatifs sont appliqués en dernier et peuvent remplacer les intégrés. `requestHook` et `responseHook` reçoivent le span déjà créé et peuvent renvoyer `void` ou une Promise. Tout échec enregistre `defjs.otel.hook.error` sans arrêter l’opération ; un start hook en échec retombe sur les attributs intégrés.

```typescript twoslash
import { createClient, createResolvedRequestUrl, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    http: {
      startSpanHook(request) {
        const attributes = { 'app.operation': request.operation ?? 'unclassified' }
        if (!request.baseEndpoint) return attributes
        const url = createResolvedRequestUrl(request.baseEndpoint, request.endpoint)
        if (request.queryString) url.search = request.queryString
        url.searchParams.delete('access_token')
        return { ...attributes, 'url.full': url.href }
      },
      requestHook(span, request) {
        span.setAttribute('app.request.started', true)
      },
      responseHook(span, response) {
        span.setAttribute('app.status', response.status)
      },
    },
    sse: { enabled: false },
    webSocket: { enabled: false },
  }),
)

void client
```

Signatures des hooks :

- Les trois transports : `startSpanHook(request): Attributes` (synchrone, avant la création du span)
- HTTP : `requestHook(span, request)` et `responseHook(span, response, request)`
- SSE : `requestHook(span, request)` et `responseHook(span, stream, request)`
- WebSocket : `requestHook(span, request)` et `responseHook(span, session, request)`

Un objet de transport vide active ce transport. Les anciens switches booléens de transport et les anciens hooks top-level sont rejetés — utilise des objets d’options de transport et des hooks scopés au transport.

## Identité d’opération et propagation

Pose un `operation` statique sur `defineRequest`, `defineEventStream` ou `defineWebSocket` quand la commande a une identité stable. L’adapter l’utilise dans les noms de span et comme `defjs.operation`. Il ne dérive jamais l’identité d’un path résolu, d’un identifiant, d’un tenant ou d’une query string :

```typescript twoslash
import { defineEventStream, defineRequest, defineWebSocket, struct } from '@defjs/core'

const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})
const orderEvents = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  operation: 'orders.watch',
  path: '/orders/events',
  events: { update: struct.object({ id: struct.number() }) },
})
const orderSocket = defineWebSocket({
  maxIncomingQueueSize: 100,
  operation: 'orders.connect',
  path: '/orders/socket',
  incoming: struct.object({ id: struct.number() }),
})

void readOrders
void orderEvents
void orderSocket
```

Les noms de span deviennent `GET orders.read`, `SSE orders.watch`, `WebSocket orders.connect`. Sans `operation`, le fallback est method / `SSE` / `WebSocket`, et `defjs.operation` est omis.

HTTP et SSE injectent les champs propagés dans les en-têtes de requête. Les instances `Headers` existantes sont réutilisées et mutées ; sinon une nouvelle `Headers` est créée. La propagation query WebSocket est **opt-in** (les navigateurs ne peuvent pas ajouter d’en-têtes de handshake arbitraires) :

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    webSocket: { queryPropagation: true },
  }),
)
```

Avec `queryPropagation`, les champs du propagator s’appendent à la query string de connexion. Passe d’abord en revue logging d’URL, visibilité proxy, access logs, baggage et rétention. `requireParentSpan: true` saute la création de span, la propagation, les hooks et les métriques quand il n’y a pas de parent actif, puis appelle `next` inchangé.

## Sémantique HTTP, SSE et WebSocket

L’adapter mesure les durées de vie de transport, pas chaque étape d’interprétation de commande.

- **HTTP** — le span commence dans l’intercepteur HTTP et se termine quand il obtient le `HttpResponse` Defjs. La vérification du media type, la lecture de la représentation et le décodage du Struct arrivent tous après : un fault `RES_*` ultérieur ne peut donc pas mettre à jour le span de transport déjà terminé. Et comme le span vit à l’intérieur de la chaîne, un reject de transport est enregistré avec la classe d’exception selon la convention OTel, et non avec le code de fault que l’exécution attribue ensuite.
- **SSE** — le span reste ouvert jusqu’à ce que `stream.closed` se settle. Enregistre `sse.connected`, puis `sse.closed` / `sse.aborted` / `sse.error`. Un flux logique (reconnects inclus) → un span. Pas de spans par événement.
- **WebSocket** — le span reste ouvert jusqu’à ce que `session.closed` se settle. Événements : `websocket.connected`, `websocket.closed`, `websocket.error`. Les sockets physiques en reconnect restent partie de la session logique. Pas de spans par message.

Besoin du résultat final de commande, pas seulement du transport ? Wrap `client.execute(...)` dans un span applicatif :

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
const readOrders = defineRequest({ method: 'GET', operation: 'orders.read', path: '/orders' })

const outcome = await tracer.startActiveSpan('orders.command', async (span) => {
  try {
    const outcome = await client.execute(readOrders())
    const [error] = outcome
    if (error) {
      span.setAttribute('error.type', error.code)
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    return outcome
  } finally {
    span.end()
  }
})

void outcome
```

Le span externe est à toi. Le plugin rapporte encore le span de transport plus bas — deux questions différentes.

## Référence

Quand `meter` est fourni :

| Métrique                                     | Signification                                        |
| -------------------------------------------- | ---------------------------------------------------- |
| `http.client.request.duration`               | Durée de requête HTTP (secondes)                     |
| `defjs.client.sse.connect.duration`          | Temps jusqu’au retour du handle SSE                  |
| `defjs.client.sse.connection.duration`       | Retour du handle → close terminale                   |
| `defjs.client.sse.active_streams`            | Handles SSE logiques avec `closed` en attente        |
| `defjs.client.websocket.connect.duration`    | Temps jusqu’au retour de la session WebSocket        |
| `defjs.client.websocket.connection.duration` | Retour de session → close terminale                  |
| `defjs.client.websocket.active_connections`  | Sessions WebSocket logiques avec `closed` en attente |

Les instruments SSE/WebSocket actifs comptent les ressources logiques (gaps de reconnect inclus), pas les sockets physiques ni les tentatives HTTP individuelles.

Les spans HTTP enregistrent méthode, `url.full` résolu, adresse/port serveur quand disponibles, et statut de réponse quand reçu. Par défaut, `url.full` résout seulement `request.endpoint` contre l’éventuel `request.baseEndpoint` et n’ajoute pas un `request.queryString` indépendant. C’est une frontière de construction, pas une redaction ; crée une URL applicative complète ou masquée dans `startSpanHook`. Statut `400+` → statut de span `ERROR` avec la chaîne de statut comme `error.type`. Statut `100..399` laisse le statut de span non posé. Un outcome de transport statut-zéro n’a pas de statut de réponse ; l’annulation laisse le statut non posé ; timeout/autres échecs de transport utilisent `NET_TIMEOUT` ou `NET_UNREACHABLE`. Les métriques utilisent des dimensions stables : méthode, opération statique, adresse/port serveur, statut de réponse, type d’erreur à faible cardinalité.

Les métriques de connexion SSE/WebSocket enregistrent le temps de connect, la durée de connexion logique, le compte de ressources actives, `defjs.result`, l’opération, l’adresse/port serveur, et les types d’échec à faible cardinalité. Pas de bodies requête/réponse, payloads de messages, longueurs de queue ou spans par message par défaut.

Traite `url.full` et `recordException(...)` comme potentiellement sensibles. Defjs ne les masque pas pour toi. Garde les noms d’opération et attributs de hooks allowlistés ; masque dans `startSpanHook` ou les processors/exporters SDK. Ne copie pas URL brutes, query strings, en-têtes, baggage ou payloads dans de la télémétrie custom sans passer en revue privacy, cardinalité, rétention et redaction.

La propagation query WebSocket peut exposer le contexte de trace et le baggage aux navigateurs, proxies, access logs et télémétrie. Ce n’est pas un canal de credentials. `withCredentials(true)` est credentials Fetch pour HTTP/SSE — pas l’auth WebSocket.

L’adapter n’init/shutdown pas le SDK, et ne dispose pas le client core ni les handles de transport. Tu flush la télémétrie et tu fermes le travail HTTP/SSE/WebSocket. Voir [Intercepteurs](../core/interceptors.md), [SSE](../core/sse.md) et [WebSocket](../core/web-socket.md).

## Recettes liées

- [Tester avec un handle Fetch local](../recipes/test-with-handle.md)
- [Consommer un flux SSE](../recipes/consume-sse.md)
- [Ouvrir une session WebSocket](../recipes/websocket-session.md)
