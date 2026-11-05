---
title: "WebSocket"
description: "세션을 소유하고, 수신 큐를 읽으며, 양쪽 큐를 제한하고, 런타임 오류와 재연결을 다루세요."
---

## 세션을 소유하기 [#ownership]

WebSocket 세션은 그것을 연 호출자의 것이에요. 작업이 끝나면 닫고, 둘러싼 스코프가 소유하면 `await using`을 써서 모든 종료 경로에서 세션이 dispose되게 하세요.

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## 세션이 닫힐 때까지 읽기 [#read-to-end]

세션이 닫히거나 호출자가 멈출 때까지 `session.receive`를 읽으세요. 첫 메시지가 마지막이라고 가정하지 마세요. 세션이 열린 뒤에 일어난 전송 실패를 애플리케이션이 관찰해야 하면 `onRuntimeError`를 등록하세요.

## 두 큐 모두 제한하기 [#bounds]

소비자를 기다리는 메시지에는 `maxIncomingQueueSize`를, 재연결하는 동안 큐에 쌓이는 메시지에는 `maxOutgoingQueueSize`를 정하세요. 한도가 있으면 느린 소비자나 긴 재연결이 메모리를 끝없이 키우는 대신 fault가 돼요. 오버플로 경로는 프로덕션과 같은 한도로 테스트하세요.

## 재연결과 heartbeat를 의도적으로 [#reconnect]

재연결과 heartbeat는 클라이언트 옵션이에요. 재연결은 새 연결 시도를 만들고, 큐에 있던 outgoing 메시지는 큐 정책을 따라요. 확인을 받지 못한 heartbeat는 애플리케이션이 분류해야 할 실패이고, 영원히 계속 보내야 할 이유가 아니에요.

## 닫기, 새지 않게 [#close]

`close()`는 teardown을 시작하고, `closed`는 종료 상태를 알려줘요. 세션이 더는 쓸 수 없을 때 `send`하면 throw돼요. 상태를 확인하거나 throw를 다루세요. 다음 단계가 전송이 해제되는 데 의존하면 `closed`를 기다리세요.
