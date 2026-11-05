---
title: "애플리케이션 통합"
description: "애플리케이션 경계에서 클라이언트를 만들고, 자격 증명과 정책, 프레임워크 연결을 SDK 밖에 둡니다."
---

## 경계에서 클라이언트를 한 번 만들기 [#client-boundary]

애플리케이션이 설정을 읽는 곳에서 클라이언트를 만드세요. 서버 진입점, 배포를 소유한 모듈, 테스트 설정 같은 곳이에요. 그 클라이언트를 작업을 호출하는 코드에 넘기세요.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

SDK 내부의 모듈 수준 클라이언트, 컴포넌트 본문, 요청 핸들러는 피하세요. 렌더링마다 또는 요청마다 만든 클라이언트는 공유 설정을 잃고, 테스트를 주변 상태에 의존하게 만들어요.

## 횡단 정책은 interceptor에 [#interceptors]

인증, 트레이싱, 기본 헤더, 검토된 재시도 정책은 interceptor에 속해요. `builder`는 현재 input을 배치할 뿐, 자격 증명이나 애플리케이션의 텔레메트리를 알지 못해요.

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## 한 번의 호출에는 클라이언트 옵션 [#per-call]

`client(options)`는 한 번의 호출에 쓸 클라이언트 값을 돌려줘요. 그 값은 호출할 수 없어요. 그 호출에만 적용되는 signal, 진행률 콜백, WebSocket hook에 쓰고, 나머지는 기본 클라이언트를 쓰세요.

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## 프레임워크 플러그인이 클라이언트를 전달 [#plugins]

`@defjs/react`와 `@defjs/vue`는 애플리케이션 클라이언트를 프레임워크 트리로 전달해요. 클라이언트를 만들거나, 캐시하거나, 재시도하거나, dispose하지 않아요. 애플리케이션이 이미 소유한 클라이언트를 넘기고, 필요한 곳에 같은 값을 주입하세요.

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## endpoint를 SDK 밖에 두기 [#endpoint]

같은 정의를 프로덕션, 스테이징, 로컬 픽스처, 테스트 전송에 쓸 수 있어요. endpoint는 애플리케이션에서 고르고, 배포 호스트를 SDK 패키지에 넣지 마세요.
