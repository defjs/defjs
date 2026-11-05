---
title: "테스트"
description: "주입한 전송, 실제 튜플, 제어된 시간으로 정의 계약을 테스트합니다."
---

## 전송 주입하기 [#inject]

`withHTTPHandle`, `withSSEHandle`, `withWebSocketHandle`로 플랫폼 전송을 바꾸세요. 작업은 여전히 요청을 만들고, interceptor를 실행하고, 응답을 디코딩하므로 테스트는 실제 계약 경계를 다뤄요.

```ts
const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
const [error, order] = await getOrder(client, { id: 7 });
expect(error).toBeNull();
expect(order?.status).toBe("paid");
```

## 내부가 아니라 튜플을 검증 [#tuple]

fault code와 디코딩된 값을 확인하세요. 사설 헬퍼 호출이나 전송 구현 세부를 단언하는 테스트는 계약이 그대로인데 구현이 바뀌면 깨져요. fault라면 `code`, 관련 필드, 그리고 cause가 계약의 일부일 때 `cause`의 동일성을 확인하세요.

## 계약 픽스처는 실제로 [#fixtures]

변경이 요청 만들기, 디코딩, 스트림 정리를 건드린다면 전송마다 실제 서버를 상대로 통합 테스트를 하나 두세요. 두 번째 mock 프로토콜을 만들지 말고 저장소에 이미 있는 픽스처 서버를 쓰세요. 브라우저 전용 동작은 브라우저 프로젝트에, 서버 전용 동작은 서버 프로젝트에 두세요.

## 시간을 명시적으로 제어 [#time]

타임아웃, 백오프, 재연결 지연, heartbeat에는 fake 타이머를 쓰세요. 테스트 중인 이벤트가 일어난 뒤에 시간을 진행하고, 실행돼야 하는 코드 경로를 단언하세요. 경과한 실제 시간을 단언하지 마세요. 실제 소켓이라면 `open`, `closed`, 첫 프레임 같은 구체적인 이벤트를 기다리세요.

## SDK를 소비자처럼 테스트 [#consumer]

SDK 테스트는 애플리케이션이 import하는 정의를 import하고, 테스트 전송으로 클라이언트를 만들고, 작업을 호출해야 해요. 요청을 손으로 다시 만들면 안 돼요. 그건 SDK가 아니라 테스트를 테스트하는 거예요.
