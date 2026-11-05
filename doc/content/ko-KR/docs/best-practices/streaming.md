---
title: "스트리밍과 실시간"
description: "스트림 핸들을 소유하고, 큐에 한도를 두며, 재연결과 다시 보내기 정책을 애플리케이션에서 결정합니다."
---

## 핸들을 소유하기 [#ownership]

이벤트 스트림이나 WebSocket 세션은 연 호출자의 것이에요. 작업이 끝나면 닫고, 주변 스코프가 소유한다면 `await using`을 써서 모든 종료 경로에서 핸들이 dispose되게 하세요.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## 완료나 EOF까지 읽기 [#read-to-end]

이벤트 하나는 완전한 응답이 아니에요. SSE에서는 스트림이 끝나거나, 호출자가 abort하거나, 재연결 정책이 넘겨받을 때까지 계속 읽으세요. WebSocket에서는 세션이 닫히거나 호출자가 멈출 때까지 수신 큐를 읽으세요.

## 버퍼와 큐에 한도 두기 [#bounds]

WebSocket 세션에는 `maxIncomingQueueSize`, SSE에는 `maxBufferSize` / `maxQueueSize`를 설정하세요. 한도가 있으면 느린 소비자가 무한한 메모리 증가 대신 fault가 돼요. 메시지 크기와 소비자 속도로 한도를 정하고, 넘침 경로를 테스트하세요.

## 재연결과 다시 보내기를 명시적으로 결정 [#reconnect]

SSE 재연결은 애플리케이션이 켜기 전까지 꺼져 있어요. POST나 다른 비멱등 method는 정책이 허용하지 않으면 다시 보내지 않아요. 실패한 스트리밍 시도는 서버에서 이미 작업을 시작했을 수 있어요. 정책을 켜기 전에 [SSE 이벤트 스트림](/ko-KR/docs/sse)의 재연결 규칙과 [HTTP 요청](/ko-KR/docs/http)의 다시 보내기 규칙을 읽으세요.

## 닫고, 누수 없이 [#close]

`close()`는 정리를 시작하고, `closed`는 종단 상태를 보고해요. 다음 단계가 전송이 해제되는 것에 달려 있으면 `closed`를 기다리세요. abort는 로컬 작업을 끝낼 뿐, 서비스가 이미 받아들인 작업을 멈췄다는 증거가 아니에요.
