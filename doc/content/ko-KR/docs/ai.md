---
title: "AI 지원 개발"
description: "Defjs skill을 설치하고, 도우미에게 타입이 있는 GET 엔드포인트를 맡긴 뒤 설치된 SDK와 결과를 대조합니다."
---

도우미에게 Defjs 코드를 맡기는 일과 애플리케이션에서 AI 서비스를 호출하는 일은 서로 다릅니다. 이 페이지는 도우미 작업 흐름입니다. [AI API 호출](/ko-KR/docs/ai-api)은 애플리케이션 쪽 작업 흐름입니다. Skill을 지원하는 도우미는 관련 작업에서 이를 불러올 수 있습니다. 자동으로 불러오는지는 도구에 따라 다릅니다.

## skill 설치 [#install]

skills CLI에는 Node.js 22.20 이상이 필요합니다. 이 요구는 설치 도구의 것이며 `@defjs/core` 런타임이 아닙니다. 런타임은 [빠른 시작](/ko-KR/docs/start)을 보세요.

Skill을 사용할 프로젝트에서 다음 명령을 실행합니다. CLI는 기본적으로 현재 프로젝트에 설치하며 현재 에이전트를 자동 감지하거나 선택을 요청할 수 있습니다. `-a`로 직접 지정할 수도 있습니다.

```sh
npx skills add defjs/defjs --skill defjs
```

게시된 뒤의 skill 설명은 [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md)에서 읽을 수 있습니다. GitHub 소스는 기본 브랜치이며, 프로젝트에 설치된 `@defjs/core` 버전과 다를 수 있습니다.

## 엔드포인트 하나 요청하기 [#prompt]

도우미에게 작업을 하나 줍니다. 다음 프롬프트는 타입이 있는 `GET /users/:id`와 애플리케이션에 두는 client를 요청합니다.

```txt
Use @defjs/core to define GET /users/:id.
The input is { id: number }; a successful response is { id: number, name: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 결과 확인 [#verify]

정의와 애플리케이션을 따로 읽습니다. 정의는 작업을 export하고 client를 만들지 않습니다. 애플리케이션이 client를 만들고 작업을 호출합니다. 예를 들어 `getUser(client, { id: 1 })`입니다. `input`을 선언했다면 `builder`는 명시적인 동기 순수 함수입니다. 성공 값은 error 칸이 비어 있을 때만 사용합니다.

그다음 그 프로젝트의 타입 검사와, 그 계약을 실제로 실행하는 테스트를 실행합니다. 의존성 설치와 CI 규칙은 그 프로젝트에 둡니다.

## 도우미용 영어 Markdown [#resources]

이 사이트의 가이드, 실전 예제, API 개요는 사람을 위해 쓰였고 로케일마다 본문이 있습니다. 아래 세 주소는 영어 페이지만으로 생성됩니다. 로케일 접두사는 없고, 지금 읽는 페이지의 번역도 아닙니다.

- [영어 페이지 색인](/llms.txt)은 영어 페이지를 나열하고 해당 웹 페이지로 연결합니다.
- [묶은 영어 가이드](/llms-full.txt)는 그 페이지를 한 파일로 합칩니다.
- [빠른 시작의 Markdown](/llms.mdx/docs/start/content.md)은 한 페이지의 영어 본문입니다. 다른 영어 페이지도 `/llms.mdx/…/content.md` 같은 모양입니다.

이 로케일의 가이드는 [빠른 시작](/ko-KR/docs/start)에서 읽습니다. 도우미가 API를 맞추게 하려면 Markdown 주소를 넘깁니다. 도우미는 프로젝트에 설치된 `@defjs/core` 버전을 따라야 합니다. 사이트 문서는 설치된 버전과 다를 수 있으니 그 버전의 API를 확인하세요. 문서의 GitHub 소스도 기본 브랜치이며, 설치된 버전과 다를 수 있습니다. 코드나 맥락을 AI 도구에 넘기기 전에 비밀을 지우고 프로젝트의 데이터 정책을 확인하세요.
