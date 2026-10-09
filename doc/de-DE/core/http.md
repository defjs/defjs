---
title: HTTP
description: Request definieren, ausführen, nach Status branchen und mit signal oder timeout canceln.
---

# HTTP

Definieren → ausführen → auf dem Tupel branchen → canceln, wenn der Screen weg ist. Das ist die ganze HTTP-Schleife.

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

## URL auflösen

`withEndpoint(...)` braucht eine gültige absolute URL. Endpoint-Pathname bleibt als Directory; Query und Hash werden vor der Command-Resolution verworfen.

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

Path-Placeholder sind Raw-Scalars, genau einmal encoded. Leere Werte und `.` / `..` werden rejected. Slashes, `?`, `#`, `%`, Spaces und Unicode in einem Placeholder bleiben ein encoded Segment — pre-encode nicht.

Definition-Path darf kein `?` oder `#` enthalten und darf nicht absolut oder protocol-relative sein. Der Default-Query-Encoder akzeptiert Scalars und Arrays von Scalars (Arrays wiederholen den Key). Ein genestetes Object failt mit `REQ_BUILD_FAILED`, außer der Client hat `withQuerySerializer(...)`. `null` in `path`, `query` oder `headers` failt genauso. `undefined` wird weggelassen.

## Input platzieren

Der Struct encodet den Wert. Der Builder platziert ihn. Lass `builder` weg, wenn `input` schon `{ path?, query?, headers?, body? }` ist.

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

Dieser Body ist `{"display_name":"Ada"}` mit `application/json`. Der Header-Wire-Name ist `x-request-id`. Caller und geparste Results behalten `displayName`.

Reich lieber den typisierten Wert durch, statt Wire-Keys auszuschreiben. Alias wird einmal auf dem Field deklariert und gilt in beide Richtungen: `output` / `error` / Events / Incoming-Frames dekodieren `display_name` zu `displayName`, und `body: input.order` schreibt den ganzen Baum um. Derselbe `User`-Struct kann Create-Body und Get-Output sein. Ein selbst geschriebener Key ist die Ausnahme: das Parent-Object ist anonym, also läuft der Alias nicht.

| Builder-Ausdruck                                | Auf der Leitung                                           |
| ----------------------------------------------- | --------------------------------------------------------- |
| `body: input.profile`                           | Typisiertes Object: Alias und `Date`- / `bigint`-Encoding |
| `body: { profile: input.profile }`              | Äußere Keys literal, inneres Object bleibt typisiert      |
| `body: { ...input.profile, role: 'admin' }`     | Spread behält den Struct; der Extra-Key ist literal       |
| `body: { name: input.profile.displayName }`     | Anonymes Parent: Alias gilt nicht                         |
| `query: input.query` / `headers: input.headers` | Typisierte flache Objects: Alias wird der Wire-Key        |

Ein typisiertes Object zu spreaden und gleichzeitig seinen Wire-Key zu setzen (`display_name` neben `displayName`) ist `REQ_BUILD_FAILED`. Ein genestetes Object in `path` oder `headers` failt genauso.

Der Guide wird an jedem Knoten gewählt, nicht nur an der Wurzel. Ein neues Object unter einem anonymen Parent behält die Keys, die du geschrieben hast. Dasselbe Object unter einem typisierten Parent nutzt den Struct dieses Fields.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

Trifft ein Union-Guide mehr als einen Branch, wird jeder Branch kodiert und verglichen. Identische Wire-Ausgabe bleibt; ein Unterschied ist `REQ_BUILD_FAILED`.

Eine gemischte Intersection, die einen Nicht-Objekt-Teil enthält, bekommt beim Parsen als Tag die Konjunktion der Tags der passenden Teile; ein neu geschriebener Mixed-Intersection-Wert, der nicht geparst wurde, bleibt ein anonymes Object.

### Query

Genestete Query-Shape (`a[b]`, `a.b`, Komma-Listen) ist eine Backend-Konvention, deshalb hängt der Hook am Client:

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

`query` hier ist das encodierte Wire-Object. Aliasse sind schon angewandt, ein Serializer wie `qs` droppt sie also nicht. Der Return-String ist der Query-String. Defjs hängt nicht von `qs` ab.

