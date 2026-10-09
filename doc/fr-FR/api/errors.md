---
title: Erreurs
description: Variantes de fault et helpers de fabrique.
---

# Errors

Execute renvoie un `Fault` discriminé dans le premier emplacement du tuple — pas une exception jetée pour les échecs déclarés.

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

Un ensemble fermé. Le segment avant le premier `_` est la classe ; il n’y a pas de champ `kind` séparé. L’ensemble reste fermé pour que `switch (fault.code)` soit exhaustif — les extensions rapportent leur propre détail via `cause`, pas via un nouveau code.

## FaultClass {#FaultClass}

```ts
type FaultClass<C extends string> = C extends `${infer TClass}_${string}` ? TClass : never
```

`FaultClass<FaultCode>` vaut `'CAP' | 'ENV' | 'EXT' | 'HTTP' | 'NET' | 'REQ' | 'RES'`.

## Fault {#Fault}

```ts
type Fault<TErr extends AnyStruct | undefined = undefined> = DecodeFault | HttpStatusFault<TErr> | PreflightFault
```

Switche sur `fault.code`.

Chaque variante est un `Error` natif nommé `DefjsFault`, donc `String(fault)` produit un `DefjsFault: <message>` directement logable. `code` et les métadonnées de variante — `status`, `response`, `data` — sont des propriétés propres énumérables. La chaîne native `cause` n’est pas énumérable.

```ts
import { StructError, type Fault } from '@defjs/core'

function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

N’appelle `format()`, `flatten()` ou `prettify()` qu’après avoir restreint `fault.cause` à `StructError` ; ces helpers ne sont pas copiés sur le fault.

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

N’importe quel statut non-2xx. Si l’endpoint a déclaré `error` et que le corps a décodé, `data` est ce corps et `response` le porte. Si `error` a été omis, le corps n’est jamais lu : `data` reste donc `undefined` et `response` n’est que des métadonnées.

### DecodeFault {#DecodeFault}

```ts
type DecodeFault = Error & {
  cause: unknown
  code: 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID' | 'RES_STRUCT_MISMATCH'
  response: HttpMeta
  status: number
}
```

Une réponse est arrivée mais n’a pas pu être lue telle que déclarée. `response` n’est que des métadonnées : un corps **est** une valeur décodée, et c’est justement le décodage qui a échoué, donc il n’y a pas de champ `body` où aller chercher. Le détail fautif vit sur `cause` — un `StructError` pour un écart de struct, l’échec du parser pour une représentation illisible.

### PreflightFault {#PreflightFault}

```ts
type PreflightFault = Error & {
  cause?: unknown
  code: PreflightFaultCode
  response?: HttpMeta
}
```

Tout ce qui a pu échouer avant qu’une réponse existe : `REQ_*`, `NET_*`, `EXT_*`, `CAP_*`, `ENV_UNSUPPORTED`. `response` n’est présent que là où le transport avait déjà des métadonnées à rapporter, comme un corps tronqué en pleine descente.

### AnyFault {#AnyFault}

```ts
type AnyFault = DecodeFault | HttpStatusFaultOf<undefined> | HttpStatusFaultOf<unknown> | PreflightFault
```

N’importe quel fault, quel que soit le type de son corps d’erreur décodé. Utilise-le pour des handlers qui classent les faults sans se soucier de l’endpoint qui les a produits ; préfère `Fault<typeof yourErrorStruct>` là où le type du corps compte.

## Fabriques

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

`createHttpStatusFault` prend une réponse qui porte déjà le corps décodé ; `createUndecodedHttpStatusFault` ne prend que des métadonnées, pour un endpoint qui n’a déclaré aucun `error`.

`createNetworkFault` associe les sentinelles d’abort et de timeout à `NET_ABORTED` / `NET_TIMEOUT` et tout le reste à `NET_UNREACHABLE`. `createPreflightFault` prend le code directement ; sans `cause`, le code devient le message.

Toutes les fabriques renvoient des instances d’`Error` natif avec les champs structurés ci-dessus ; elles ne créent pas d’erreurs en objet nu et n’ont besoin d’aucun adaptateur pour `String(fault)`.

## Sentinelles

## ERR_ABORTED {#ERR_ABORTED}

## ERR_TIMEOUT {#ERR_TIMEOUT}

```ts
const ERR_ABORTED: Error // message: 'Request was aborted'
const ERR_TIMEOUT: Error // message: 'Request timed out'
```

Valeurs de `cause` / message partagées pour l’abort et le timeout. En throw une depuis un intercepteur, c’est ainsi qu’un intercepteur exprime une annulation.

Voir le [guide Errors](/core/errors).
