---
title: HTTP
description: Définis une requête, exécute-la, branche sur le statut, et annule avec signal ou timeout.
---

# HTTP

Définis → exécute → branche sur le tuple → annule quand l’écran s’en va. C’est toute la boucle HTTP.

## Basic Setup

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

const [error, data, response] = await client.execute(getUser({ id: 7 }))
if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (!error) {
  console.log(data.name, response.status)
}
```

## Résoudre l’URL

`withEndpoint(...)` a besoin d’une URL absolue valide. Le pathname de l’endpoint reste un répertoire ; query et hash sont jetés avant la résolution de la commande.

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({ path: { id: input.id }, query: { fields: input.fields } }),
})

const command = getUser({ id: 'a/b', fields: 'name' })
void client.execute(command)
// → https://api.example.com/v1/users/a%2Fb?fields=name
```

Les placeholders de path sont des scalaires bruts, encodés exactement une fois. Les valeurs vides et `.` / `..` sont rejetées. Slashes, `?`, `#`, `%`, espaces et Unicode dans un placeholder restent un seul segment encodé — n’encode pas à l’avance.

Le path de définition ne peut pas contenir `?` ou `#`, et ne peut pas être absolu ou protocol-relative. L’encodeur de query par défaut accepte les scalaires et les tableaux de scalaires (les tableaux répètent la clé). Un objet imbriqué échoue avec `REQ_BUILD_FAILED` sauf si le client a `withQuerySerializer(...)`. `null` dans `path`, `query` ou `headers` échoue de la même façon. `undefined` est omis.

## Placer l’entrée

Le struct encode la valeur. Le builder la place. Omets `builder` quand `input` est déjà `{ path?, query?, headers?, body? }`.

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})

const [error, user] = await client.execute(
  updateUser({
    path: { id: 7 },
    headers: { requestId: 'request-42' },
    body: { displayName: 'Ada' },
  }),
)
if (error) console.error(error.code)
else console.log(user.id)
```

Ce corps est `{"display_name":"Ada"}` avec `application/json`. Le nom wire de l’en-tête est `x-request-id`. Les appelants et les résultats parsés gardent `displayName`.

Préfère faire passer la valeur typée plutôt que d’épeler les clés wire. L’alias se déclare une fois sur le champ et s’applique dans les deux sens : `output` / `error` / événements / frames entrantes décodent `display_name` vers `displayName`, et `body: input.order` réécrit tout l’arbre. Le même struct `User` peut être un corps de création et une sortie de get. Une clé écrite à la main est l’exception : l’objet parent est anonyme, donc l’alias ne tourne pas.

| Expression du builder                           | Sur le wire                                              |
| ----------------------------------------------- | -------------------------------------------------------- |
| `body: input.profile`                           | Objet typé : alias et encodage `Date` / `bigint`         |
| `body: { profile: input.profile }`              | Clés externes littérales, objet interne toujours typé    |
| `body: { ...input.profile, role: 'admin' }`     | Le spread garde le struct ; la clé en plus est littérale |
| `body: { name: input.profile.displayName }`     | Parent anonyme : l’alias ne s’applique pas               |
| `query: input.query` / `headers: input.headers` | Objets plats typés : l’alias devient la clé wire         |

Spreader un objet typé et poser aussi sa clé wire (`display_name` à côté de `displayName`) est `REQ_BUILD_FAILED`. Un objet imbriqué dans `path` ou `headers` échoue de la même façon.

Le guide se choisit à chaque nœud, pas seulement à la racine. Un nouvel objet sous un parent anonyme garde les clés que vous avez écrites. Le même objet sous un parent typé utilise le struct de ce champ.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

Quand un guide union correspond à plus d'une branche, chaque branche est encodée puis comparée. Une sortie wire identique est conservée ; une différence est `REQ_BUILD_FAILED`.

Une intersection mixte qui contient une partie non-objet est taguée, à l'analyse, avec la conjonction des tags des parties correspondantes ; une valeur d'intersection mixte écrite à neuf et non analysée reste un objet anonyme.

### Query

La forme de query imbriquée (`a[b]`, `a.b`, listes à virgules) est une convention du backend, donc le hook est sur le client :

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

Ici `query` est l’objet wire encodé. Les alias sont déjà appliqués, donc un serializer comme `qs` ne les laisse pas tomber. La string renvoyée est la query string. Defjs ne dépend pas de `qs`.

Sans serializer, les tableaux répètent les clés et un objet imbriqué est `REQ_BUILD_FAILED`. Renvoyer `URLSearchParams` depuis le builder utilise cette valeur telle quelle et saute le serializer. Le serializer n’est pas appelé quand il n’y a pas de query. Les intercepteurs voient ensuite `queryParams` comme `new URLSearchParams(queryString)`.

### Body

Le premier match gagne :

| Valeur de `body`                                                | Envoyé comme                                                                                  | Content type par défaut                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| omis / `undefined`                                              | pas de corps                                                                                  | —                                                                |
| objet typé dont la racine a un codec `urlencoded` ou `formData` | `URLSearchParams` / `FormData` ; les clés sont des noms wire ; les tableaux répètent les clés | type form / boundary de la plateforme                            |
| `FormData`, `URLSearchParams`                                   | tel quel                                                                                      | identique ; Defjs efface un `Content-Type` périmé sur `FormData` |
| `Blob` / `File`                                                 | tel quel                                                                                      | `blob.type`, ou `application/octet-stream`                       |
| `ArrayBuffer`, `TypedArray`, `DataView`                         | tel quel                                                                                      | `application/octet-stream`                                       |
| `ReadableStream`                                                | streamé (`duplex: 'half'` quand le runtime le permet)                                         | `application/octet-stream`                                       |
| `string`                                                        | tel quel                                                                                      | `text/plain;charset=UTF-8`                                       |
| objet, tableau, nombre, booléen, `null`                         | encodé, puis `JSON.stringify`                                                                 | `application/json`                                               |

Pose `content-type` sur `headers` pour overrider le défaut. Le tag de codec ne s’applique qu’à la racine du corps : `body: { meta: input.form }` est du JSON, et les champs du formulaire sont des champs JSON ordinaires. Une string est du texte brut ; une string JSON comme `"abc"` a besoin de `JSON.stringify` plus `application/json`. Les champs `undefined` sont omis ; un champ `nullable` envoyé comme `null` est le JSON `null`.

`GET` et `HEAD` ne peuvent pas renvoyer un corps — c’est une erreur de type. Les builders WebSocket ne peuvent pas renvoyer `headers` ni `body`.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const login = defineRequest({
  method: 'POST',
  path: '/login',
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias('username'),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
})

const upload = defineRequest({
  method: 'POST',
  path: '/files/:id',
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData()
    input.photos.forEach((photo, index) => body.append('photo', photo, `photo-${index}.jpg`))
    return { path: { id: input.id }, body }
  },
})

void login
void upload
```

