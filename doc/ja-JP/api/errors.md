---
title: Errors
description: Fault のバリアントとファクトリー helper。
---

# Errors

Execute は判別可能な `Fault` をタプルの第一要素に返します。宣言済みの失敗で例外を throw することはありません。

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

閉じた集合ひとつです。最初の `_` より前の部分が類別で、独立した `kind` field はありません。集合を閉じたままにするのは `switch (fault.code)` を網羅的に保つためで、拡張は自分の詳細を新しい code ではなく `cause` で報告します。

## FaultClass {#FaultClass}

```ts
type FaultClass<C extends string> = C extends `${infer TClass}_${string}` ? TClass : never
```

`FaultClass<FaultCode>` は `'CAP' | 'ENV' | 'EXT' | 'HTTP' | 'NET' | 'REQ' | 'RES'` です。

## Fault {#Fault}

```ts
type Fault<TErr extends AnyStruct | undefined = undefined> = DecodeFault | HttpStatusFault<TErr> | PreflightFault
```

`fault.code` で switch してください。

どのバリアントも `DefjsFault` という名前のネイティブ `Error` なので、`String(fault)` はそのままログに出せる `DefjsFault: <message>` を返します。`code` と各バリアントのメタデータ — `status`、`response`、`data` — は列挙可能な自前プロパティです。ネイティブの `cause` チェーンは列挙されません。

```ts
import { StructError, type Fault } from '@defjs/core'

function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

`format()`、`flatten()`、`prettify()` は `fault.cause` を `StructError` に絞り込んだあとでのみ呼んでください。これらの helper は fault にコピーされません。

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

2xx 以外のあらゆる status です。エンドポイントが `error` を宣言していてボディがデコードできたなら、`data` はそのボディで、`response` もそれを持ちます。`error` を省いた場合ボディは読まれないので、`data` は `undefined`、`response` はメタデータだけになります。

### DecodeFault {#DecodeFault}

```ts
type DecodeFault = Error & {
  cause: unknown
  code: 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID' | 'RES_STRUCT_MISMATCH'
  response: HttpMeta
  status: number
}
```

レスポンスは届いたものの、宣言どおりには読めませんでした。`response` はメタデータだけです。ボディ**とは**デコード済みの値であり、そのデコードが失敗したのですから、手を伸ばす `body` field は存在しません。問題の詳細は `cause` にあります — struct 不一致なら `StructError`、表現が読めないならパーサーの失敗です。

### PreflightFault {#PreflightFault}

```ts
type PreflightFault = Error & {
  cause?: unknown
  code: PreflightFaultCode
  response?: HttpMeta
}
```

レスポンスが存在する前に失敗しえたものすべてです。`REQ_*`、`NET_*`、`EXT_*`、`CAP_*`、`ENV_UNSUPPORTED`。`response` が付くのは、トランスポートが報告できるメタデータを既に持っていた場合だけ — たとえばダウンロード途中で切れたボディなどです。

### AnyFault {#AnyFault}

```ts
type AnyFault = DecodeFault | HttpStatusFaultOf<undefined> | HttpStatusFaultOf<unknown> | PreflightFault
```

デコード済みエラーボディの型を問わない、あらゆる fault です。どのエンドポイントが出したかを気にせず fault を分類するハンドラーに使ってください。ボディの型が重要な場所では `Fault<typeof yourErrorStruct>` を選びます。

## ファクトリー

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

`createHttpStatusFault` はデコード済みのボディを既に持つレスポンスを受け取ります。`createUndecodedHttpStatusFault` はメタデータだけを受け取り、`error` を宣言していないエンドポイント向けです。

`createNetworkFault` は abort と timeout のセンチネルを `NET_ABORTED` / `NET_TIMEOUT` に、それ以外をすべて `NET_UNREACHABLE` に対応づけます。`createPreflightFault` は code を直接受け取り、`cause` を渡さなければ code がそのまま message になります。

どのファクトリーも、上記の構造化 field を備えたネイティブ `Error` インスタンスを返します。素のオブジェクトエラーは作らないので、`String(fault)` にアダプターは不要です。

## センチネル

## ERR_ABORTED {#ERR_ABORTED}

## ERR_TIMEOUT {#ERR_TIMEOUT}

```ts
const ERR_ABORTED: Error // message: 'Request was aborted'
const ERR_TIMEOUT: Error // message: 'Request timed out'
```

abort と timeout で共有される `cause` / message の値です。インターセプターからどちらかを throw するのが、インターセプターがキャンセルを表す方法です。

[Errors ガイド](/core/errors) を参照してください。
