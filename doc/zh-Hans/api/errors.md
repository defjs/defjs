---
title: Errors
description: Fault 的各个变体与工厂 helper。
---

# Errors

Execute 把一个可判别的 `Fault` 放在元组第一项——声明过的失败不抛异常。

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

一个封闭集合。第一个 `_` 之前那段就是类别；没有单独的 `kind` 字段。集合保持封闭，`switch (fault.code)` 才能穷尽——扩展报自己的细节走 `cause`，不是加新 code。

## FaultClass {#FaultClass}

```ts
type FaultClass<C extends string> = C extends `${infer TClass}_${string}` ? TClass : never
```

`FaultClass<FaultCode>` 是 `'CAP' | 'ENV' | 'EXT' | 'HTTP' | 'NET' | 'REQ' | 'RES'`。

## Fault {#Fault}

```ts
type Fault<TErr extends AnyStruct | undefined = undefined> = DecodeFault | HttpStatusFault<TErr> | PreflightFault
```

对 `fault.code` 做 switch。

每个变体都是名为 `DefjsFault` 的原生 `Error`，所以 `String(fault)` 直接给出可写日志的 `DefjsFault: <message>`。`code` 和各变体元数据——`status`、`response`、`data`——都是可枚举的自有属性。原生 `cause` 链不可枚举。

```ts
import { StructError, type Fault } from '@defjs/core'

function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

只有把 `fault.cause` 窄化到 `StructError` 之后，才能调 `format()`、`flatten()` 或 `prettify()`；这些 helper 不会被复制到 fault 上。

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

任何非 2xx 状态。端点声明过 `error` 且 body 解码成功时，`data` 就是那个 body，`response` 也带着它。省略了 `error` 时 body 根本不会被读，于是 `data` 是 `undefined`，`response` 只有元数据。

### DecodeFault {#DecodeFault}

```ts
type DecodeFault = Error & {
  cause: unknown
  code: 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID' | 'RES_STRUCT_MISMATCH'
  response: HttpMeta
  status: number
}
```

响应到了，但没法按声明读出来。`response` 只有元数据：body 就是解码后的值，而解码本身失败了，所以没有 `body` 字段可取。出错细节在 `cause` 上——struct 不匹配时是 `StructError`，表示读不出来时是解析器的失败。

### PreflightFault {#PreflightFault}

```ts
type PreflightFault = Error & {
  cause?: unknown
  code: PreflightFaultCode
  response?: HttpMeta
}
```

所有可能在响应存在之前就失败的情况：`REQ_*`、`NET_*`、`EXT_*`、`CAP_*`、`ENV_UNSUPPORTED`。只有传输层当时确实有元数据可报时才带 `response`，比如下载中途被截断的 body。

### AnyFault {#AnyFault}

```ts
type AnyFault = DecodeFault | HttpStatusFaultOf<undefined> | HttpStatusFaultOf<unknown> | PreflightFault
```

任何 fault，不论它解码后的错误 body 是什么类型。写那种只做分类、不在乎是哪个端点产出的 handler 时用它；body 类型要紧的地方优先用 `Fault<typeof yourErrorStruct>`。

## 工厂

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

`createHttpStatusFault` 收一个已经带着解码后 body 的响应；`createUndecodedHttpStatusFault` 只收元数据，给那些没声明 `error` 的端点用。

`createNetworkFault` 把 abort 和 timeout 哨兵映射到 `NET_ABORTED` / `NET_TIMEOUT`，其余一律映射到 `NET_UNREACHABLE`。`createPreflightFault` 直接收 code；不给 `cause` 时，code 就成了 message。

所有工厂都返回带上述结构化字段的原生 `Error` 实例；它们不造普通对象错误，`String(fault)` 也不需要适配器。

## 哨兵

## ERR_ABORTED {#ERR_ABORTED}

## ERR_TIMEOUT {#ERR_TIMEOUT}

```ts
const ERR_ABORTED: Error // message: 'Request was aborted'
const ERR_TIMEOUT: Error // message: 'Request timed out'
```

abort 和 timeout 共享的 `cause` / message 值。从拦截器里抛一个出来，就是拦截器表达取消的方式。

见 [Errors 指南](/core/errors)。
