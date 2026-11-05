---
title: "가이드"
description: SDK 계약과 작업을 설계하고 배포한 뒤, 사용하는 애플리케이션에서 실행을 구성합니다.
---

Defjs는 팀이 배포하는 API와 애플리케이션이 쓰는 클라이언트를 나눕니다. SDK 작성 경로는 작업을 정의하고 패키지로 묶는 일을 맡습니다. 애플리케이션 경로는 실행을 구성하고 결과를 처리하는 일을 맡습니다.

## 머리말 [#getting-started]

- [프로젝트 개요](/ko-KR)
- [빠른 시작](/ko-KR/docs/start)
- [SDK 작성과 배포](/ko-KR/recipes/publish-http-sdk)
- [정의와 실행을 나누는 이유](/ko-KR/docs/design-decisions)

## 계약과 실행 [#calls-and-contracts]

SDK 작성자는 Struct와 엔드포인트 정의를 소유합니다. 애플리케이션은 Client를 제공하고 그것으로 작업을 호출합니다.

- [데이터 계약 / Struct](/ko-KR/docs/struct)
- [클라이언트 설정 / Client](/ko-KR/docs/client)

## 요청과 실시간 통신

- [HTTP 요청](/ko-KR/docs/http)
- [SSE 이벤트 스트림](/ko-KR/docs/sse)
- [WebSocket 세션](/ko-KR/docs/web-socket)

## 오류와 인터셉터

- [오류 처리](/ko-KR/docs/errors)
- [인터셉터](/ko-KR/docs/interceptors)

## 플러그인

사용하는 애플리케이션의 클라이언트를 위한 선택 패키지입니다. SDK 정의는 이 패키지와 독립입니다.

- [플러그인](/ko-KR/docs/integrations)
- [React](/ko-KR/docs/integrations/react)
- [Vue](/ko-KR/docs/integrations/vue)
- [OpenTelemetry server](/ko-KR/docs/integrations/opentelemetry-server)

## AI

- [AI 지원 개발](/ko-KR/docs/ai)
- [AI API 호출](/ko-KR/docs/ai-api)

[설계 결정](/ko-KR/docs/design-decisions)
