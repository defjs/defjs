---
title: "가이드"
description: SDK의 API 정의, 계약 검증, 패키지 배포, 사용하는 앱의 실행까지 순서대로 안내합니다.
---

Defjs(define js)는 재사용 가능한 API 정의로 SDK를 만들기 위한 도구입니다. SDK 작성자는 계약을 배포하고, 사용하는 앱은 Defjs Client 설정과 실행을 맡습니다.

## SDK 개발 [#시작하기]

1. [프로젝트 개요](/ko-KR)에서 작성자와 앱의 책임을 확인합니다.
2. [빠른 시작](/ko-KR/docs/start)에서 정의를 export하고 다른 파일의 Client로 실행합니다.
3. [로컬 HTTP 테스트](/ko-KR/recipes/test-with-handle)로 런타임 계약을 검증합니다.
4. [SDK 작성과 배포](/ko-KR/recipes/publish-http-sdk)에서 정의와 타입 선언을 패키지로 배포합니다.

## 계약과 실행 [#호출과-계약]

- [데이터 계약 / Struct](/ko-KR/docs/struct) — 입력, 출력, 오류와 전송 표현을 정의합니다.
- [정의와 실행 / Command](/ko-KR/docs/commands) — 정의, 엔드포인트, 한 번의 실행을 위한 명령을 구분합니다.
- [클라이언트 설정 / Client](/ko-KR/docs/client) — 앱의 endpoint, 인증, 전송 수단을 구성합니다.

## 요청과 실시간 통신

- [HTTP 요청](/ko-KR/docs/http)
- [SSE 이벤트 스트림](/ko-KR/docs/sse)
- [WebSocket 세션](/ko-KR/docs/web-socket)

## 오류와 인터셉터

- [오류 처리](/ko-KR/docs/errors) — 선언된 오류와 실행 중 실패를 앱에서 처리합니다.
- [인터셉터](/ko-KR/docs/interceptors) — 인증과 추적 등 실행 정책을 조합합니다.

## 플러그인

- [플러그인](/ko-KR/docs/integrations)
- [React](/ko-KR/docs/integrations/react)
- [Vue](/ko-KR/docs/integrations/vue)
- [OpenTelemetry server](/ko-KR/docs/integrations/opentelemetry-server)

[설계 결정](/ko-KR/docs/design-decisions)은 SDK 정의와 앱 실행 설정을 분리하는 이유를 설명합니다.
