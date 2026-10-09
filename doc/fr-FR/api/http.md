---
title: HTTP
description: defineRequest, options d’execute, et types de requête/réponse HTTP.
---

# HTTP

Déclare une requête typée, construis une commande à partir de l’entrée, exécute-la.

## defineRequest() {#defineRequest}

```ts
function defineRequest(definition: RequestDefinition): RequestEndpoint
```

- **definition** — `method`, `path`, struct `input` optionnel, `builder` optionnel, structs `output` et `error` optionnels, `operation` optionnel.
- **Renvoie** un endpoint. Appelle-le avec l’entrée pour obtenir un `HttpCommand`.

```ts
import { defineRequest, struct } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})
```

`output` est un struct pour le corps 2xx ; `error` est un struct pour tout corps non-2xx. Aucun des deux n’est
indexé par statut. Omettre l’un veut dire que ce corps n’est jamais lu — voir
[Déclarer, c’est affirmer](/guide/design-decisions#declaration-is-an-assertion).

## executeHttpCommand() {#executeHttpCommand}

```ts
function executeHttpCommand(clientConfig: ClientConfig, command: HttpCommand, options?: HttpExecuteOptions): Promise<HttpAwaitResult>
```

Point d’entrée bas niveau utilisé par `client.execute`. Le code applicatif doit appeler `client.execute(command, options)`.

- **Renvoie** `[null, data, response]` ou `[fault, undefined, undefined]`.

Un statut non-2xx est toujours `HTTP_STATUS`. Son `data` est le corps `error` décodé quand il a été
déclaré, et `undefined` sinon. En échec, le troisième slot du tuple est `undefined` ; le fault
porte les métadonnées de réponse.

## fetchHandler() {#fetchHandler}

```ts
function fetchHandler(httpRequest: HttpRequest, fetchImpl?: typeof fetch): Promise<HttpResponse<unknown>>
```

Transport HTTP par défaut. Utilisé sauf si `withHTTPHandle` le remplace. Il reject — plutôt que de résoudre
avec une réponse synthétique — quand aucune réponse n’a atteint le client.

## makeResponse() {#makeResponse}

```ts
function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R>
```

Construit un `HttpResponse` sans appel réseau (intercepteurs, tests). Le statut par défaut est `0`. `ok` est
vrai pour les 2xx. La valeur renvoyée passe par le même contrôle de media type et le même struct déclaré
qu’une réponse venue du réseau ; il n’y a pas de court-circuit de confiance.

## Options d’execute

## HttpExecuteOptions {#HttpExecuteOptions}

```ts
type HttpExecuteOptions = {
  onDownloadProgress?: HttpProgressFn
  onUploadProgress?: HttpProgressFn
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

L’annulation, c’est `abort` **ou** `timeout`, pas les deux. `signal` se combine avec l’un ou l’autre ; ce n’est **pas** un alias de `abort`. Formes valides : `{ timeout }`, `{ abort }`, `{ signal, timeout }`, `{ signal, abort }`. `{ abort, timeout }` est invalide. `timeout` doit être un entier sûr positif dans `1..2_147_483_647`.

## Types

### RequestDefinition {#RequestDefinition}

`method`, `path`, `input` optionnel, `builder`, `output`, `error` et `operation`. Il n’y a pas de `responseType` : le kind du struct choisit comment un corps déclaré est lu.

### ResponseDeclaration {#ResponseDeclaration}

```ts
type ResponseDeclaration<TOutput, TError> = { output?: TOutput; error?: TError }
```

La moitié `output` / `error` d’une `RequestDefinition`. Quand les deux sont absents, le corps n’est jamais lu.

### HttpAwaitResult {#HttpAwaitResult}

```ts
type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [error: null, result: TData, response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined]
```

En succès, le troisième slot porte `body` seulement quand `output` a été déclaré. En échec il est
`undefined` — le fault détient déjà les métadonnées de réponse qui existaient.

### HttpRequest {#HttpRequest}

Requête sortante normalisée : `method`, `endpoint`, `headers`, `body`, `abort`, `operation`, hooks de progress, `baseEndpoint`, `queryString` et `queryParams`. Les intercepteurs voient `queryParams` comme `new URLSearchParams(queryString)`. Un builder qui renvoie `URLSearchParams` fait passer cette instance telle quelle. `responseType` et `errorResponseType` sont readonly : ils sont dérivés des kinds de struct `output` et `error` de l’endpoint et ne doivent pas être modifiés.

### HttpMeta {#HttpMeta}

```ts
type HttpMeta = {
  readonly headers: Headers
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly url: string
}
```

Métadonnées de réponse, disponibles dès qu’une réponse a atteint le client. Elles ne portent **pas** de `body` : un corps
n’existe qu’une fois qu’un struct déclaré en a décodé un.

### DecodedResponse {#DecodedResponse}

```ts
type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }
```

Une réponse dont le corps a décodé contre le struct déclaré. Détenir ce type prouve que
le décodage a eu lieu, c’est pourquoi un échec de décodage ne rapporte que `HttpMeta`.

### HttpResponse {#HttpResponse}

```ts
type HttpResponse<R> = {
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly body: R | null
  readonly ok: boolean
}
```

La forme wire que produisent les transports et que voient les intercepteurs : `body` est du texte ou du JSON déjà parsé, pas une
valeur décodée. Pour une représentation JSON, une chaîne est une racine string JSON et n’est pas reparsée ; les octets
et les blobs sont bruts et sont parsés une fois. `DecodedResponse` est ce qui atteint l’appelant.

### HttpProgressEvent {#HttpProgressEvent}

### HttpProgressFn {#HttpProgressFn}

`loaded`, `total`, `lengthComputable`. Les callbacks peuvent être async. Un callback qui throw est
`EXT_OBSERVER_FAILED`.

Voir le [guide HTTP](/core/http) et [Commandes](/core/commands).

## RequestEndpoint {#RequestEndpoint}

Renvoyé par `defineRequest`. Appelle avec l’entrée pour obtenir un `HttpCommand`.

## BuilderInput {#BuilderInput}

Entrée d’endpoint parsée vue par `builder`. Les nœuds objet portent le struct qui les a produits, donc l’encodage d’alias, de `Date` et de `bigint` suit la valeur.

## HttpRequestShape {#HttpRequestShape}

```ts
type HttpRequestShape<P extends string, M extends string> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}
```

`GET` et `HEAD` ne peuvent pas renvoyer un corps. `path` et `headers` doivent être des scalaires plats ; `query` peut s’imbriquer, et un objet imbriqué a besoin de `withQuerySerializer` à l’exécution.

## HttpCommand {#HttpCommand}

Commande opaque issue d’un builder de requête. Passe-la à `client.execute`.

## UseRequestConfig {#UseRequestConfig}

Champs de progress et d’annulation. `HttpExecuteOptions` ajoute `signal`.

## RequestSuccessData {#RequestSuccessData}

Corps de succès inféré depuis le struct `output` déclaré, ou `undefined` quand aucun n’est déclaré.

## RequestErrorData {#RequestErrorData}

Corps d’erreur inféré depuis le struct `error` déclaré, ou `undefined` quand aucun n’est déclaré.

## HttpResponseType {#HttpResponseType}

`'arraybuffer' | 'blob' | 'json' | 'text'`

Choisi d’après le kind du struct déclaré (`string` → `text`, `blob` / `file` → `blob`, `arrayBuffer` → `arraybuffer`, tout le reste → `json`). Ce n’est pas un champ de `defineRequest`.

## MakeResponseOptions {#MakeResponseOptions}

Champs de `makeResponse` : `status`, `statusText`, `url`, `headers`, `body`, `request`.
