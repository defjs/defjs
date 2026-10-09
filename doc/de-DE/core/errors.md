---
title: Errors
description: Verzweige über eine geschlossene Menge von Fault-Codes für 404s, Timeouts, unlesbare Bodies und Transport-Failures.
---

# Errors

Behandle eine 404, einen Timeout oder einen unlesbaren Body, indem du das Error-first-Tuple liest — nicht indem du Throws catchst. Ein `Fault` ist ein nativer `Error` (`instanceof Error` ist true), diskriminiert über genau ein Feld: `code`.

Es gibt kein `kind`. Die Klasse eines Failures ist das Segment vor dem ersten `_` im Code, also ist `NET_TIMEOUT` ein `NET`-Failure und `RES_STRUCT_MISMATCH` ein `RES`-Failure. Lies den Prefix für die grobe Triage und den ganzen Code für den genauen Fall.

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

Weil die Menge geschlossen ist, ist ein `switch` über `code` exhaustiv:

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

## Stabile Codes

| Klasse | Codes                                                                  | Wer sich ändern muss                                             |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `HTTP` | `HTTP_STATUS`                                                          | Der Peer hat Non-2xx geantwortet; behandle es als Business-Logik |
| `REQ`  | `REQ_INPUT_INVALID`, `REQ_OPTIONS_INVALID`, `REQ_BUILD_FAILED`         | Der Call oder die Endpoint-Deklaration                           |
| `NET`  | `NET_ABORTED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `NET_BODY_INCOMPLETE` | Niemand, oder Retry                                              |
| `RES`  | `RES_MEDIA_TYPE_INVALID`, `RES_DECODE_FAILED`, `RES_STRUCT_MISMATCH`   | Deklaration und Peer müssen in Einklang gebracht werden          |
| `EXT`  | `EXT_INTERCEPTOR_FAILED`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`     | Der Code, den du an die Pipeline gehängt hast                    |
| `CAP`  | `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`                            | Ein deklariertes Limit, oder das Tempo des Consumers             |
| `ENV`  | `ENV_UNSUPPORTED`                                                      | Die Host-Runtime                                                 |

Die Menge ist absichtlich geschlossen: genau das hält ein `switch` exhaustiv. Extensions melden ihr eigenes Detail über `cause`, nicht über einen neuen Code.

### Felder je Shape

| Code          | `status` | `response`                                                           | `data`                                     |
| ------------- | -------- | -------------------------------------------------------------------- | ------------------------------------------ |
| `HTTP_STATUS` | Immer    | Immer; hat `body` nur, wenn `error` deklariert war und dekodiert hat | Dekodierter `error`-Body, oder `undefined` |
| `RES_*`       | Immer    | Immer, nur Metadaten — **kein `body`**                               | Fehlt                                      |
| Alles andere  | Fehlt    | Nur dort, wo der Transport schon Metadaten hatte                     | Fehlt                                      |

`cause` trägt den zugrundeliegenden Wert: ein `StructError` bei einem Struct-Mismatch, das Parser-Failure bei einer unlesbaren Representation, was auch immer eine Extension geworfen hat.

## Tuple-Shapes je Transport

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

Bei einem HTTP-Failure ist der dritte Slot `undefined`: der Fault trägt bereits alle Response-Metadaten, die es gab. Das ist wichtig, weil der Fault das ist, was du an einen Handler gibst, loggst oder rethrowst — die Metadaten müssen also _mit_ ihm reisen, nicht neben ihm.

Bei SSE und WebSocket ist der dritte Slot ein Startup-Snapshot, der auch dann da sein kann, wenn der Startup fehlschlug. Nachdem ein Handle oder eine Session zurückgegeben wurde, leben spätere Failures auf deren Lifecycle — sie schreiben das abgeschlossene Startup-Tuple nie um.

## Wie ein Body gelesen wird

`ok` ist die einzige Verzweigung, und es dekodiert immer nur eine Seite. `output` liest einen 2xx-Body; `error` liest alles andere. Eine Seite auszulassen heißt, dass dieser Body nie gelesen wird.