Ohne Serializer wiederholen Arrays Keys, und ein genestetes Object ist `REQ_BUILD_FAILED`. `URLSearchParams` aus dem Builder wird so genutzt und überspringt den Serializer. Ohne Query wird der Serializer nicht aufgerufen. Interceptors sehen danach `queryParams` als `new URLSearchParams(queryString)`.

### Body

Der erste Match gewinnt:

| `body`-Wert                                                                   | Gesendet als                                                                  | Default Content-Type                                             |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| weggelassen / `undefined`                                                     | kein Body                                                                     | —                                                                |
| typisiertes Object, dessen Root einen `urlencoded`- oder `formData`-Codec hat | `URLSearchParams` / `FormData`; Keys sind Wire-Namen; Arrays wiederholen Keys | Form-Type / Platform-Boundary                                    |
| `FormData`, `URLSearchParams`                                                 | as-is                                                                         | dasselbe; Defjs cleart einen stale `Content-Type` auf `FormData` |
| `Blob` / `File`                                                               | as-is                                                                         | `blob.type`, oder `application/octet-stream`                     |
| `ArrayBuffer`, `TypedArray`, `DataView`                                       | as-is                                                                         | `application/octet-stream`                                       |
| `ReadableStream`                                                              | gestreamt (`duplex: 'half'`, wenn die Runtime es erlaubt)                     | `application/octet-stream`                                       |
| `string`                                                                      | as-is                                                                         | `text/plain;charset=UTF-8`                                       |
| Object, Array, Number, Boolean, `null`                                        | encodet, dann `JSON.stringify`                                                | `application/json`                                               |

Setze `content-type` auf `headers`, um den Default zu überschreiben. Der Codec-Tag gilt nur am Body-Root: `body: { meta: input.form }` ist JSON, und die Form-Fields sind gewöhnliche JSON-Fields. Ein String ist Raw-Text; ein JSON-String wie `"abc"` braucht `JSON.stringify` plus `application/json`. `undefined`-Fields werden weggelassen; ein als `null` gesendetes `nullable`-Field ist JSON `null`.

`GET` und `HEAD` können keinen Body zurückgeben — das ist ein Type-Error. WebSocket-Builder können weder `headers` noch `body` zurückgeben.

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

`JSON.stringify`, `qs` oder Protobuf, das du selbst laufen lässt, sieht logische Namen. Auf diesem Pfad gilt Alias nicht. Es gibt kein öffentliches `struct.encode`.

Ein Builder darf auf dem echten Input branchen und je Fall einen anderen Body zurückgeben (JSON-Records, ein `File` oder `URLSearchParams`). Native `Headers` werden ebenfalls durchgereicht und nicht neu encodet.

## Wie ein Body gelesen wird

`output` ist ein Struct für den 2xx-Body; `error` ist ein Struct für alles andere. Der Struct-Kind
wählt die Representation: `string` ist Raw-Text, `blob` / `file` sind Blobs, `arrayBuffer` sind Bytes,
und jeder andere Kind ist JSON. Ist keine Seite deklariert, wird der Body nie gelesen.

Reihenfolge der Schritte:

1. `ok` wählt die Seite: `output` für 2xx, `error` für alles andere. Nie beide.
2. Für diese Seite nichts deklariert → der Body wird nie gelesen. 2xx gelingt mit `data === undefined`;
   Non-2xx ist `HTTP_STATUS` mit `data === undefined`. Ein unlesbarer Body auf einer Seite, die du nicht
   deklariert hast, wird ignoriert — samt der Tatsache, dass er nicht lesbar war.
3. Der Media-Type wird geprüft, **bevor** der Body gelesen wird. Eine Abweichung ist `RES_MEDIA_TYPE_INVALID` und
   es wird nichts geparst oder dekodiert.
4. Die Representation wird gelesen. Ein Fehlschlag ist `RES_DECODE_FAILED`. JSON vom Transport wird einmal
   geparst: ein String auf diesem Wert ist eine JSON-String-Wurzel und wird nicht noch einmal geparst; Bytes
   und Blobs sind roh und werden einmal geparst.
5. Der Struct parst den Wert. Ein Fehlschlag ist `RES_STRUCT_MISMATCH`.
6. 2xx → Result und ein typisiertes `response.body`; Non-2xx → typisiertes `data` auf `HTTP_STATUS`.