`JSON.stringify`, `qs` ou protobuf que tu lances toi-même voient les noms logiques. L’alias ne s’applique pas sur ce chemin. Il n’y a pas de `struct.encode` public.

Un builder peut brancher sur l’entrée réelle et renvoyer un corps différent selon le cas (records JSON, un `File`, ou `URLSearchParams`). Les `Headers` natifs passent aussi tels quels et ne sont pas ré-encodés.

## Comment un corps est lu

`output` est un Struct pour le corps 2xx ; `error` est un Struct pour tout le reste. Le kind du struct
choisit la représentation : `string` est du texte brut, `blob` / `file` sont des blobs, `arrayBuffer` est des octets,
et tout autre kind est du JSON. Si aucun des deux côtés n’est déclaré, le corps n’est jamais lu.

Ordre des opérations :

1. `ok` choisit le côté : `output` pour les 2xx, `error` pour tout le reste. Jamais les deux.
2. Rien de déclaré pour ce côté → le corps n’est jamais lu. Un 2xx réussit avec `data === undefined` ;
   un non-2xx est `HTTP_STATUS` avec `data === undefined`. Un corps illisible du côté que tu n’as pas
   déclaré est ignoré, y compris le fait qu’il n’ait pas pu être lu.
3. Le media type est vérifié **avant** la lecture du corps. Un écart est `RES_MEDIA_TYPE_INVALID` et
   rien n’est parsé ni décodé.
4. La représentation est lue. Un échec est `RES_DECODE_FAILED`. Le JSON du transport est parsé une fois :
   une chaîne sur cette valeur est une racine string JSON et n’est pas reparsée ; les octets et les blobs
   sont bruts et sont parsés une fois.
5. Le Struct parse la valeur. Un échec est `RES_STRUCT_MISMATCH`.
6. 2xx → résultat et un `response.body` typé ; non-2xx → `data` typé sur `HTTP_STATUS`.

