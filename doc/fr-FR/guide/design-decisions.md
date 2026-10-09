---
title: Décisions de conception
description: Pourquoi Defjs garde explicites les contrats, commandes, résultats de transport, décodage et propriété.
---

# Décisions de conception

Defjs fait quelques compromis volontaires. Les API de confort masquent souvent qui possède une requête, un flux ou une session. Defjs garde cette frontière visible pour que tu réutilises le même contrat d’endpoint sans ramasser en silence un cache, un planificateur de retry ou un gestionnaire de ressources.

## Déclarer, c’est affirmer {#declaration-is-an-assertion}

Ces six règles tranchent toute question sur la façon dont une réponse est lue. Elles sont numérotées pour qu’une discussion ultérieure puisse en citer une au lieu de la redériver.

### 1. Ce que tu déclares est ce que tu affirmes

`output` veut dire « quand `ok` est true, le corps **est** cette forme ». `error` veut dire « quand `ok` est false, le corps **est** cette forme ». Une déclaration n’est pas un indice ni un espoir au mieux : c’est une affirmation sur ce qui va arriver.

### 2. `ok` est le seul embranchement, et un seul côté décode

Une réponse 2xx est lue avec `output`. Tout le reste avec `error`. Jamais les deux, jamais l’autre en fallback.

### 3. Une réalité qui diffère de l’affirmation est un échec, signalé haut et fort

Pas de devinette de format, pas de repli sur quelque chose de plus faible, pas de silence. Que le backend ait changé, qu’une gateway soit intervenue ou que quelqu’un ait trafiqué la réponse **ne change pas la conclusion** : la bibliothèque ne peut pas les distinguer et ne devrait pas prétendre le faire.

C’est la règle qu’on demande le plus souvent d’assouplir, donc autant poser le cas clairement. Suppose qu’un attaquant puisse réécrire le `200` que ta page allait lire avec `output`, et qu’à la place tu reçoives un `3xx`, `4xx` ou `5xx`. Échouer n’est pas un désagrément : c’est le seul résultat sûr. Te remettre le corps brut « au cas où » donnerait à quiconque peut injecter une réponse un moyen de contourner la validation que tu as demandée.

### 4. Un décodage échoué n’a pas de corps

Un corps **est** une valeur décodée. Si le décodage a échoué, il n’y a pas de valeur — pas de corps à moitié décodé à inspecter. Le détail fautif vit sur `cause` ; la réponse garde ses métadonnées et rien de plus.

Celle-ci est imposée par le système de types, pas par convention : le `response` d’un fault de décodage est `HttpMeta`, qui n’a aucun champ `body`, donc aller le chercher est une erreur de compilation.

### 5. Si tu ne veux pas de l’affirmation, ne déclare pas

Omettre `output` veut dire « le corps 2xx ne m’intéresse pas » — il n’est jamais lu. Omettre `error` dit la même chose pour tout le reste. C’est un opt-out explicite, pas un oubli, et il va jusqu’au bout : un corps illisible du côté que tu as écarté n’est pas ton affaire, pas même le fait qu’il n’ait pas pu être lu.

### 6. 3xx n’est pas une plage de codes d’erreur

Si tu sais qu’un endpoint répond avec un statut de redirection, ne donne pas à `output` un schema pour ça, ou déclares-en un qui accepte une valeur vide. Sinon, signaler un échec est le résultat attendu, pas une lacune.

## Clients explicites

`createClient(...)` fait de la config d’endpoint une valeur explicite. Des environnements ou portées de requête différents obtiennent des endpoints, credentials, intercepteurs, sérialiseurs et handles de transport différents.

Le coût : pas de défaut process-wide. Ce coût aide sur un serveur — crée le client dans la frontière de la requête quand les options ou closures capturent auth, cookies, utilisateurs, tenants ou métadonnées de requête. Un client explicite n’isole pas pour autant l’état capturé par un intercepteur. L’identité du client n’est pas une frontière de sécurité à elle seule.

Un client dispatche des commandes. Il ne possède pas le travail actif. Qui démarre une requête HTTP, un flux SSE ou une session WebSocket doit l’annuler ou la fermer et attendre la promesse terminale.

## Définitions, endpoints et commandes

