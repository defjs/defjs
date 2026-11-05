---
title: "오류 처리"
description: "호출 지점에서 fault를 읽고, code로 좁히며, 로깅과 재시도를 정의 밖에 둡니다."
---

## 값보다 fault를 먼저 읽기 [#fault-first]

모든 작업은 `[error, data, response]`를 돌려줘요. 성공 값은 첫 요소가 `null`일 때만 의미가 있어요.

권장:

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

피하세요:

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // order is undefined when the call failed
```

## code로 좁히고, 그다음 data로 [#narrow]

`fault.code`가 실패 분류를 골라요. `HTTP_STATUS`면 `status`, 디코딩된 오류 body면 `data`, 메타데이터면 `response`를 읽어요. `cause`는 밑단의 파서나 전송 실패를 담고 있어요. 일반적인 메시지로 바꾸지 마세요.

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

`RES_*` code는 응답을 선언한 대로 읽을 수 없었다는 뜻이에요. `NET_*` code는 요청이 쓸 만한 응답을 만들지 못했다는 뜻이에요. 디코딩이나 계약 실패를 네트워크 실패처럼 재시도하지 마세요.

## 결과를 소유한 경계에서 한 번만 로깅 [#logging]

다음에 무슨 일이 일어날지 결정하는 계층에서 로그를 남기세요. 요청 핸들러, 작업 러너, UI 경계예요. 텔레메트리에는 OpenTelemetry 플러그인이나 interceptor를 쓰고, 정의에는 로깅을 두지 않아요. URL, query 문자열, 헤더, body는 로그에 도달하기 전에 가리세요.

## 안전하게 다시 보낼 수 있는 것만 재시도 [#retry]

Defjs는 HTTP를 스스로 재시도하지 않아요. 재시도는 애플리케이션 또는 명시적인 endpoint failover 정책의 몫이에요. 안전한 method나 서비스가 멱등하다고 문서화한 작업만 재시도하세요. 과금되는 작업을 시작했을 수 있는 POST는 다시 보내기 계약 없이 반복하기 안전하지 않아요.

## 삼키지 않기 [#no-swallow]

오류 뒤에 성공을 돌려주면 깨진 계약을 숨겨요. fault를 애플리케이션 결과로 매핑하거나, 프로그래밍 오류를 다시 던지거나, 타입이 있는 실패로 작업을 끝내세요. fault를 로그만 남기고 undefined 값으로 계속하려고 catch하지 마세요.
