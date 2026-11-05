---
title: "개요"
description: "SDK 작성자, 애플리케이션, 런타임 사이에서 SDK를 예측 가능하게 유지하는 계약과 경계입니다."
---

이 관행은 Defjs가 동작하는 데 필수는 아니에요. 정의, 애플리케이션, 전송을 여러 사람이 나눠 소유할 때 SDK를 예측 가능하게 유지해 줘요. 각 페이지는 규칙에서 시작해 권장 형태와 피해야 할 형태를 보여 주고, 그 뒤의 경계를 설명해요.

## 정의와 실행 분리 [#definition-execution]

정의는 데이터예요. method, path, input, output, 오류 계약을 선언해요. 클라이언트를 만들지 않고, 자격 증명을 읽지 않고, I/O를 시작하지 않아요. 애플리케이션이 클라이언트를 만들고 작업을 호출해요. 작업 호출이 요청을 수행하는 지점이에요.

이 분리 덕분에 SDK 패키지는 endpoint와 자격 증명 없이 나갈 수 있고, 같은 정의를 브라우저, 서버, 테스트에서 서로 다른 endpoint로 실행할 수 있어요.

## input을 선언하고 명시적으로 배치 [#input-builder]

`input`은 호출자가 제공하는 값을 설명해요. `builder`는 각 값이 path, query, headers, body 중 어디로 갈지 정해요. 배치는 필드 이름이나 path 템플릿에서 추론하지 않아요.

`builder`는 동기적인 순수 함수예요. 실행 시점에 돌아요. throw는 `REQ_BUILD_FAILED`가 돼요.

## 오류 슬롯을 먼저 읽기 [#error-first]

모든 작업은 error-first 튜플을 돌려줘요. 첫 요소는 fault 또는 `null`이에요. 요청, 응답, 전송 실패는 호출 지점에서 throw하지 않아요.

성공 값을 쓰기 전에 fault를 읽으세요. `code`로 좁힌 다음 그 fault에 속한 필드를 읽으세요.

## 애플리케이션이 클라이언트를 소유 [#client-ownership]

endpoint, 자격 증명, interceptor, 전송, 스트림과 세션의 수명은 애플리케이션이 소유해요. SDK는 계약을 소유해요. 플러그인은 애플리케이션 클라이언트를 프레임워크 트리로 전달할 수 있지만, 만들거나 캐시하지 않아요.

## 이 섹션의 페이지 [#pages]

- [SDK 설계](/ko-KR/docs/best-practices/sdk-design) — 정의, Struct, 이름, 배포.
- [애플리케이션 통합](/ko-KR/docs/best-practices/application) — 클라이언트 생성, 설정, interceptor, 프레임워크 플러그인.
- [오류 처리](/ko-KR/docs/best-practices/errors) — fault code, 좁히기, 로깅, 재시도.
- [스트리밍과 실시간](/ko-KR/docs/best-practices/streaming) — SSE, WebSocket, 소유권, 백프레셔.
- [테스트](/ko-KR/docs/best-practices/testing) — 주입한 전송, 계약 테스트, 타이머.
- [보안](/ko-KR/docs/best-practices/security) — 자격 증명, XSRF, URL 검증, 가리기.
- [성능](/ko-KR/docs/best-practices/performance) — 스트리밍, 큐, failover, 측정.