La définition est le contrat stable : méthode, chemin, struct d’entrée, les structs qui décodent chaque côté de `ok`, limites de transport. `defineRequest` renvoie un endpoint. L’appeler crée une commande opaque pour une seule exécution.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const command = getUser({ id: 7 })
```

Un job d’arrière-plan et un propriétaire UI peuvent exécuter la même forme `getUser` avec des politiques d’annulation/retry différentes. Garder la commande opaque empêche le code app de dépendre des tags ou symboles de transport internes.

## Résultats propres à chaque transport

Les trois transports utilisent un tuple erreur en premier. Une seule « response » générique effacerait les faits de cycle de vie.

- HTTP → `[err, data, response]` — sortie décodée + la réponse qui l’a produite
- SSE → `[err, stream, open]` — un flux logique + instantané de réponse au démarrage
- WebSocket → `[err, session, connection]` — session logique + instantané de connexion au démarrage

En succès, la troisième valeur est toujours présente. Un échec HTTP est `[error, undefined, undefined]` :
le fault porte déjà les métadonnées de réponse, et c’est ce fault qui est passé à un handler,
loggé ou rethrow. Les échecs de démarrage SSE et WebSocket peuvent encore inclure l’instantané open ou connection
quand il a été capturé.

Pour SSE et WebSocket, la troisième valeur est un instantané, pas une promesse que de futurs reconnects gardent la
même connexion physique. Après le démarrage, le contrôle du cycle de vie appartient au handle ou à la
session renvoyés.

## Décodage à l’exécution

L’inférence TypeScript décrit ce que tu attends ; elle ne peut pas vérifier une réponse serveur à l’exécution. Le parsing Struct est la seconde moitié du contrat. Defjs valide l’entrée de la commande avant la construction de la requête, vérifie la représentation, puis parse le struct du côté de `ok` qui s’applique.

Le décodage a lieu **une seule fois, après la chaîne d’intercepteurs**. Une réponse qu’un intercepteur a construite avec `makeResponse(...)` est interprétée exactement comme une réponse venue du réseau : l’origine d’une réponse ne change pas la façon dont elle est lue, donc il n’y a aucun chemin « faire confiance à l’intercepteur » à examiner.

L’ordre est : media type, puis représentation, puis Struct.

| Ce qui n’a pas tenu                                               | Fault                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Le media type n’est pas celui qu’exige la représentation déclarée | `RES_MEDIA_TYPE_INVALID` — signalé **avant** la lecture du corps |
| Les octets ne sont pas cette représentation                       | `RES_DECODE_FAILED`                                              |
| La valeur n’est pas ce Struct                                     | `RES_STRUCT_MISMATCH`                                            |
| Non-2xx, et `error` a décodé                                      | `HTTP_STATUS` avec `data` typé                                   |
| Non-2xx, et `error` n’était pas déclaré                           | `HTTP_STATUS` avec `data: undefined`                             |

Vérifier le media type d’abord, c’est ce qui transforme « j’ai demandé du JSON et reçu du HTML » en un fault précis plutôt qu’en une erreur de parser, et cela saute entièrement la lecture, le parsing et le Struct.

## Builder, encodeur et alias

Un struct est le contrat de champ, dans les deux sens. `.alias(name)` est le nom wire. Le struct décide comment une valeur est encodée. Le `builder` décide où cette valeur va.

`builder` est optionnel, synchrone et pur. Il reçoit l’entrée parsée — la vraie valeur, pas une vue de binding — et renvoie la requête : `path`, `query`, `headers` et `body`. Il tourne quand la commande s’exécute. Un throw devient `REQ_BUILD_FAILED` sur le tuple ; appeler l’endpoint ne throw pas. Omets `builder` quand le struct d’entrée est déjà cette forme de requête. Cette omission est `(input) => input`, et TypeScript exige un builder quand l’entrée n’est pas assignable.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createBatch = defineRequest({
  method: 'POST',
  path: '/accounts/:account_id/users',
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    users: struct.array(
      struct.object({
        displayName: struct.string().alias('display_name'),
        email: struct.string(),
      }),
    ),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { 'x-api-version': '2' },
    body: { users: input.users },
  }),
  output: struct.object({ accepted: struct.number() }),
})

const command = createBatch({
  accountId: 42,
  users: [{ displayName: 'Ada', email: 'ada@example.com' }],
})
void command
```

