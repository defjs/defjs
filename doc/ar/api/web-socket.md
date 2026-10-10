---
title: WebSocket
description: defineWebSocket، والجلسة، وخيارات التنفيذ.
---

# WebSocket

أعلن مقبسًا، نفّذه، أرسل/استقبل رسائل مُنوَّعة، ثم أغلق.

## defineWebSocket() {#defineWebSocket}

```ts
function defineWebSocket(definition: WebSocketDefinition): WebSocketEndpoint
```

- **definition** — `path`، وstruct `incoming` واحد، وstructs `outgoing` و`input` اختيارية، و`protocols` ثابتة اختيارية، وحدود الطابور. عند التصريح بـ `input`، يجب دائمًا توفير `builder` صريح، حتى لو كان المدخل يطابق شكل الطلب أصلًا. يمكن حذف `builder` فقط من التعريفات التي لا تصرّح بـ `input`.
- **يُرجع** نقطة نهاية. استدعِها بالمدخل لتحصل على `WebSocketCommand`.

```ts twoslash
import { defineWebSocket, struct } from '@defjs/core'

const chat = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  protocols: ['chat.v1'],
  incoming: struct.object({ text: struct.string(), type: struct.literal('message') }),
  outgoing: struct.object({ text: struct.string(), type: struct.literal('message') }),
})
```

## executeWebSocketCommand() {#executeWebSocketCommand}

```ts
function executeWebSocketCommand(
  clientConfig: ClientConfig,
  command: WebSocketCommand,
  options?: WebSocketExecuteOptions,
): Promise<SocketAwaitResult>
```

مدخل منخفض المستوى لـ `client.execute`. فضّل العميل في شيفرة التطبيق.

- **يُرجع** `[null, session, connection]` أو `[error, undefined, connection?]`.

تنفيذ WebSocket يمكنه تجاوز `beforeConnect` و`heartbeat` و`protocols` و`reconnect`.

## WebSocketSession {#WebSocketSession}

```ts
interface WebSocketSession<TIncoming, TOutgoing> extends AsyncDisposable {
  readonly bufferedAmount: number
  readonly connection: WebSocketConnectionInfo
  readonly closed: Promise<WebSocketCloseInfo>
  readonly receive: AsyncIterable<TIncoming>
  readonly state: WebSocketState
  close(code?: number, reason?: string): void
  [Symbol.asyncDispose](): PromiseLike<void>
  send(message: TOutgoing): void
  onRuntimeError(listener: (error: unknown) => void): () => void
  onStateChange(listener: (state: WebSocketState) => void): () => void
}
```

فضّل `await using ownedSession = session` لتنظيف النطاق المملوك. يبقى `session.close()` اليدوي و`await session.closed` متاحين.

```ts
async function consume(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  for await (const message of ownedSession.receive) console.log(message)
}
```

`closed` يبلّغ عن الحالة النهائية المنطقية. المتخلّص غير المتزامن يطلب إغلاقًا أصليًا وينتظر teardown المملوك لـ Defjs، لكنه يحدّ حدث الإغلاق المفقود بثانية واحدة وقد يرفض بـ `DOMException` اسمه `TimeoutError`. ولا يستطيع إثبات أن اتصال TCP المادي أُغلق.

### WebSocketState {#WebSocketState}

`'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting' | 'aborted' | 'error'`

### WebSocketConnectionInfo {#WebSocketConnectionInfo}

`url`، `protocol`، `extensions`، `generation` (تزداد عند إعادة الاتصال).

### WebSocketCloseInfo {#WebSocketCloseInfo}

```ts
type WebSocketCloseInfo =
  | { kind: 'closed'; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'aborted'; cause?: unknown; code?: number; reason?: string; wasClean?: boolean }
  | { kind: 'error'; cause: unknown; code?: number; reason?: string; wasClean?: boolean }
```

لقطة الإغلاق بعد انتهاء المقبس (الرمز، السبب، علامة الإغلاق النظيف، سبب اختياري). الإغلاق اليدوي يمكن أن يحمل `ManualSocketCloseReason`.

## خيارات التنفيذ

## WebSocketExecuteOptions {#WebSocketExecuteOptions}

```ts
type WebSocketExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
  beforeConnect?: (context: { attempt: number; signal: AbortSignal }) => void | Promise<void>
  protocols?: readonly string[]
  heartbeat?: WebSocketHeartbeatConfig
  reconnect?: ClientWebSocketOptions['reconnect']
}
```

`WebSocketHeartbeatConfig`: `intervalMs`، و`message` و`isAck` و`timeoutMs` اختيارية.

عند ضبط `reconnect`، الافتراضي لـ `attempts` هو 3؛ و`0` يعطّل. حذف `attempts` ليس بلا حد.

## الرسائل

`incoming` هو struct واحد. إطارات النص و`ArrayBuffer` والمصفوفة المُنوَّعة و`Blob` تُقرأ كـ UTF-8، ثم `JSON.parse`، ثم تُفحص مقابل ذلك الـ struct. الإطار الذي يفشل تحليل JSON أو الـ struct يُبلَّغ إلى `session.onRuntimeError` ولا يُصفّ. لا يوجد خيار عميل للإطار غير الصالح.

`outgoing` هو struct واحد. `session.send` يقبل `StructInput` لذلك الـ struct، ويرمّز الأسماء المستعارة، ثم `JSON.stringify`. عدة أنواع من الرسائل هي `struct.discriminatedUnion`.

```ts
session.send({ type: 'message', text: 'Hello' })
```

انظر [دليل WebSocket](/core/web-socket) و[فتح جلسة WebSocket](/recipes/websocket-session).

## WebSocketDefinition {#WebSocketDefinition}

`path` و`incoming`، و`outgoing` / `input` / `protocols` اختيارية، وحدود الطابور. الـ builder قد يُرجع `path` و`query` فقط. عند التصريح بـ `input`، يجب دائمًا توفير `builder` صريح، حتى لو كان المدخل يطابق شكل الطلب أصلًا. يمكن حذف `builder` فقط من التعريفات التي لا تصرّح بـ `input`.

## WebSocketEndpoint {#WebSocketEndpoint}

يعيده `defineWebSocket`. استدعه بالمدخل لتحصل على `WebSocketCommand`.

## WebSocketRequestShape {#WebSocketRequestShape}

`path` و`query` فقط. `headers` و`body` هما `never`.

## WebSocketCommand {#WebSocketCommand}

أمر WebSocket معتم. مرّره إلى `client.execute`.

## UseWebSocketConfig {#UseWebSocketConfig}

نبض وإعادة اتصال و`beforeConnect` والبروتوكولات مع الإلغاء. `WebSocketExecuteOptions` يضيف `signal`.

## SocketAwaitResult {#SocketAwaitResult}

`[null, session, connection]` أو `[error, undefined, connection?]`.

## ManualSocketCloseReason {#ManualSocketCloseReason}

السبب المسجَّل عند إغلاق الجلسة عبر `session.close()`.

## WebSocketHeartbeatConfig {#WebSocketHeartbeatConfig}

`intervalMs`، و`message` و`isAck` و`timeoutMs` اختيارية.

## WebSocketIncomingData {#WebSocketIncomingData}

الإطار الوارد المفكوك: `Infer` لـ struct `incoming`.

## WebSocketOutgoingData {#WebSocketOutgoingData}

القيمة التي يقبلها `session.send`: `StructInput` لـ struct `outgoing`، أو `never` عندما لا يُعلن أيّ منه.

## SocketLifecycleOutcome {#SocketLifecycleOutcome}

لقطة نهاية دورة الحياة بعد انتهاء المقبس.
