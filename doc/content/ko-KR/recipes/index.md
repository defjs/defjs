---
title: "실전 예제"
description: 재사용 가능한 SDK를 구축 및 배포하고, 사용하는 애플리케이션에서 인증, 호출, 실시간 작업을 구성합니다.
---

export된 SDK 정의부터 npm 패키지 배포와 애플리케이션 연동까지의 전체 흐름을 살펴보려면 [SDK 작성과 배포](/ko-KR/recipes/publish-http-sdk)부터 시작해 보세요. 아래 각 레시피는 하나의 작업 계약과 그 주변의 애플리케이션 정책을 짝지으며, 멀티 파일 코드 탭으로 SDK 정의 모듈과 애플리케이션 실행 모듈이 어떻게 맞물리는지 보여줍니다.

## HTTP

- [JSON 보내기](/ko-KR/recipes/post-json) — 논리적인 camelCase 필드를 통신상의 `snake_case` 키로 매핑하고 타입화된 `201` 응답을 디코딩합니다.
- [선언된 404 처리](/ko-KR/recipes/get-declared-404) — 타입화된 `200` 정상 출력과 선언된 `404` `HTTP_STATUS` 오류 본문으로 분기합니다.
- [취소와 시간 제한](/ko-KR/recipes/cancel-http) — 호출자의 `AbortController`와 `AbortSignal.timeout(...)`을 결합하고 `NET_ABORTED`와 `NET_TIMEOUT`을 명확히 구분합니다.
- [ETag 조건부 요청](/ko-KR/recipes/etag-revalidate) — `If-None-Match`를 전송하고, `304 Not Modified`를 `HTTP_STATUS` 결함으로 처리하며, 캐시 `Map`을 애플리케이션 코드에서 관리합니다.
- [GraphQL 요청](/ko-KR/recipes/graphql-http-envelope) — HTTP `POST`를 통해 GraphQL 쿼리를 전송하고 애플리케이션 헬퍼에서 `errors[]`와 `.nullish()` `data`를 분리합니다.

## 인증

- [401 후 토큰 갱신](/ko-KR/recipes/refresh-bearer-once) — `Bearer` 토큰을 첨부하고, 동시 갱신을 중복 제거하며, 단일 HTTP 인터셉터 내부에서 1회 재요청합니다.

## 실시간 통신

- [SSE 이벤트 소비](/ko-KR/recipes/consume-sse) — 타입화된 Server-Sent Events 스트림을 열고, 1회 순회한 뒤, `finally` 블록에서 `stream.close()` + `await stream.closed`를 보장합니다.
- [WebSocket 세션 관리](/ko-KR/recipes/websocket-session) — 타입화된 수신/송신 JSON 프레임을 주고받고, `onRuntimeError`를 구독하며, 안전하게 연결을 닫습니다.

## SDK 테스트와 배포 [#testing-and-packaging]

- [로컬 HTTP 테스트](/ko-KR/recipes/test-with-handle) — `withHTTPHandle(...)`을 사용해 URL 구성, 인터셉터, Struct 디코딩을 메모리 상에서 오프라인으로 테스트합니다.
- [SDK 작성과 배포](/ko-KR/recipes/publish-http-sdk) — `tsdown`으로 클라이언트 없는 순수 SDK를 패키징 및 배포하고 애플리케이션에서 사용합니다.