Le chemin par défaut est de faire passer la valeur typée. `body: { users: input.users }` garde l’alias de chaque utilisateur, donc le champ wire est `display_name`. Une clé que tu écris toi-même (`account_id`, `x-api-version`) est littérale. Spreader un objet typé garde son struct ; ajouter la clé wire à côté du champ logique est `REQ_BUILD_FAILED`.

L’imbrication de query est une propriété du backend, donc elle vit sur le client : `withQuerySerializer((query) => string)` voit l’objet wire encodé, alias compris. Il n’est pas appelé quand il n’y a pas de query. Un `URLSearchParams` renvoyé par le builder le saute. Sans serializer, les tableaux répètent les clés et un objet imbriqué échoue. Les intercepteurs observent `queryParams` comme `new URLSearchParams(queryString)`.

Le kind du corps se décide d’après la valeur, premier match :

- pas de `body` → rien n’est envoyé
- un codec `urlencoded` ou `formData` sur la racine du corps → cet encodage de formulaire ; le tag ne s’applique pas quand la valeur est imbriquée dans du JSON
- `FormData`, `URLSearchParams`, `Blob`, `File`, octets, ou un `ReadableStream` → envoyé tel quel
- une string → `text/plain;charset=UTF-8`
- tout le reste → JSON

Les champs `undefined` sont omis. `null` sur un champ nullable est envoyé. Une string n’est pas du JSON sauf si tu la stringifies et poses `content-type`. Sérialiser toi-même (`JSON.stringify`, qs, protobuf) quitte l’encodeur de struct, donc les alias ne s’appliquent pas. Il n’y a pas de `struct.encode` public.

`GET` et `HEAD` ne peuvent pas porter un corps. Les builders WebSocket ne peuvent pas renvoyer d’en-têtes ni de corps. Les sous-protocoles WebSocket statiques restent sur la définition (`protocols`), pas dans le builder. Les frames WebSocket invalides vont à l’écouteur d’erreur runtime de la session. Un struct `error` SSE type le fault de démarrage, et son corps de handshake suit la même règle de kind qu’un corps HTTP : `string` est du texte, les blobs et les fichiers sont des blobs, `arrayBuffer` est des octets, et tout le reste est du JSON.

## Placement des observateurs et des politiques

Les intercepteurs servent à la politique transversale au transport : auth, tracing, short-circuit, retry revu. Ils ne tournent que pour leur transport et se composent en ordre oignon. Les options d’exécution servent à la durée de vie du travail : `signal`, `timeout`, heartbeat WebSocket, reconnect opt-in.

Les observateurs rapportent ce qui s’est passé sans devenir un second propriétaire. `onInvalidEvent` SSE, les écouteurs d’état WebSocket et les écouteurs d’erreurs runtime servent aux diagnostics et métriques bornés. Le flux/session renvoyé possède toujours l’itération, la fermeture, le désabonnement et l’attente terminale. Cache, suppression de résultats périmés, idempotence et mapping d’erreurs de domaine appartiennent autour de `client.execute(...)`, où ton app voit sa propre politique et son état.

## OpenAPI, sourcemaps et télémétrie

Defjs ne génère ni ne synchronise un second contrat OpenAPI. Si OpenAPI est déjà autoritatif, garde-le et ajoute la validation runtime à la frontière de l’app. Pour un nouveau service, les définitions d’endpoint et les Structs peuvent être le contrat wire direct — pas de seconde source de vérité.

`withOpenTelemetryServer(...)` ajoute de l’instrumentation Defjs **sortante** à un client. Il n’initialise pas un SDK OpenTelemetry. `tracer` est requis, `meter` est optionnel, les trois transports sont activés par défaut, et la propagation query WebSocket est désactivée par défaut. Garde les noms d’opération statiques et à faible cardinalité. Passe en revue propagation, hooks, URL, en-têtes, payloads, causes et rétention comme potentiellement sensibles.

Les sourcemaps sont une décision de déploiement, pas un comportement Defjs. Une map publique avec `sourcesContent` expose le source ; une map cachée contient encore le source et les chemins ; désactiver les maps retire la symbolication au niveau source. Traite les maps privées comme des artefacts de debug déployables avec accès et règles de rétention explicites.

## Recettes liées

- [GET avec un 404 déclaré](../recipes/get-declared-404.md)
- [Tester avec un handle Fetch local](../recipes/test-with-handle.md)
