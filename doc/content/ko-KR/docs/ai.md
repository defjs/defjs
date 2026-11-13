---
title: "Skill"
description: "Defjs skill을 설치하고, 도우미에게 타입화된 GET 작업을 맡긴 뒤 설치된 SDK와 결과를 대조합니다."
---

# Skill

Defjs skill은 SDK 정의와 애플리케이션 실행 계약을 어시스턴트에게 알려 줍니다. 지원하는 어시스턴트는 관련 작업에서 이를 불러올 수 있으며, 자동 활성화 여부는 도구에 따라 다릅니다.

## skill 설치 [#install]

Skill을 사용할 프로젝트에서 다음 명령을 실행합니다. CLI는 기본적으로 현재 프로젝트에 설치하며 현재 에이전트를 자동 감지하거나 선택을 요청할 수 있습니다. `-a`로 직접 지정할 수도 있습니다.

```sh
bunx skills add defjs/defjs --skill defjs
```

게시된 뒤의 skill 설명은 [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md)에서 읽을 수 있습니다. GitHub 소스는 기본 브랜치이며, 프로젝트에 설치된 `@defjs/core` 버전과 다를 수 있습니다.

## 작업 하나 요청하기 [#prompt]

도우미에게 작업을 하나 줍니다. 다음 프롬프트는 타입화된 `GET /orders/:id`와 애플리케이션에 두는 클라이언트를 요청합니다.

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 결과 확인 [#verify]

정의와 애플리케이션을 따로 읽습니다. 정의는 작업을 export하고 클라이언트를 만들지 않습니다. 애플리케이션이 클라이언트를 만들고 작업을 호출합니다. 예를 들어 `getOrder(client, { id: 1 })`입니다. `input`을 선언했다면 `builder`는 명시적인 동기 순수 함수입니다. 성공 값은 error 칸이 비어 있을 때만 사용합니다. 호출 지점은 호출 직후 `if (err)`를 확인하고 그 블록 안에서 반환하며, 실패할 수 있는 헬퍼는 로그를 남기거나 `undefined`를 반환하는 대신 자신의 `[err, value]` 튜플을 반환합니다.

그다음 그 프로젝트의 타입 검사와, 그 계약을 실제로 실행하는 테스트를 실행합니다. 의존성 설치와 CI 규칙은 그 프로젝트에 둡니다.