| Situation                                                           | Ergebnis                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 2xx, `output` deklariert, Body dekodiert                            | Erfolg; `data` und `response.body` typisiert                       |
| 2xx, `output` ausgelassen                                           | Erfolg; `data` ist `undefined`, die Response hat kein `body`       |
| Non-2xx, `error` deklariert, Body dekodiert                         | `HTTP_STATUS` mit typisiertem `data`                               |
| Non-2xx, `error` ausgelassen                                        | `HTTP_STATUS` mit `data: undefined`                                |
| Der Media-Type ist nicht der, den die Representation braucht        | `RES_MEDIA_TYPE_INVALID`, gemeldet **bevor** der Body gelesen wird |
| Die Bytes sind nicht diese Representation                           | `RES_DECODE_FAILED`                                                |
| Der Wert ist nicht dieser Struct                                    | `RES_STRUCT_MISMATCH`                                              |
| Ein unlesbarer Body auf der Seite, die du **nicht** deklariert hast | Komplett ignoriert — siehe unten                                   |

Die letzte Zeile ist die, die man sich merken sollte. Hast du `output` deklariert, aber nicht `error`, wird eine 500 mit kaputtem JSON-Body als `HTTP_STATUS` mit `status: 500` gemeldet. Du hast gesagt, Error-Bodies interessieren dich nicht — und dazu gehört, dass es dich auch nicht interessiert, dass einer nicht lesbar war.

Dekodiert wird einmal, nach der Interceptor-Chain. Eine Response, die ein Interceptor mit `makeResponse(...)` gebaut hat, geht durch dieselbe Media-Type-Prüfung und denselben Struct wie eine von der Leitung.

`HttpResponse.ok` bedeutet nur `200 <= status < 300`. Ein Transport-Failure ist ein Fault, niemals eine Response — es gibt keine Status-0-Response, die dafür einsteht.

## Eine Error-Body-Union einengen

Ein einzelner `error`-Struct deckt jeden Non-2xx-Status ab, also deklarierst du eine Union, wenn die Shapes abweichen. Was du danach mit `fault.data` machen kannst, hängt vollständig davon ab, wie du diese Union deklariert hast — die Library gibt dir genau den Typ zurück, den du angefordert hast.

`struct.or(...)` erzeugt eine einfache Union, die TypeScript nicht von selbst einengen kann. Prüfe auf das Feld, das du brauchst:

```typescript twoslash
import { struct, type Fault } from '@defjs/core'

const ApiError = struct.or(struct.object({ message: struct.string() }), struct.object({ retryAfter: struct.number() }))

declare const fault: Fault<typeof ApiError>

if (fault.code === 'HTTP_STATUS' && 'retryAfter' in fault.data) {
  console.log(fault.data.retryAfter)
}
```

`struct.discriminatedUnion(...)` engt über ein Feld ein, das der Body tatsächlich trägt — die bequeme Form, wenn die API ihre Errors schon taggt:

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

Wenn die API den Status **im** Body führt, diskriminiere darüber statt über `fault.status`:

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

Die letzte Form ist vorzuziehen, wo die API sie unterstützt. `fault.status` ist die Zahl der HTTP-Schicht, die ein Proxy, ein Gateway oder ein CDN umschreiben kann; `data.status` wurde aus dem Body dekodiert, den dein `error`-Struct zugesichert hat — dort hinzukommen ist also der Beweis, dass das Backend ihn erzeugt hat.

Eine nicht diskriminierte Union, die sich nicht einengen lässt, ist eine Eigenschaft der Deklaration, nicht der Library — sie gibt dir den Typ, den du deklariert hast. Füge dem Struct einen Diskriminanten hinzu, wenn du einen willst.

## Startup vs. nach dem Öffnen

SSE validiert Status, `text/event-stream` und die Anwesenheit eines Bodys, bevor das Handle resolved wird. Non-2xx → `HTTP_STATUS`. Falscher Media-Type → `RES_MEDIA_TYPE_INVALID`. Fehlender Body → `RES_DECODE_FAILED`. Der Opening-Snapshot kann trotzdem im dritten Tuple-Slot landen.

