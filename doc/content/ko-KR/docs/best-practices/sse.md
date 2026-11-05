---
title: "SSE"
description: "이벤트 스트림 핸들을 소유하고, 끝까지 읽으며, 버퍼를 제한하고, 재연결 정책을 명시적으로 정하세요."
---

## 핸들을 소유하기 [#ownership]

이벤트 스트림은 그것을 연 호출자의 것이에요. 작업이 끝나면 닫고, 둘러싼 스코프가 소유하면 `await using`을 써서 모든 종료 경로에서 핸들이 dispose되게 하세요.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 끝까지 또는 EOF까지 읽기 [#read-to-end]

이벤트 하나가 완전한 응답은 아니에요. 스트림이 끝나거나, 호출자가 abort하거나, 재연결 정책이 이어받을 때까지 계속 읽으세요. 읽기 실패는 정상 종료가 아니라 전송 실패로 다루세요.

## 버퍼와 큐 제한하기 [#bounds]

메시지 크기와 소비자 속도를 기준으로 `maxBufferSize`와 `maxQueueSize`를 정하세요. 한도가 있으면 느린 소비자가 메모리를 끝없이 키우는 대신 fault가 돼요. 오버플로 경로는 프로덕션과 같은 한도로 테스트하세요.

## 재연결 정책을 명시적으로 정하기 [#reconnect]

SSE 재연결은 애플리케이션이 켜기 전까지 꺼져 있어요. POST처럼 멱등하지 않은 메서드는 정책이 허용하지 않으면 다시 보내지 않아요. 실패한 시도가 서버에서 이미 작업을 시작했을 수 있어요. 정책을 켜기 전에 [SSE 이벤트 스트림](/ko-KR/docs/sse)의 재연결 규칙을 읽으세요.

## 닫기, 새지 않게 [#close]

`close()`는 teardown을 시작하고, `closed`는 종료 상태를 알려줘요. 다음 단계가 전송이 해제되는 데 의존하면 `closed`를 기다리세요. abort는 로컬 작업을 끝낼 뿐, 서비스가 이미 받아들인 작업을 멈췄다는 증거가 아니에요.