Dekodiert wird einmal, nach der Interceptor-Chain, also wird eine Response, die ein Interceptor mit
`makeResponse(...)` gebaut hat, genau wie eine von der Leitung gelesen. Bei einer JSON-Representation ist ein
String-Body eine JSON-String-Wurzel.

Eine erfolgreiche Response ist ein `DecodedResponse<T>`: `url`, `status`, `statusText`, `headers`, `ok` und
ein typisiertes `body`. Wo nichts dekodiert wurde, bekommst du `HttpMeta` — dieselben Felder ohne `body`. `ok`
bedeutet nur `200 <= status < 300`. Keines von beiden ist eine native `Response`. Ein Transport-Failure ist ein Fault, also
gibt es keine Status-0-Response, die dafür einsteht.

## Arbeit canceln {#cancel-the-work}

Execution-Options nehmen `signal` plus entweder `abort` oder `timeout`. **`abort` und `timeout` sind mutually exclusive.** `signal` kann mit jedem der beiden kombiniert werden.

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

`timeout` muss eine positive Safe Integer in `1..2_147_483_647` sein. Recognized Cancel → `NET_ABORTED`; Execution-Timeout → `NET_TIMEOUT`; Interceptor-`throw` → `EXT_INTERCEPTOR_FAILED`; andere Fetch-Failures → `NET_UNREACHABLE`. Cancel nach akzeptiertem Server-Write beweist **nicht**, dass der Write zurückgerollt wurde.

## Credentials und XSRF

`withCredentials(true)` setzt Fetch `credentials: 'include'` für HTTP und SSE. Es erzeugt kein `Authorization` und konfiguriert keine WebSocket-Auth. `false` lässt Credentials unspecified.

`withXSRF(...)` ist HTTP-only. Defaults: `cookieName: 'XSRF-TOKEN'`, `headerName: 'X-XSRF-TOKEN'`. Header injectet nur für Non-Safe Methods, nur wenn der Caller ihn nicht schon gesetzt hat, und nur für Same-Origin-Browser-Requests. Skippt `GET`, `HEAD`, `OPTIONS`, `TRACE`. Außerhalb eines Browsers gib einen synchronen request-scoped `tokenProvider`, wenn du Injection brauchst.

Halte Credentials, XSRF-Tokens und Query Strings aus Routine-Logs. Nutze Query-Params nicht als allgemeinen Credential-Kanal.

## Progress und die Fetch-Grenze

`onDownloadProgress` läuft, während ein deklarierter Response-Body gelesen wird. `lengthComputable` ist nur bei positivem `Content-Length` true. Kein Struct für diese Seite → der Body wird nicht gelesen → kein Body-Read-Progress.

`onUploadProgress` beobachtet einen `ReadableStream<Uint8Array>`-Request-Body, während Fetch ihn liest. Ein JSON- oder Text-Body ist nicht dieser Stream — gib `file.stream()` (oder einen anderen `ReadableStream`) aus dem Builder zurück, wenn du Upload-Progress brauchst. Der Transport meldet einen Capability-Error, wenn die Runtime keinen gestreamten Body senden kann.

`fetchHandler(httpRequest, fetchImpl?)` ist die niedrigere Fetch-Grenze: baut einen nativen `Request`, ruft Fetch, liest die Representation, gibt `HttpResponse` zurück. Es validiert **nicht** Command-Input, dispatcht kein `output` und läuft keine Interceptors. Nützlich für injizierte Transport-Tests — kein Ersatz für `client.execute`.

## Replay-Limits

Defjs auto-retried HTTP **nicht**. Einen Read zu retryen braucht trotzdem eine reviewed Timeout-/Network-/Duplicate-Policy. Eine Mutation zu retryen braucht replayable Bytes, Server-Support, einen Idempotency-Key gebunden an Auth-Scope + Request-Bytes und eine Receiver-Duplicate-Policy.

Eine Client-/Command-/Fetch-Grenze kann nicht wissen, ob ein failed Write committed hat. Halte Replay-Entscheidungen in der App oder einem reviewed Interceptor. Interceptors können den Low-Level-Request short-circuiten oder ersetzen; finaler Status und Body müssen trotzdem den Command-Vertrag erfüllen.

## Verwandte Rezepte

- [GET mit deklariertem 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [HTTP-Aufruf abbrechen](../recipes/cancel-http.md)
- [Mit lokalem Fetch-Handle testen](../recipes/test-with-handle.md)
