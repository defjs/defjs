---
title: Fehler
description: Fault-Varianten und Factory-Helper.
---

# Errors

Execute gibt einen diskriminierten `Fault` im ersten Tuple-Slot zurück — keine geworfene Exception für deklarierte Failures.

## FaultCode {#FaultCode}

```ts
type FaultCode =
  | 'CAP_BUFFER_EXCEEDED'
  | 'CAP_QUEUE_OVERFLOW'
  | 'ENV_UNSUPPORTED'
  | 'EXT_HOOK_FAILED'
  | 'EXT_INTERCEPTOR_FAILED'
  | 'EXT_OBSERVER_FAILED'
  | 'HTTP_STATUS'
  | 'NET_ABORTED'
  | 'NET_BODY_INCOMPLETE'
  | 'NET_TIMEOUT'
  | 'NET_UNREACHABLE'
  | 'REQ_BUILD_FAILED'
  | 'REQ_INPUT_INVALID'
  | 'REQ_OPTIONS_INVALID'
  | 'RES_DECODE_FAILED'
  | 'RES_MEDIA_TYPE_INVALID'
  | 'RES_STRUCT_MISMATCH'
```

Eine geschlossene Menge. Das Segment vor dem ersten `_` ist die Klasse; ein separates `kind`-Feld gibt es nicht. Die Menge bleibt geschlossen, damit `switch (fault.code)` exhaustiv ist — Extensions melden ihr eigenes Detail über `cause`, nicht über einen neuen Code.

## FaultClass {#FaultClass}

```ts
type FaultClass<C extends string> = C extends `${infer TClass}_${string}` ? TClass : never
```

`FaultClass<FaultCode>` ist `'CAP' | 'ENV' | 'EXT' | 'HTTP' | 'NET' | 'REQ' | 'RES'`.

## Fault {#Fault}

```ts
type Fault<TErr extends AnyStruct | undefined = undefined> = DecodeFault | HttpStatusFault<TErr> | PreflightFault
```

Switche über `fault.code`.

Jede Variante ist ein nativer `Error` mit dem Namen `DefjsFault`, `String(fault)` liefert also ein direkt loggbares `DefjsFault: <message>`. `code` und die Varianten-Metadaten — `status`, `response`, `data` — sind enumerable Own-Properties. Die native `cause`-Chain ist non-enumerable.

```ts
import { StructError, type Fault } from '@defjs/core'

function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

Rufe `format()`, `flatten()` oder `prettify()` erst auf, nachdem du `fault.cause` auf `StructError` eingeengt hast; diese Helper werden nicht auf den Fault kopiert.

### HttpStatusFault {#HttpStatusFault}

```ts
type HttpStatusFaultOf<TData> = Error & {
  code: 'HTTP_STATUS'
  data: TData
  response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>
  status: number
}

type HttpStatusFault<TErr extends AnyStruct | undefined = undefined> = HttpStatusFaultOf<
  [TErr] extends [undefined] ? undefined : Infer<TErr>
>
```

Jeder Non-2xx-Status. Hat der Endpoint `error` deklariert und der Body dekodiert, ist `data` dieser Body und `response` trägt ihn. Wurde `error` ausgelassen, wird der Body nie gelesen — `data` bleibt damit `undefined` und `response` sind Metadaten allein.

### DecodeFault {#DecodeFault}

```ts
type DecodeFault = Error & {
  cause: unknown
  code: 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID' | 'RES_STRUCT_MISMATCH'
  response: HttpMeta
  status: number
}
```

Eine Response kam an, ließ sich aber nicht wie deklariert lesen. `response` sind nur Metadaten: ein Body **ist** ein dekodierter Wert, und genau das Dekodieren ist fehlgeschlagen, es gibt also kein `body`-Feld, nach dem man greifen könnte. Das auslösende Detail liegt auf `cause` — ein `StructError` bei einem Struct-Mismatch, das Parser-Failure bei einer unlesbaren Representation.

### PreflightFault {#PreflightFault}

```ts
type PreflightFault = Error & {
  cause?: unknown
  code: PreflightFaultCode
  response?: HttpMeta
}
```

Alles, was fehlschlagen konnte, bevor eine Response existierte: `REQ_*`, `NET_*`, `EXT_*`, `CAP_*`, `ENV_UNSUPPORTED`. `response` ist nur dort vorhanden, wo der Transport schon Metadaten zu melden hatte — etwa bei einem Body, der mitten im Download abbrach.

### AnyFault {#AnyFault}

```ts
type AnyFault = DecodeFault | HttpStatusFaultOf<undefined> | HttpStatusFaultOf<unknown> | PreflightFault
```

Jeder Fault, unabhängig vom Typ seines dekodierten Error-Bodys. Nutze ihn für Handler, die Faults klassifizieren, ohne sich dafür zu interessieren, welcher Endpoint sie erzeugt hat; bevorzuge `Fault<typeof yourErrorStruct>`, wo der Body-Typ zählt.

## Factories

## createHttpStatusFault() {#createHttpStatusFault}

## createUndecodedHttpStatusFault() {#createUndecodedHttpStatusFault}

## createDecodeFault() {#createDecodeFault}

## createNetworkFault() {#createNetworkFault}

## createPreflightFault() {#createPreflightFault}

```ts
declare function createHttpStatusFault<TData>(response: DecodedResponse<TData>): HttpStatusFaultOf<TData>

declare function createUndecodedHttpStatusFault(response: HttpMeta): HttpStatusFaultOf<undefined>

declare function createDecodeFault(code: DecodeFaultCode, cause: unknown, response: HttpMeta): DecodeFault

declare function createNetworkFault(cause: unknown, response?: HttpMeta): PreflightFault

declare function createPreflightFault(code: PreflightFaultCode, cause?: unknown, response?: HttpMeta): PreflightFault
```

`createHttpStatusFault` nimmt eine Response, die den dekodierten Body schon trägt; `createUndecodedHttpStatusFault` nimmt nur Metadaten — für einen Endpoint, der kein `error` deklariert hat.

`createNetworkFault` mappt die Abort- und Timeout-Sentinels auf `NET_ABORTED` / `NET_TIMEOUT` und alles andere auf `NET_UNREACHABLE`. `createPreflightFault` nimmt den Code direkt; ohne `cause` wird der Code zur Message.

Alle Factories geben native `Error`-Instanzen mit den obigen strukturierten Feldern zurück; sie erzeugen keine Plain-Object-Errors und brauchen für `String(fault)` keinen Adapter.

## Sentinels

## ERR_ABORTED {#ERR_ABORTED}

## ERR_TIMEOUT {#ERR_TIMEOUT}

```ts
const ERR_ABORTED: Error // message: 'Request was aborted'
const ERR_TIMEOUT: Error // message: 'Request timed out'
```

Gemeinsame `cause`-/Message-Werte für Abort und Timeout. Einen davon aus einem Interceptor zu throwen ist die Art, wie ein Interceptor Cancellation ausdrückt.

Siehe [Errors-Guide](/core/errors).
