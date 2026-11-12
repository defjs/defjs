---
title: "가이드"
description: SDK 계약과 작업을 설계하고 배포한 뒤, 사용하는 애플리케이션에서 실행을 구성합니다.
---

# 가이드

Defjs는 SDK 팀이 배포하는 API 계약과 애플리케이션이 런타임에 사용하는 클라이언트 구성을 명확히 분리합니다. SDK 작성자는 API를 정의하고 배포하는 역할을 맡습니다. 애플리케이션 개발자는 클라이언트 옵션과 인터셉터를 통해 런타임 실행을 관리하는 역할을 맡습니다. 아래 안내를 통해 아키텍처를 살펴보고, 작업을 선언하며, 실행 환경을 제어해 보세요.

## 시작하기 [#getting-started]

- [개요](/ko-KR)
- [빠른 시작](/ko-KR/docs/start)
- [핵심 아키텍처](/ko-KR/docs/design-decisions)

## SDK 정의 [#defining-sdks]

- [Struct 및 스키마](/ko-KR/docs/struct)
- [HTTP 작업](/ko-KR/docs/http)
- [SSE 이벤트 스트림](/ko-KR/docs/sse)
- [WebSocket 세션](/ko-KR/docs/web-socket)

## 클라이언트 및 실행 [#client-execution]

- [클라이언트](/ko-KR/docs/client)
- [오류 처리](/ko-KR/docs/errors)
- [인터셉터](/ko-KR/docs/interceptors)
- [로드 밸런싱 및 장애 조치](/ko-KR/docs/load-balancing)
- [테스트](/ko-KR/docs/testing)

## 통합 및 AI [#integrations-and-ai]

- [통합 개요](/ko-KR/docs/integrations)
- [React](/ko-KR/docs/integrations/react)
- [Vue](/ko-KR/docs/integrations/vue)
- [OpenTelemetry server](/ko-KR/docs/integrations/opentelemetry-server)
- [Skill](/ko-KR/docs/ai)
- [llms.txt](/ko-KR/docs/ai-api)
