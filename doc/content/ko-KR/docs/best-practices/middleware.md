---
title: "미들웨어"
description: "인터셉터를 작고 순서가 있는 정책으로 조합하고, 애플리케이션 경계 안에 머물게 하세요."
---

## 인터셉터 하나에 관심사 하나 [#one-concern]

interceptor마다 한 가지 일만 맡기세요. 인증 붙이기, trace 헤더 추가, 시간 기록, 승인된 경우의 short-circuit이에요. 인증하고, body를 고치고, 재시도하고, 로그까지 남기는 미들웨어는 테스트하기도, 이해하기도 어려워요.

권장:

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

서로 관계없는 요청 부분 여러 개를 바꾸는 interceptor 하나는 피하세요.

## 순서가 곧 정책 [#order]

인터셉터는 등록 순서대로 실행돼요. 가장 먼저 등록한 interceptor가 가장 바깥이에요. 요청을 가장 먼저 보고 응답을 가장 나중에 봐요. 시도 전체를 감싸야 하는 정책은 가장 바깥에, 전송에 가장 가까워야 하는 정책은 가장 안쪽에 두세요.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(trace, auth),
);
```

`trace`가 `auth`를 감싸고, `auth`가 전송보다 먼저 실행돼요.

## 의도적으로 short-circuit하기 [#short-circuit]

interceptor는 `next`를 호출하지 않고 `makeResponse`로 응답을 돌려줄 수 있어요. 승인된 캐시, 점검 응답, 로컬 테스트에 쓰세요. 그래도 응답은 작업이 선언한 출력을 만족해야 해요. 실패를 성공으로 바꾸지 마세요.

## 계약을 다시 쓰지 않기 [#contract]

미들웨어는 라이브러리의 검증 규칙 안에서 헤더, trace 컨텍스트, 요청 URL을 조정할 수 있어요. 선언된 입력이나 출력의 의미를 바꾸면 안 돼요. 인증과 추적은 여기에 속하고, `builder`에 두지 않아요.

## 상태 없이 유지하기 [#stateless]

요청별 데이터를 공유 클라이언트나 모듈에 저장하지 마세요. 요청, 클라이언트 설정, 그 클라이언트를 위해 만든 클로저로 값을 넘기세요. 공유 상태를 바꾸는 미들웨어는 동시 호출 사이로 새어 나가요.

## 경계에서 실패 다루기 [#failures]

미들웨어가 throw하면 실패예요. 미들웨어가 의도적으로 요청을 처리했을 때만 응답을 돌려주세요. 로그만 남기려고 fault를 catch하고 `undefined`로 계속하지 마세요. 로깅에는 애플리케이션의 텔레메트리 훅이나 interceptor를 쓰고, 정의에는 둘 다 두지 마세요.
