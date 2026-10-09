---
title: Defjs
description: 명시적인 클라이언트와 error-first 결과로 다루는, 타입이 있는 HTTP, SSE, WebSocket 명령이에요.
---

# Defjs

엔드포인트를 정의하고, opaque 명령을 만든 뒤 실행해요. HTTP, SSE, WebSocket이 같은 형태예요.

```ts get-health.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getHealth = defineRequest({
  method: 'GET',
  path: '/health',
  output: struct.object({ ok: struct.boolean() }),
})

const [error, result, response] = await client.execute(getHealth())
if (!error) console.log(result.ok, response.status)
```

Defjs는 결과를 캐시하지 않고, 대신 재시도해 주지 않으며, 잊은 스트림을 닫아 주지도 않아요. 취소와 정리는 호출하는 쪽이 소유해요.

## 전송 방식 고르기

| 필요한 것                      | 여기서 시작                       | 성공 시 결과                              |
| ------------------------------ | --------------------------------- | ----------------------------------------- |
| 요청 + status별 응답           | [HTTP](./core/http.md)            | 디코딩된 data + `HttpResponse`            |
| 오래 유지되는 서버 이벤트 피드 | [SSE](./core/sse.md)              | 스트림 하나 + 시작 시점 `open` 스냅샷     |
| 양방향 세션                    | [WebSocket](./core/web-socket.md) | 세션 하나 + 시작 시점 `connection` 스냅샷 |

처음이라면 [시작하기](./guide/getting-started.md)를 한 뒤 [레시피](./recipes/get-declared-404.md)를 골라 보세요. “왜?”가 궁금하면 뭔가를 돌려 본 다음에 [설계 결정](./guide/design-decisions.md)을 읽어요.

## 패키지 고르기

| 패키지                        | 언제                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `@defjs/core`                 | `createClient` (HTTP + SSE + WebSocket)                                            |
| `@defjs/react`                | `ClientProvider` / `useClient` — [React](./plugins/react.md)                       |
| `@defjs/vue`                  | 플러그인 + `injectClient` — [Vue](./plugins/vue.md)                                |
| `@defjs/opentelemetry-server` | 아웃바운드 span/metric — [OpenTelemetry Server](./plugins/opentelemetry-server.md) |

## 결과 형태

세 전송 모두 error-first 세 항목 튜플을 돌려줘요. 위치는 같고, 의미는 달라요.

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`
- WebSocket → `[error, session, connection]`

시작에 실패하면 두 번째 항목은 `undefined`예요. 세 번째 항목은 그 전송이 먼저 응답이나 스냅샷을 만든 경우에만 있어요. [오류](./core/errors.md)를 보세요.

## 소유권을 한 호흡으로

HTTP는 낡았을 때 abort 해요. SSE는 닫고 `await stream.closed` 해요. WebSocket은 닫고 `await session.closed` 해요. 서버에서는 옵션이 쿠키, 인증, 테넌트 데이터를 담을 때 요청 경계 안에서 클라이언트를 만들어요. 로그하기 전에 URL, 헤더, body를 마스킹해요.

## 관련 레시피

- [선언된 404가 있는 GET](./recipes/get-declared-404.md)
- [POST JSON](./recipes/post-json.md)
- [HTTP 호출 취소하기](./recipes/cancel-http.md)
- [SSE 스트림 소비하기](./recipes/consume-sse.md)
- [WebSocket 세션 열기](./recipes/websocket-session.md)
- [로컬 Fetch 핸들로 테스트하기](./recipes/test-with-handle.md)
