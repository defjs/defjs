---
title: HTTP
description: 요청을 정의하고, 실행하고, status로 분기하고, signal이나 timeout으로 취소해요.
---

# HTTP

정의 → 실행 → 튜플로 분기 → 화면이 사라지면 취소. HTTP 루프는 그게 전부예요.

## 기본 사용법

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [error, data, response] = await client.execute(getUser({ id: 7 }))
if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (!error) {
  console.log(data.name, response.status)
}
```

## URL 해석하기

`withEndpoint(...)`에는 유효한 절대 URL이 필요해요. endpoint pathname은 디렉터리로 남고, query와 hash는 명령을 해석하기 전에 버려져요.

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({ path: { id: input.id }, query: { fields: input.fields } }),
})

const command = getUser({ id: 'a/b', fields: 'name' })
void client.execute(command)
// → https://api.example.com/v1/users/a%2Fb?fields=name
```

path placeholder는 raw 스칼라라서 정확히 한 번만 인코딩돼요. 빈 값과 `.` / `..`는 거부돼요. 슬래시, `?`, `#`, `%`, 공백, 유니코드가 한 placeholder 안에 있으면 인코딩된 세그먼트 하나로 남아요. 미리 인코딩하지 마세요.

정의 path에는 `?`나 `#`가 들어갈 수 없고, 절대 경로나 프로토콜 상대 경로도 안 돼요. 기본 query 인코더는 스칼라와 스칼라 배열을 받아요 (배열은 키를 반복해요). 중첩 객체는 클라이언트에 `withQuerySerializer(...)`가 없으면 `REQ_BUILD_FAILED`예요. `path`, `query`, `headers`의 `null`도 같은 방식으로 실패해요. `undefined`는 빠져요.

## 입력 배치하기

struct가 값을 인코딩하고, builder가 배치해요. `input`을 선언하면 입력이 이미 요청 모양이어도 명시적인 `builder`가 반드시 필요해요. `input`이 없는 정의만 `builder`를 생략할 수 있어요.

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  builder: (input) => ({
    path: input.path,
    headers: input.headers,
    body: input.body,
  }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})

const [error, user] = await client.execute(
  updateUser({
    path: { id: 7 },
    headers: { requestId: 'request-42' },
    body: { displayName: 'Ada' },
  }),
)
if (error) console.error(error.code)
else console.log(user.id)
```

그 body는 `application/json`의 `{"display_name":"Ada"}`예요. 헤더 와이어 이름은 `x-request-id`예요. 호출자와 파싱 결과는 `displayName`을 유지해요.

와이어 키를 직접 적기보다 타입이 있는 값을 넘기는 편이 좋아요. alias는 필드에 한 번 선언되고 양방향으로 적용돼요. `output` / `error` / 이벤트 / 들어오는 프레임은 `display_name`을 `displayName`으로 디코딩하고, `body: input.order`는 트리 전체를 다시 써요. 같은 `User` struct가 create body이자 get output일 수 있어요. 손으로 쓴 키는 예외예요. 부모 객체가 익명이라 alias가 돌지 않아요.

| builder 식                                      | 와이어에서                                         |
| ----------------------------------------------- | -------------------------------------------------- |
| `body: input.profile`                           | 타입이 있는 객체. alias와 `Date` / `bigint` 인코딩 |
| `body: { profile: input.profile }`              | 바깥 키는 리터럴, 안쪽 객체는 여전히 타입이 있어요 |
| `body: { ...input.profile, role: 'admin' }`     | spread는 struct를 유지하고, 추가 키는 리터럴이에요 |
| `body: { name: input.profile.displayName }`     | 익명 부모. alias가 적용되지 않아요                 |
| `query: input.query` / `headers: input.headers` | 타입이 있는 평평한 객체. alias가 와이어 키가 돼요  |

타입이 있는 객체를 spread하면서 그 와이어 키도 같이 쓰면 (`displayName` 옆의 `display_name`) `REQ_BUILD_FAILED`예요. `path`나 `headers`의 중첩 객체도 같은 방식으로 실패해요.

가이드는 루트만이 아니라 각 노드에서 정해져요. 익명 부모 아래에 새로 쓴 객체는 직접 쓴 키를 유지해요. 타입이 있는 부모 아래에서는 같은 객체가 그 필드의 struct를 써요.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union 가이드가 둘 이상의 분기에 맞으면 분기마다 인코딩해서 비교해요. 와이어 결과가 같으면 그 값을 쓰고, 다르면 `REQ_BUILD_FAILED`예요.

object가 아닌 부분을 포함한 혼합 intersection은 파싱될 때 일치한 각 부분의 태그를 합친 연언을 태그로 달고, 파싱되지 않은 새로 쓴 값은 익명 객체로 다뤄요.

### Query

중첩 query 모양 (`a[b]`, `a.b`, 쉼표 목록)은 백엔드 관례라서 hook은 클라이언트에 있어요.

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

여기 `query`는 인코딩된 와이어 객체예요. alias는 이미 적용돼 있어서 `qs` 같은 serializer가 그걸 버리지 않아요. 반환 문자열은 query 문자열이에요. Defjs는 `qs`에 의존하지 않아요.

serializer가 없으면 배열은 키를 반복하고, 중첩 객체는 `REQ_BUILD_FAILED`예요. builder가 `URLSearchParams`를 돌려주면 그 값을 그대로 쓰고 serializer를 건너뛰어요. query가 없으면 serializer는 호출되지 않아요. 그다음 interceptor가 보는 `queryParams`는 `new URLSearchParams(queryString)`이에요.

### Body

먼저 맞는 규칙이 이겨요.

| `body` 값                                                        | 보내는 형태                                                        | 기본 content type                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| 생략 / `undefined`                                               | body 없음                                                          | —                                                       |
| 루트에 `urlencoded` 또는 `formData` 코덱이 있는 타입이 있는 객체 | `URLSearchParams` / `FormData`. 키는 와이어 이름. 배열은 키를 반복 | form 타입 / 플랫폼 경계                                 |
| `FormData`, `URLSearchParams`                                    | 그대로                                                             | 같음. Defjs는 `FormData`의 낡은 `Content-Type`을 지워요 |
| `Blob` / `File`                                                  | 그대로                                                             | `blob.type`, 또는 `application/octet-stream`            |
| `ArrayBuffer`, `TypedArray`, `DataView`                          | 그대로                                                             | `application/octet-stream`                              |
| `ReadableStream`                                                 | 스트림 (`duplex: 'half'`, 런타임이 허용할 때)                      | `application/octet-stream`                              |
| `string`                                                         | 그대로                                                             | `text/plain;charset=UTF-8`                              |
| 객체, 배열, 숫자, boolean, `null`                                | 인코딩한 뒤 `JSON.stringify`                                       | `application/json`                                      |

기본값을 덮으려면 `headers`에 `content-type`을 두세요. 코덱 태그는 body 루트에서만 적용돼요. `body: { meta: input.form }`은 JSON이고, form 필드는 평범한 JSON 필드예요. 문자열은 raw 텍스트예요. `"abc"` 같은 JSON 문자열은 `JSON.stringify`와 `application/json`이 필요해요. `undefined` 필드는 빠져요. `nullable` 필드를 `null`로 보내면 JSON `null`이에요.

`GET`과 `HEAD`는 body를 돌려줄 수 없어요. 그건 타입 오류예요. WebSocket builder는 `headers`나 `body`를 돌려줄 수 없어요.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const login = defineRequest({
  method: 'POST',
  path: '/login',
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias('username'),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
})

const upload = defineRequest({
  method: 'POST',
  path: '/files/:id',
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData()
    input.photos.forEach((photo, index) => body.append('photo', photo, `photo-${index}.jpg`))
    return { path: { id: input.id }, body }
  },
})

void login
void upload
```