Der WebSocket-Startup umfasst den Handshake plus das erste physische Open. Constructor-Failure, Close vor dem Open, Timeout oder Cancel erzeugen alle ein Startup-Tuple. Ein Connection-Snapshot kann existieren, auch wenn der Socket `open` nie erreicht hat.

| Transport | Nach dem Startup                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSE       | Der Iterator rejectet bei einem fatalen Error; `stream.closed` resolved mit `kind: 'error'` und dem Fault-`code`                                                   |
| WebSocket | `onRuntimeError` für Message-/Queue-/Heartbeat-Failures; `receive` schlägt bei terminalen Errors fehl; `session.closed` → `kind: 'closed' \| 'aborted' \| 'error'` |
| HTTP      | Das Execute-Promise settled einmal. Interceptor- und Callback-Code kann außerhalb der Tuple-Normalisierung immer noch throwen                                      |

`NET_ABORTED` / `NET_TIMEOUT` beschreiben, was der Caller beim Startup gesehen hat. Du schließt einen zurückgegebenen Stream oder eine Session trotzdem und awaitest deren terminales Promise.

## Native-Error-Logging und cause

Faults sind native `Error`-Instanzen, es braucht also keinen Diagnose-Adapter. `String(fault)` liefert die stabile native Form `DefjsFault: <message>`. `code` und die Varianten-Felder — `status`, `response`, `data` — bleiben für strukturiertes Logging enumerable; `name` und die native `cause`-Chain sind non-enumerable.

```typescript twoslash
import { StructError, type Fault } from '@defjs/core'

export function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

Enge `fault.cause instanceof StructError` ein, bevor du `format()`, `flatten()` oder `prettify()` aufrufst. Diese Helper leben auf der Struct-Cause; sie werden nicht auf den Fault kopiert. Lass Control-Flow nicht `message` oder `String(fault)` parsen — `code` und ein reviewter `status` sind der Vertrag.

## Referenz

| Branch                    | Control-Flow-Check                 | Nützliche stabile Felder                  | Meist absent / sensibel                |
| ------------------------- | ---------------------------------- | ----------------------------------------- | -------------------------------------- |
| HTTP-Status-Policy        | `fault.code === 'HTTP_STATUS'`     | `fault.status`, reviewtes `fault.data`    | Body, Headers, URL, `cause`            |
| Caller-Cancellation       | `fault.code === 'NET_ABORTED'`     | `code`                                    | Abort-Grund und Stack                  |
| Timeout                   | `fault.code === 'NET_TIMEOUT'`     | `code`                                    | Request-URL und zugrundeliegende Cause |
| Der Vertrag brach         | `fault.code.startsWith('RES_')`    | `code`, reviewtes `fault.response.status` | Struct-Issues, Body, Input-Werte       |
| Dein eigener Code throwte | `fault.code.startsWith('EXT_')`    | `code`, `cause`                           | Was auch immer die Extension anhängte  |
| Stream-/Session-Runtime   | `stream.closed` / `session.closed` | Terminales `kind` und `code`              | Event-Payloads, Frames, Causes         |

Behandle `cause`, `data`, Response-Headers und -Bodies, URLs, Struct-Issues, Input-Werte und Stacks als sensibel. Eine konservative Zusammenfassung:

```typescript twoslash
import type { Fault } from '@defjs/core'

export function summarize(fault: Fault): { code: Fault['code']; status?: number } {
  return {
    code: fault.code,
    status: 'status' in fault ? fault.status : undefined,
  }
}
```

`createNetworkFault`, `createPreflightFault`, `createDecodeFault`, `createHttpStatusFault` und `createUndecodedHttpStatusFault` bauen diese nativen Error-Werte. Normale Request-Failures werden weiterhin im Tuple zurückgegeben; sie werden nicht geworfen, bloß weil sie natives Error-Verhalten erben. `ERR_ABORTED` und `ERR_TIMEOUT` sind die gemeinsamen Causes, die der Transport-Normalisierer erkennt.

## Verwandte Rezepte

- [GET mit deklarierter 404](../recipes/get-declared-404.md)
- [Einen HTTP-Call canceln](../recipes/cancel-http.md)
