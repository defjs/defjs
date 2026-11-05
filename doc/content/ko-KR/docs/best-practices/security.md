---
title: "보안"
description: "자격 증명을 애플리케이션 경계에 두고, URL을 검증하고, 필요하면 XSRF를 켜고, 텔레메트리를 가립니다."
---

## 비밀을 SDK와 브라우저 밖에 두기 [#secrets]

SDK 정의에는 endpoint, token, 자격 증명이 없어요. 애플리케이션은 자격 증명을 쓸 수 있는 곳에서 도는 클라이언트에 그것을 둬요. 서버 프로세스, 워커, 신뢰하는 테스트예요. 공급자 secret을 브라우저 번들, 공개 빌드 변수, 브라우저로 보내는 클라이언트에 넣지 마세요.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(serverAuth),
);
```

## 인증은 interceptor로 [#auth]

애플리케이션 경계에서 도는 interceptor에 token을 붙이세요. `builder`는 순수한 배치 함수로 남아야 하고, token 저장소를 읽거나 다른 호출이 쓰는 헤더를 바꿔서는 안 돼요.

## 클라이언트에서 XSRF 구성 [#xsrf]

서비스가 쿠키→헤더 token을 쓴다면 애플리케이션 클라이언트에 `withXsrf`를 구성하세요. `withCredentials`는 Fetch의 쿠키 모드만 고르고, token을 만들거나 검증하지 않아요. 서버는 여전히 token을 발급하고 검증해야 해요.

## 애플리케이션이 통제하는 값 검증 [#urls]

Defjs는 전송이 돌기 전에 불법 요청 path, 디렉터리 탈출, 백슬래시, `?`, `#`, 제어 문자를 거부해요. 애플리케이션이 어떤 호스트를 신뢰하는지는 알지 못해요. endpoint 목록을 명시적으로 유지하고, 사용자가 준 값을 `builder`에 도달하기 전에 검증하고, 신뢰할 수 없는 입력으로 base URL을 만들지 마세요.

## 로깅이나 트레이싱 전에 가리기 [#redaction]

URL, query 문자열, 헤더, body에는 secret이나 개인 데이터가 있을 수 있어요. OpenTelemetry 플러그인은 기본으로 body나 전체 헤더를 수집하지 않아요. 그대로 두세요. `startSpanHook`이나 애플리케이션 exporter에서 가리고, 원본 요청 값을 사용자 지정 텔레메트리로 복사하지 마세요.

## abort는 로컬로 취급 [#abort]

취소는 로컬 작업을 멈춰요. 서비스가 이미 받아들인 작업을 멈췄다는 증거가 아니고, 서버 측 효과를 롤백하지 않아요. 비멱등 작업이라면 abort를 서비스 자체의 취소 계약과 함께 쓰세요.