직접 돌리는 `JSON.stringify`, `qs`, protobuf는 논리 이름을 봐요. 그 경로에서는 alias가 적용되지 않아요. 공개 `struct.encode`는 없어요.

builder는 실제 입력으로 분기해서 경우마다 다른 body를 돌려줄 수 있어요 (JSON 레코드, `File`, `URLSearchParams`). 네이티브 `Headers`도 그대로 통과하고 다시 인코딩되지 않아요.

## body를 읽는 방법

`output`은 2xx body를 위한 Struct 하나이고, `error`는 그 밖 전부를 위한 Struct 하나예요. struct kind가 표현을 골라요. `string`은 raw 텍스트, `blob` / `file`은 blob, `arrayBuffer`는 바이트, 그 밖의 kind는 JSON이에요. 양쪽을 모두 선언하지 않으면 body는 읽히지 않아요.

처리 순서예요.

1. `ok`가 쪽을 골라요. 2xx는 `output`, 그 밖은 `error`. 둘 다도 아니고, 다른 쪽을 fallback으로 쓰지도 않아요.
2. 그 쪽에 선언이 없으면 body는 읽히지 않아요. 2xx는 `data === undefined`로 성공하고, non-2xx는 `data === undefined`인 `HTTP_STATUS`예요. 선언하지 않은 쪽의 읽을 수 없는 body는 무시돼요. 읽을 수 없었다는 사실까지 포함해서요.
3. 미디어 타입은 body를 읽기 **전에** 검사해요. 불일치는 `RES_MEDIA_TYPE_INVALID`이고, 파싱도 디코딩도 하지 않아요.
4. 표현을 읽어요. 실패하면 `RES_DECODE_FAILED`예요. 전송의 JSON은 한 번만 파싱해요. 그 값의 문자열은 JSON 문자열 루트라서 다시 파싱하지 않아요. bytes와 blob은 원시 값이라 한 번만 파싱해요.
5. Struct가 값을 파싱해요. 실패하면 `RES_STRUCT_MISMATCH`예요.
6. 2xx → 결과와 타입이 있는 `response.body`. non-2xx → `HTTP_STATUS`의 타입이 있는 `data`.

