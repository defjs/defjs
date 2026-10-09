---
title: 클라이언트
description: 명시적인 클라이언트를 만들고, 옵션을 조합하고, 명령을 실행하고, 정리를 소유해요.
---

# 클라이언트

`Client`는 endpoint와 전송 config를 들고 HTTP, SSE, WebSocket 명령을 디스패치해요. 캐시하지 않고, 자동으로 재시도하지 않으며, 열린 스트림을 돌봐 주지도 않아요.

## 기본 사용법

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)`는 명령 종류마다 오버로드를 돌려줘요.

## 옵션 조합하기

옵션은 왼쪽에서 오른쪽으로 적용돼요. setter는 바꾸고, `withInterceptors(...items)`는 추가해요.

```typescript twoslash
import { createClient, createHttpInterceptor, withCredentials, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit), withCredentials(true))
void client
```

섞인 interceptor는 실행 시점에 전송별로 걸러지고, 선택된 kind 사이의 상대 순서는 유지돼요.

## 전송별 실행

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]` (`open`은 시작 스냅샷이고, 재연결 뒤 `stream.open`은 바뀔 수 있어요)
- WebSocket → `[error, session, connection]`

WebSocket 실행은 `beforeConnect`, `heartbeat`, `protocols`, `reconnect`를 덮어쓸 수 있어요. `timeout`은 `1..2_147_483_647` 범위의 양의 안전 정수여야 해요.

정리는 호출하는 쪽이 소유해요. HTTP는 abort하고, SSE는 닫고 `await stream.closed` 하고, WebSocket은 닫고 `await session.closed` 해요.

## 테스트 전송 주입하기

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
})

const handle: typeof fetch = async () => Response.json({ id: 7, name: 'Ada' })
const client = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(handle))
const [error, user] = await client.execute(getUser({ id: 7 }))
if (!error) console.log(user.name)
```

## 서버 vs 브라우저 범위

서버에서는 옵션이나 interceptor 클로저가 인증, 쿠키, 사용자, 테넌트를 잡을 때 요청 경계 안에서 클라이언트를 만들어요. 클라이언트 정체성 자체가 보안 경계는 아니에요.

## 참고

| Helper                                                                                                        | 효과                                                       |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | 모든 전송의 절대 base endpoint                             |
| `withHeaders(HeadersInit)`                                                                                    | HTTP/SSE의 정적 기본 헤더. 명령 헤더가 덮어써요            |
| `withTimeout(ms)`                                                                                             | 기본 HTTP `execute` timeout만 (SSE/WS는 무시)              |
| `withHTTPHandle(fetch)`                                                                                       | HTTP의 Fetch를 바꿔요                                      |
| `withSSEHandle(fetch)`                                                                                        | SSE의 Fetch를 바꿔요                                       |
| `withWebSocketHandle(WebSocket)`                                                                              | WebSocket 생성자를 바꿔요                                  |
| `withInterceptors(...items)`                                                                                  | 섞인 interceptor를 추가해요                                |
| `withQuerySerializer(fn)`                                                                                     | 이미 alias가 적용된 query 객체를 query 문자열로 인코딩해요 |
| `withCredentials(boolean)`                                                                                    | true이면 HTTP/SSE에서 Fetch `credentials: 'include'`       |
| `withXSRF(options?)`                                                                                          | HTTP XSRF 쿠키 → 헤더                                      |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | SSE 설정                                                   |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | WebSocket 설정                                             |

## 관련 레시피

- [로컬 Fetch 핸들로 테스트하기](../recipes/test-with-handle.md)
- [HTTP 호출 취소하기](../recipes/cancel-http.md)