Le décodage a lieu une fois, après la chaîne d’intercepteurs, donc une réponse qu’un intercepteur a construite avec
`makeResponse(...)` est lue exactement comme une réponse venue du réseau. Pour une représentation JSON, un
corps string est une racine string JSON.

Une réponse réussie est un `DecodedResponse<T>` : `url`, `status`, `statusText`, `headers`, `ok`, et
un `body` typé. Là où rien n’a été décodé tu obtiens `HttpMeta` — les mêmes champs sans `body`. `ok`
veut seulement dire `200 <= status < 300`. Ni l’un ni l’autre n’est une `Response` native. Un échec de transport est un fault, donc
il n’y a pas de réponse au statut 0 qui en tienne lieu.

## Cancel the work {#cancel-the-work}

Les options d’exécution prennent `signal` plus soit `abort` soit `timeout`. **`abort` et `timeout` s’excluent.** `signal` peut se combiner avec l’un ou l’autre.

```ts
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const command = defineRequest({ method: 'GET', path: '/report' })()
const controller = new AbortController()
const pending = client.execute(command, { signal: controller.signal, timeout: 5_000 })

controller.abort('screen closed')
const [error] = await pending
if (error?.code === 'NET_ABORTED') {
  console.log('caller cancellation')
}
```

`timeout` doit être un entier sûr positif dans `1..2_147_483_647`. Annulation reconnue → `NET_ABORTED` ; timeout d’exécution → `NET_TIMEOUT` ; `throw` d’intercepteur → `EXT_INTERCEPTOR_FAILED` ; autres échecs Fetch → `NET_UNREACHABLE`. Annuler après que le serveur a accepté une écriture ne **prouve pas** que l’écriture a été annulée.

## Credentials et XSRF

`withCredentials(true)` pose Fetch `credentials: 'include'` pour HTTP et SSE. Il ne crée pas `Authorization` et ne configure pas l’auth WebSocket. `false` laisse les credentials non spécifiés.

`withXSRF(...)` est HTTP seulement. Défauts : `cookieName: 'XSRF-TOKEN'`, `headerName: 'X-XSRF-TOKEN'`. L’en-tête n’est injecté que pour les méthodes non safe, seulement si l’appelant ne l’a pas déjà posé, et seulement pour les requêtes navigateur same-origin. Saute `GET`, `HEAD`, `OPTIONS`, `TRACE`. Hors navigateur, passe un `tokenProvider` synchrone, scopé à la requête, si tu as besoin de l’injection.

Garde credentials, tokens XSRF et query strings hors des logs de routine. N’utilise pas les query params comme canal général de credentials.

## Progress et la frontière Fetch

`onDownloadProgress` tourne pendant qu’un corps de réponse déclaré est lu. `lengthComputable` n’est vrai qu’avec un `Content-Length` positif. Pas de struct pour ce côté → le corps n’est pas lu → pas de progress de lecture du corps.

`onUploadProgress` observe un corps de requête `ReadableStream<Uint8Array>` pendant que Fetch le lit. Un corps JSON ou texte n’est pas ce stream — renvoie `file.stream()` (ou un autre `ReadableStream`) depuis le builder quand tu as besoin du progress d’upload. Le transport signale une erreur de capacité quand le runtime ne peut pas envoyer un corps streamé.

`fetchHandler(httpRequest, fetchImpl?)` est la frontière Fetch de plus bas niveau : construit une `Request` native, appelle Fetch, lit la représentation, renvoie `HttpResponse`. Il ne **valide pas** l’entrée de commande, ne dispatche pas `output`, et ne fait pas tourner les intercepteurs. Utile pour des tests de transport injecté — pas un substitut de `client.execute`.

## Limites de replay

Defjs ne relance **pas** HTTP tout seul. Relancer une lecture demande encore une politique revue de timeout/réseau/doublon. Relancer une mutation demande des octets rejouables, le support serveur, une clé d’idempotence liée au scope d’auth + aux octets de la requête, et une politique de doublon côté récepteur.

Une frontière client/commande/Fetch ne peut pas savoir si une écriture échouée a été commitée. Garde les décisions de replay dans l’app ou un intercepteur revu. Les intercepteurs peuvent short-circuiter ou remplacer la requête bas niveau ; le statut et le corps finaux doivent quand même satisfaire le contrat de la commande.

## Recettes liées

- [GET avec un 404 déclaré](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Annuler un appel HTTP](../recipes/cancel-http.md)
- [Tester avec un handle Fetch local](../recipes/test-with-handle.md)
