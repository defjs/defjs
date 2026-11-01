---
title: "실전 예제"
description: 재사용 가능한 SDK를 만들고 배포한 다음, 사용하는 애플리케이션에서 인증, 호출, 실시간 작업을 구성합니다.
---

[SDK 작성과 배포](/ko-KR/recipes/publish-http-sdk)에서 export한 정의부터 npm 패키지와 사용하는 애플리케이션까지의 전체 경로를 시작하세요. 아래 예제는 그 SDK 주변에 조합할 수 있는 개별 작업 계약과 애플리케이션 정책을 보여 줍니다. 그 애플리케이션이 실시간 작업의 수명을 소유합니다.

## HTTP

- [JSON 보내기](/ko-KR/recipes/post-json)
- [선언된 404 처리](/ko-KR/recipes/get-declared-404)
- [취소와 시간 제한](/ko-KR/recipes/cancel-http)
- [ETag 조건부 요청](/ko-KR/recipes/etag-revalidate)
- [GraphQL 요청](/ko-KR/recipes/graphql-http-envelope)

## 인증

- [401 후 토큰 갱신](/ko-KR/recipes/refresh-bearer-once)

## 실시간 통신

- [SSE 이벤트 소비](/ko-KR/recipes/consume-sse)
- [WebSocket 세션 관리](/ko-KR/recipes/websocket-session)

## SDK 테스트와 배포 [#testing-and-packaging]

- [로컬 HTTP 테스트](/ko-KR/recipes/test-with-handle)
- [SDK 작성과 배포](/ko-KR/recipes/publish-http-sdk)
