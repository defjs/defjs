---
title: 錯誤
description: Fault 的各個變體與工廠 helper。
---

# Errors

Execute 把一個可判別的 `Fault` 放在 tuple 第一項——宣告過的失敗不丟例外。

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

一個封閉集合。第一個 `_` 之前那段就是類別；沒有獨立的 `kind` 欄位。集合保持封閉，`switch (fault.code)` 才能窮盡——擴充報自己的細節走 `cause`，不是加新 code。

## FaultClass {#FaultClass}

```ts
type FaultClass<C extends string> = C extends `${infer TClass}_${string}` ? TClass : never
```

`FaultClass<FaultCode>` 是 `'CAP' | 'ENV' | 'EXT' | 'HTTP' | 'NET' | 'REQ' | 'RES'`。

## Fault {#Fault}

```ts
type Fault<TErr extends AnyStruct | undefined = undefined> = DecodeFault | HttpStatusFault<TErr> | PreflightFault
```

對 `fault.code` 做 switch。

每個變體都是名為 `DefjsFault` 的原生 `Error`，所以 `String(fault)` 直接給出可寫 log 的 `DefjsFault: <message>`。`code` 與各變體 metadata——`status`、`response`、`data`——都是可列舉的自有屬性。原生 `cause` 鏈不可列舉。

```ts
import { StructError, type Fault } from '@defjs/core'

function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

只有把 `fault.cause` 窄化到 `StructError` 之後，才能呼叫 `format()`、`flatten()` 或 `prettify()`；這些 helper 不會被複製到 fault 上。

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

任何非 2xx 狀態。端點宣告過 `error` 且 body 解碼成功時，`data` 就是那個 body，`response` 也帶著它。省略了 `error` 時 body 根本不會被讀，於是 `data` 是 `undefined`，`response` 只有 metadata。

### DecodeFault {#DecodeFault}

```ts
type DecodeFault = Error & {
  cause: unknown
  code: 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID' | 'RES_STRUCT_MISMATCH'
  response: HttpMeta
  status: number
}
```

回應到了，但沒法按宣告讀出來。`response` 只有 metadata：body 就是解碼後的值，而解碼本身失敗了，所以沒有 `body` 欄位可取。出錯細節在 `cause` 上——struct 不匹配時是 `StructError`，表示讀不出來時是 parser 的失敗。

### PreflightFault {#PreflightFault}

```ts
type PreflightFault = Error & {
  cause?: unknown
  code: PreflightFaultCode
  response?: HttpMeta
}
```

所有可能在回應存在之前就失敗的情況：`REQ_*`、`NET_*`、`EXT_*`、`CAP_*`、`ENV_UNSUPPORTED`。只有傳輸層當時確實有 metadata 可報時才帶 `response`，例如下載中途被截斷的 body。

### AnyFault {#AnyFault}

```ts
type AnyFault = DecodeFault | HttpStatusFaultOf<undefined> | HttpStatusFaultOf<unknown> | PreflightFault
```

任何 fault，不論它解碼後的錯誤 body 是什麼型別。寫那種只做分類、不在乎是哪個端點產出的 handler 時用它；body 型別要緊的地方優先用 `Fault<typeof yourErrorStruct>`。

## 工廠

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

`createHttpStatusFault` 收一個已經帶著解碼後 body 的回應；`createUndecodedHttpStatusFault` 只收 metadata，給那些沒宣告 `error` 的端點用。

`createNetworkFault` 把 abort 與 timeout 哨兵對應到 `NET_ABORTED` / `NET_TIMEOUT`，其餘一律對應到 `NET_UNREACHABLE`。`createPreflightFault` 直接收 code；不給 `cause` 時，code 就成了 message。

所有工廠都回傳帶上述結構化欄位的原生 `Error` 實例；它們不造普通物件錯誤，`String(fault)` 也不需要 adapter。

## 哨兵

## ERR_ABORTED {#ERR_ABORTED}

## ERR_TIMEOUT {#ERR_TIMEOUT}

```ts
const ERR_ABORTED: Error // message: 'Request was aborted'
const ERR_TIMEOUT: Error // message: 'Request timed out'
```

abort 與 timeout 共享的 `cause` / message 值。從 interceptor 裡丟一個出來，就是 interceptor 表達取消的方式。

見 [Errors 指南](/core/errors)。
