---
title: 명령
description: 엔드포인트를 정의하고, opaque 명령을 만들고, 입력을 배치하고, 전송 결과를 추론해요.
---

# 명령

정의 하나 → 엔드포인트 → opaque 명령 → `client.execute`. HTTP, SSE, WebSocket이 같은 파이프라인이에요.

## 기본 사용법

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## 정의 고르기

| 정의                     | 계약                                                         | 성공 값                                |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------- |
| `defineRequest(...)`     | method, 상대 path, 선택 input, 선택 `output` / `error`       | 디코딩된 data + response               |
| `defineEventStream(...)` | path, buffer/queue 한도, 이벤트 이름 → Struct map            | `EventStreamHandle` + open 스냅샷      |
| `defineWebSocket(...)`   | path, incoming struct 하나, 선택 outgoing struct, queue 한도 | `WebSocketSession` + connection 스냅샷 |

`input`이 없으면 엔드포인트는 인자를 받지 않고, `builder`는 `() => request`일 수 있어요. `input`이 있으면 struct 값을 넘기세요. optional 필드는 빼도 되고, 필수 필드는 빼면 안 돼요.

명령은 opaque로 두세요. 태그나 심볼을 파고들지 마세요.

## 값이 가는 곳

struct가 값을 어떻게 인코딩할지 정하고, `builder`가 어디로 갈지 정해요. `builder`는 **파싱된** 입력의 동기적이고 순수한 함수예요. 실행 시점에 돌아요. throw하면 튜플의 `REQ_BUILD_FAILED`가 되고, 엔드포인트 호출 자체는 throw하지 않아요.

`input`을 선언하면 입력이 이미 요청 모양이어도 명시적인 `builder`가 반드시 필요해요. `input`이 없는 정의만 `builder`를 생략할 수 있어요.

타입이 있는 값을 그대로 넘기세요. 그러면 alias, `Date` → ISO, `bigint` → 문자열이 그 struct가 쓰이는 곳마다 적용돼요. 요청 배치, 응답 디코딩, SSE 이벤트, WebSocket 프레임이에요.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
  email: struct.string(),
})

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({ user: User }),
  builder: (input) => ({ body: input.user }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})
void createUser
```

body는 JSON `{"display_name":"…","email":"…"}`예요. 손으로 쓴 키는 빠져나가는 구멍이에요. `body: { name: input.user.displayName }`은 `name`을 보내요. 부모 객체가 익명이라 alias가 적용되지 않아요.

## 모양이 다를 때

path placeholder, 리터럴, 분기는 `builder`를 쓰세요. 실제 값을 받으니 `if`, `??`, 템플릿, `switch`가 동작해요.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const search = defineRequest({
  method: 'GET',
  path: '/orgs/:org_id/users',
  input: struct.object({
    orgId: struct.number(),
    query: struct.object({
      keyword: struct.string(),
      pageSize: struct.number().alias('page_size'),
    }),
  }),
  builder: (input) => ({
    path: { org_id: input.orgId },
    query: input.query,
    headers: { 'x-api-version': '2' },
  }),
  output: struct.object({ items: struct.array(struct.string()) }),
})
void search
```

`query: input.query`는 `page_size`를 보내요. `headers: { 'x-api-version': '2' }`는 리터럴이에요. 인증과 트레이싱은 여전히 interceptor에 두세요. builder가 돈 뒤의 네이티브 요청을 봐요.

## output과 error의 모양

`output`은 2xx body를 위한 Struct 하나이고, `error`는 그 밖 전부를 위한 Struct 하나예요. `ok`가 유일한 분기이고, 디코딩하는 쪽은 항상 한쪽뿐이에요. 한쪽을 빼면 그 body는 읽히지 않아요. fault는 status를 가지고 `data`는 `undefined`로 남아요.

## 관련 레시피

- [선언된 404가 있는 GET](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