디코딩은 interceptor 체인 뒤에 한 번 일어나요. 그래서 interceptor가 `makeResponse(...)`로 만든 응답도 와이어에서 온 응답과 똑같이 읽혀요. JSON 표현에서 문자열 body는 JSON 문자열 루트예요.

성공 응답은 `DecodedResponse<T>`예요. `url`, `status`, `statusText`, `headers`, `ok`, 그리고 타입이 있는 `body`예요. 아무것도 디코딩되지 않은 곳은 `HttpMeta`예요. 같은 필드에서 `body`만 없어요. `ok`는 `200 <= status < 300`만을 뜻해요. 둘 다 네이티브 `Response`가 아니에요. 전송 실패는 fault라서, 그걸 대신하는 status 0 응답은 없어요.

## 작업 취소하기 {#cancel-the-work}

실행 옵션은 `signal`에 `abort` 또는 `timeout` 중 하나를 더해요. **`abort`와 `timeout`은 서로 배타적이에요.** `signal`은 어느 쪽과도 조합할 수 있어요.

```ts
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const command = defineRequest({ method: 'GET', path: '/report' })()
const controller = new AbortController()
const pending = client.execute(command, { signal: controller.signal, timeout: 5_000 })

controller.abort('screen closed')
const [error] = await pending
if (error?.code === 'NET_ABORTED') {
  console.log('caller cancellation')
}
```

`timeout`은 `1..2_147_483_647` 범위의 양의 안전 정수여야 해요. 알아보는 취소 → `NET_ABORTED`. 실행 타임아웃 → `NET_TIMEOUT`. interceptor `throw` → `EXT_INTERCEPTOR_FAILED`. 그 밖의 Fetch 실패 → `NET_UNREACHABLE`. 서버가 쓰기를 받아들인 뒤의 취소는 쓰기가 롤백됐다는 증명이 **아니에요**.

## 자격 증명과 XSRF

`withCredentials(true)`는 HTTP와 SSE에서 Fetch `credentials: 'include'`를 설정해요. `Authorization`을 만들지 않고, WebSocket 인증도 구성하지 않아요. `false`는 credentials를 지정하지 않은 채로 둬요.

`withXSRF(...)`는 HTTP 전용이에요. 기본값: `cookieName: 'XSRF-TOKEN'`, `headerName: 'X-XSRF-TOKEN'`. 헤더는 안전하지 않은 method에만, 호출자가 이미 설정하지 않았을 때만, 같은 출처의 브라우저 요청에만 들어가요. `GET`, `HEAD`, `OPTIONS`, `TRACE`는 건너뛰어요. 브라우저 밖에서는 주입이 필요하면 동기적이고 요청 범위의 `tokenProvider`를 넘기세요.

credentials, XSRF 토큰, query 문자열은 일상적인 로그에서 빼세요. query params를 일반적인 자격 증명 채널로 쓰지 마세요.

## 진행률과 Fetch 경계

`onDownloadProgress`는 선언된 응답 body를 읽는 동안 돌아요. `lengthComputable`은 양의 `Content-Length`가 있을 때만 true예요. 그 쪽에 struct가 없으면 body를 읽지 않으니 body 읽기 진행률도 없어요.

`onUploadProgress`는 Fetch가 `ReadableStream<Uint8Array>` 요청 body를 읽는 것을 지켜봐요. JSON이나 텍스트 body는 그 스트림이 아니에요. 업로드 진행률이 필요하면 builder에서 `file.stream()`(또는 다른 `ReadableStream`)을 돌려주세요. 런타임이 스트림 body를 보낼 수 없으면 전송이 capability 오류를 보고해요.

`fetchHandler(httpRequest, fetchImpl?)`는 더 낮은 Fetch 경계예요. 네이티브 `Request`를 만들고, Fetch를 호출하고, 표현을 읽고, `HttpResponse`를 돌려줘요. 명령 입력을 검증하지 않고, `output`을 디스패치하지 않고, interceptor도 돌리지 **않아요**. 주입한 전송 테스트에는 쓸모 있지만 `client.execute`를 대신하지는 않아요.

## 재시도 한도

Defjs는 HTTP를 자동으로 재시도하지 **않아요**. 읽기를 재시도해도 검토된 timeout/네트워크/중복 정책이 필요해요. 변경을 재시도하려면 다시 보낼 수 있는 바이트, 서버 지원, 인증 범위와 요청 바이트에 묶인 멱등성 키, 수신 쪽 중복 정책이 필요해요.

실패한 쓰기가 커밋됐는지는 클라이언트/명령/Fetch 경계가 알 수 없어요. 재시도 결정은 앱이나 검토된 interceptor에 두세요. interceptor는 short-circuit하거나 저수준 요청을 바꿀 수 있어요. 최종 status와 body는 여전히 명령의 계약을 만족해야 해요.

## 관련 레시피

- [선언된 404가 있는 GET](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [HTTP 호출 취소하기](../recipes/cancel-http.md)
- [로컬 Fetch 핸들로 테스트하기](../recipes/test-with-handle.md)
