---
title: الأخطاء
description: أنواع الأخطاء ودوال المصانع.
---

# Errors

يُعيد التنفيذ `Fault` مُميَّزًا في الخانة الأولى من الـ tuple — لا استثناءً مرميًّا في حالات الفشل المعلَنة.

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

مجموعة مغلقة واحدة. والمقطع الذي يسبق أول `_` هو الصنف؛ ولا يوجد حقل `kind` منفصل. وتبقى المجموعة مغلقة حتى يكون `switch (fault.code)` مستنفدًا — فالإضافات تُبلِّغ عن تفصيلها عبر `cause` لا عبر رمز جديد.

## FaultClass {#FaultClass}

```ts
type FaultClass<C extends string> = C extends `${infer TClass}_${string}` ? TClass : never
```

`FaultClass<FaultCode>` هو `'CAP' | 'ENV' | 'EXT' | 'HTTP' | 'NET' | 'REQ' | 'RES'`.

## Fault {#Fault}

```ts
type Fault<TErr extends AnyStruct | undefined = undefined> = DecodeFault | HttpStatusFault<TErr> | PreflightFault
```

بدِّل على `fault.code`.

كل صيغة هي `Error` أصلي باسم `DefjsFault`، فـ `String(fault)` يُنتج `DefjsFault: <message>` قابلًا للتسجيل مباشرة. و`code` وبيانات الصيغة الوصفية — `status` و`response` و`data` — خصائص ذاتية قابلة للتعداد. أما سلسلة `cause` الأصلية فغير قابلة للتعداد.

```ts
import { StructError, type Fault } from '@defjs/core'

function logFault(fault: Fault): void {
  console.error(String(fault), { code: fault.code })
  if (fault.cause instanceof StructError) {
    console.error(fault.cause.prettify())
  }
}
```

لا تستدعِ `format()` أو `flatten()` أو `prettify()` إلا بعد تضييق `fault.cause` إلى `StructError`؛ فهذه الدوال لا تُنسخ إلى الخطأ.

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

أي حالة غير-2xx. فإن أعلنت نقطة النهاية `error` وفُكّ الجسم، كان `data` هو ذلك الجسم و`response` يحمله. وإن حُذف `error` فالجسم لا يُقرأ أبدًا، فيبقى `data` بقيمة `undefined` ويكون `response` بيانات وصفية وحدها.

### DecodeFault {#DecodeFault}

```ts
type DecodeFault = Error & {
  cause: unknown
  code: 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID' | 'RES_STRUCT_MISMATCH'
  response: HttpMeta
  status: number
}
```

وصلت استجابة لكن تعذّرت قراءتها كما أُعلن. و`response` بيانات وصفية فقط: فالجسم **هو** القيمة المفكوكة، والفكّ نفسه هو ما فشل، فلا حقل `body` يمكن الوصول إليه. والتفصيل المسبِّب يعيش على `cause` — `StructError` عند عدم مطابقة struct، وفشل المحلِّل عند تمثيل غير مقروء.

### PreflightFault {#PreflightFault}

```ts
type PreflightFault = Error & {
  cause?: unknown
  code: PreflightFaultCode
  response?: HttpMeta
}
```

كل ما كان يمكن أن يفشل قبل وجود استجابة: `REQ_*` و`NET_*` و`EXT_*` و`CAP_*` و`ENV_UNSUPPORTED`. ولا يكون `response` موجودًا إلا حيث كانت لدى طبقة النقل بيانات وصفية تُبلِّغ عنها أصلًا، كجسم انقطع في منتصف التنزيل.

### AnyFault {#AnyFault}

```ts
type AnyFault = DecodeFault | HttpStatusFaultOf<undefined> | HttpStatusFaultOf<unknown> | PreflightFault
```

أيّ خطأ، بصرف النظر عن نوع جسم خطئه المفكوك. استخدمه للمعالِجات التي تُصنِّف الأخطاء دون أن يهمّها أي نقطة نهاية أنتجتها؛ وفضِّل `Fault<typeof yourErrorStruct>` حيث يهمّ نوع الجسم.

## المصانع

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

`createHttpStatusFault` يأخذ استجابة تحمل الجسم المفكوك أصلًا؛ و`createUndecodedHttpStatusFault` يأخذ البيانات الوصفية وحدها، لنقطة نهاية لم تُعلن `error`.

`createNetworkFault` يربط علامتَي الإلغاء والمهلة بـ `NET_ABORTED` / `NET_TIMEOUT`، وكل ما عداهما بـ `NET_UNREACHABLE`. و`createPreflightFault` يأخذ الرمز مباشرة؛ فإن لم يُمرَّر `cause` صار الرمز هو الرسالة.

كل المصانع تُعيد نسخًا من `Error` الأصلي بالحقول المهيكلة أعلاه؛ وهي لا تُنشئ أخطاءً ككائنات عادية ولا تحتاج مُهايئًا لـ `String(fault)`.

## العلامات

## ERR_ABORTED {#ERR_ABORTED}

## ERR_TIMEOUT {#ERR_TIMEOUT}

```ts
const ERR_ABORTED: Error // message: 'Request was aborted'
const ERR_TIMEOUT: Error // message: 'Request timed out'
```

قيمتا `cause` / الرسالة المشتركتان للإلغاء والمهلة. ورميُ إحداهما من معترض هو الطريقة التي يعبّر بها المعترض عن الإلغاء.

راجع [دليل الأخطاء](/core/errors).
