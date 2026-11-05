---
title: "SDK 설계"
description: "애플리케이션 클라이언트를 소유하지 않으면서 계약을 설명하는 작업, Struct, 패키지를 설계합니다."
---

## 정의마다 작업 하나 [#one-operation]

각 작업에 고유한 정의와 모듈을 주세요. 작업 하나에는 method 하나, path 모양 하나, input 하나, output 계약 하나가 있어요. 작업 단위로 나누면 계약을 읽기 쉽게 유지하고, 애플리케이션이 호출하는 작업만 import할 수 있어요.

권장:

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

정의 옆에서 클라이언트를 만들거나 endpoint를 저장하는 모듈은 피하세요.

## input과 명시적 builder 짝짓기 [#builder]

모든 호출자 값을 `input`에 선언하고 `builder`에서 배치하세요. 필드 이름이 path 매개변수와 맞기를 기대하지 마세요. `builder`는 동기적이고 순수해요. 값을 바꿔 모양을 다듬을 수는 있지만, 자격 증명을 읽거나, 네트워크를 호출하거나, 공유 상태를 바꿔서는 안 돼요.

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## Struct는 와이어 모양을 설명 [#structs]

와이어를 건너는 데이터에는 Struct를 쓰세요. 와이어 이름이 TypeScript 이름과 다르면 alias를 쓰세요. 비즈니스 규칙, 필드 간 검증, 정규화는 Struct 동작이 아니라 애플리케이션 정책으로 다뤄요.

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## 안정적인 operation 이름 사용 [#operation-name]

`operation`에는 `orders.read`처럼 카디널리티가 낮은 식별자를 설정하세요. URL, 사용자 입력, 요청마다 달라지는 값을 싣지 않고 텔레메트리와 진단에 이름을 붙여요.

## SDK에 실행 상태를 두지 않기 [#no-client]

SDK 패키지는 정의, Struct, 타입을 export해요. `createClient`를 호출하지 않고, 싱글턴 클라이언트를 들고 있지 않고, 환경 변수를 읽지 않아요. endpoint와 자격 증명은 애플리케이션이 정해요.

## 계약의 버전을 의도적으로 관리 [#versioning]

제거한 필드, 바뀐 method나 path, 좁아진 input은 breaking으로 다뤄요. 추가는 보통 호환돼요. 패키지의 peer 범위를 정직하게 유지하고, 애플리케이션이 컴파일하는 것과 같은 정의 텍스트로 배포하고, 배포한 패키지의 릴리스 태그를 기록하세요.
