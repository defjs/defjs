---
title: Struct
description: 요청과 응답 모양을 모델링하고, 알 수 없는 값을 파싱하고, 와이어 body를 인코딩해요.
---

# Struct

요청(과 그 응답)을 Struct로 모델링해요. `Infer`로 TypeScript 타입을 얻고, `struct.parse(...)`로 런타임 검사를 받아요. throw는 없고, error-first 튜플이에요.

## 기본 사용법

```typescript twoslash
import { defineRequest, struct, type Infer } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  active: struct.boolean(),
})

type User = Infer<typeof User>

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({
    name: struct.string(),
    email: struct.string(),
  }),
  builder: (input) => ({ body: input }),
  output: User,
})

const [parseError, user] = struct.parse(User, { id: 7, name: 'Ada', active: true })
if (!parseError) console.log(user.name)
void createUser
```

파싱된 출력은 선언된 필드만 유지해요. 필수 필드가 빠지거나, 원시값이 틀리거나, 중첩 값이 나쁘거나, 튜플 길이가 틀리거나, 허용되지 않은 `null`이면 `StructError`이고 부분 값은 없어요. Struct는 불변이에요. `.optional()` 같은 메서드는 새 Struct를 돌려줘요.

## 필수, optional, null

존재와 null 허용은 따로예요.

| 선언                         | 없음 / `undefined`            | `null` | 유효한 값       |
| ---------------------------- | ----------------------------- | ------ | --------------- |
| `struct.string()`            | 거부                          | 거부   | 문자열을 받아요 |
| `struct.string().optional()` | 받아요. 없는 객체 필드는 생략 | 거부   | 문자열을 받아요 |
| `struct.string().null()`     | 거부                          | 받음   | 문자열을 받아요 |
| `struct.string().nullish()`  | 받아요. 없는 객체 필드는 생략 | 받음   | 문자열을 받아요 |
| `struct.null()`              | 거부                          | 받음   | 다른 값은 거부  |

```typescript twoslash
import { struct } from '@defjs/core'

const Profile = struct.object({
  name: struct.string(),
  nickname: struct.string().optional(),
  biography: struct.string().null(),
  note: struct.string().nullish(),
})

const [error, profile] = struct.parse(Profile, {
  name: 'Ada',
  biography: null,
  note: undefined,
})
if (error) throw error
console.log(profile.name, profile.nickname, profile.biography, profile.note)
```

루트에서 optional은 `undefined`일 수 있어요. 객체 안에서는 생략된 optional/nullish 필드가 없는 채로 남아요. 요청 모양 입력은 `path`, `query`, `headers`, `body`라는 평범한 필드를 써요. 호출자가 빼도 되면 하나에 `.optional()`을 붙이세요. 안의 필드가 모두 optional이어도 필수 `body` 필드는 필수로 남아요.

## 요청 배치

path, query, headers, body는 builder가 돌려주는 필드이지, 요청 struct가 아니에요. `input`을 선언하면 입력이 이미 요청 모양이어도 명시적인 `builder`가 반드시 필요해요. `input`이 없는 정의만 `builder`를 생략할 수 있어요. `struct.urlencoded(shape)`와 `struct.formData(shape)`는 코덱 태그가 있는 객체 struct예요. 태그는 그 값이 body 루트일 때만 돌아요. 키는 alias를 쓰고, 배열은 필드 이름을 반복해요.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createUser = defineRequest({
  method: 'POST',
  path: '/organizations/:organizationId/users',
  input: struct.object({
    path: struct.object({ organizationId: struct.string() }),
    query: struct.object({ notify: struct.boolean().optional() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  builder: (input) => ({
    path: input.path,
    query: input.query,
    headers: input.headers,
    body: input.body,
  }),
})

const command = createUser({
  path: { organizationId: 'acme' },
  query: { notify: true },
  headers: { requestId: 'request-42' },
  body: { displayName: 'Ada' },
})
void command
```

| body 루트                                     | 보내는 형태       | 기본 content type                                 |
| --------------------------------------------- | ----------------- | ------------------------------------------------- |
| 타입이 있는 객체, 배열, 숫자, boolean, `null` | JSON 텍스트       | `application/json`                                |
| `string` struct 또는 raw 문자열               | 텍스트            | `text/plain;charset=UTF-8`                        |
| 루트의 `struct.urlencoded(shape)`             | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| 루트의 `struct.formData(shape)`               | `FormData`        | 플랫폼 multipart boundary                         |
| `Blob` / `File`                               | 그 blob           | blob 타입 또는 `application/octet-stream`         |
| `ArrayBuffer` / view / stream                 | 바이트            | `application/octet-stream`                        |

`struct.file()`은 form 필드와 raw 파일 body를 위한 값 struct예요. WebSocket builder는 `headers`나 `body`를 돌려줄 수 없어요. HTTP와 SSE는 할 수 있어요. `GET`과 `HEAD`는 못 해요.

## 별칭

`.alias(...)`는 논리 이름과 와이어 이름을 나눠요. `struct.parse(...)`는 논리 키를 써요. JSON과 평평한 요청 코덱은 alias를 인코딩하고, JSON 응답 디코딩은 와이어 키를 논리 필드로 돌려놔요.

```typescript twoslash
import { struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
})

const [parseError, user] = struct.parse(User, { displayName: 'Ada' })
if (parseError) throw parseError
console.log(user.displayName)

const [wireError] = struct.parse(User, { display_name: 'Ada' })
console.log(wireError?.issues[0]?.path)
```

| 경계                                  | 필드                        |
| ------------------------------------- | --------------------------- |
| `struct.parse(User, ...)`와 명령 입력 | 논리 `displayName`          |
| builder에 넘긴 타입이 있는 객체       | 와이어 `display_name`       |
| JSON / SSE / WebSocket 디코딩         | 와이어 → 논리 `displayName` |
| builder 안에 직접 쓴 익명 객체        | 직접 쓴 키                  |

alias는 중첩 필드, 배열, 객체, 유니언, discriminator에서 동작해요. 앱 코드는 논리 이름을 쓰고, 외부 이름은 struct에 한 번 두세요. 타입이 있는 객체를 spread하면 그 인코딩이 유지돼요. 같은 객체에 논리 필드와 와이어 키를 둘 다 두면 `REQ_BUILD_FAILED`예요. 값을 직접 `JSON.stringify`하면 이 경로를 떠나서, serializer는 논리 이름을 봐요.

가이드는 루트만이 아니라 각 노드에서 정해져요. 익명 부모 아래에 새로 쓴 객체는 직접 쓴 키를 유지해요. 타입이 있는 부모 아래에서는 같은 객체가 그 필드의 struct를 써요.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union 가이드가 둘 이상의 분기에 맞으면 분기마다 인코딩해서 비교해요. 와이어 결과가 같으면 그 값을 쓰고, 다르면 `REQ_BUILD_FAILED`예요.

object가 아닌 부분을 포함한 혼합 intersection은 파싱될 때 일치한 각 부분의 태그를 합친 연언을 태그로 달고, 파싱되지 않은 새로 쓴 값은 익명 객체로 다뤄요.

## 파싱 실패

`struct.parse(...)`는 `[null, value]` 또는 `[StructError, undefined]`를 돌려줘요. `StructError`는 `Error`를 확장하고 `issues`와 `format()`, `flatten()`, `prettify()`를 노출해요.

```typescript twoslash
import { struct, StructError } from '@defjs/core'

const User = struct.object({ id: struct.number(), name: struct.string() })
const [error, value] = struct.parse(User, { id: 'not-a-number' })

if (error) {
  console.log(error instanceof StructError)
  console.log(error.issues[0]?.code, error.issues[0]?.path)
  console.log(error.flatten().fieldErrors)
  console.log(error.format(), error.prettify())
}
void value
```

`StructIssue`에는 `code`, `expected`, `message`, `path`, `received`가 있어요. `code`는 `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, `missing_key` 중 하나예요. issue는 신뢰할 수 없는 입력을 담을 수 있으니 로그하거나 돌려주기 전에 마스킹하세요. `struct.parse(..., { errorMap })`은 그 호출의 issue 메시지만 다시 써요.

Struct 검증은 구조적일 뿐이에요. 공개된 범위, 형식, refinement, 인증, 상태 전이 규칙은 없어요. 그런 검사는 명령을 만들기 전에 하세요.

## 참고

`@defjs/core`의 공개 생성자예요 (내부는 퍼사드 API가 아니에요).

```typescript twoslash
import { struct } from '@defjs/core'

const Any = struct.any()
const ArrayOfStrings = struct.array(struct.string())
const Bytes = struct.arrayBuffer()
const BigIntValue = struct.bigint()
const BlobValue = struct.blob()
const BooleanValue = struct.boolean()
const DateValue = struct.date()
const Discriminated = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('created'), id: struct.number() }),
  struct.object({ kind: struct.literal('deleted'), id: struct.number() }),
])
const Status = struct.enum(['draft', 'published'])
const FileValue = struct.file()
const Form = struct.formData({ file: struct.file() })
const Combined = struct.intersection(struct.object({ id: struct.number() }), struct.object({ name: struct.string() }))
const Literal = struct.literal('ready')
const NullValue = struct.null()
const NumberValue = struct.number()
const ObjectValue = struct.object({ id: struct.number() })
const Union = struct.or(struct.string(), struct.number())
const RecordValue = struct.record(struct.number())
const StringValue = struct.string()
const Tuple = struct.tuple([struct.string(), struct.number()])
const Unknown = struct.unknown()
const FormUrlEncoded = struct.urlencoded({ name: struct.string() })

void [Any, ArrayOfStrings, Bytes, BigIntValue, BlobValue, BooleanValue, DateValue, Discriminated, Status, FileValue, Form, Combined]
void [Literal, NullValue, NumberValue, ObjectValue, Union, RecordValue, StringValue, Tuple, Unknown, FormUrlEncoded]
```

| 생성자                           | 입력                                       | 추론된 출력                   |
| -------------------------------- | ------------------------------------------ | ----------------------------- |
| `struct.number()`                | `NaN`이 아닌 숫자                          | ±`Infinity`를 포함한 `number` |
| `struct.date()`                  | `Date`, 숫자, 또는 날짜 문자열             | 유효한 `Date`                 |
| `struct.bigint()`                | `bigint` 또는 `BigInt(...)`가 받는 문자열  | `bigint`                      |
| `struct.enum(...)`               | 선언된 문자열 또는 숫자 멤버               | 그 리터럴 유니언              |
| `struct.discriminatedUnion(...)` | 필수 리터럴 discriminator가 있는 객체      | 선택된 객체 분기              |
| `struct.or(...)`                 | 먼저 맞는 분기. 인코딩은 모호함을 검사해요 | 분기 출력의 유니언            |
| `struct.intersection(...)`       | 모든 멤버가 받는 값                        | 출력의 교집합                 |
| `struct.record(value)`           | 값이 `value`와 맞는 평범한 객체            | 파싱된 값의 레코드            |
| `struct.tuple(items)`            | 선언된 길이와 정확히 같은 배열             | 고정 길이 튜플                |

모든 Struct는 `.alias(name)`, `.optional()`, `.null()`, `.nullish()`를 지원해요. `struct.discriminatedUnion`은 필수 리터럴 discriminator가 있는 객체 옵션이 필요하고, 중복은 거부해요.

`struct`, `Infer`, `Struct`, `StructError`, 관련 공개 타입은 `@defjs/core`에서 import하세요. 파서는 `struct.parse(...)`를 쓰세요. `createObjectStruct`, 정의 심볼, 코덱 내부, `packages/core/src`는 import하지 마세요.

퍼사드가 약속하지 않는 것:

- 객체/레코드 출력은 null prototype을 써요. `Object.prototype` 메서드가 있다고 가정하지 마세요.
- 알 수 없는 객체 키는 버려져요.
- `struct.number()`는 `NaN`을 거부하고 무한대는 받아요.
- `struct.or(...)`는 분기를 순서대로 시도하고, 분기가 인코딩에서 서로 다르면 모호한 인코딩을 거부해요.
- `struct.intersection(...)`은 선언 순서로 멤버를 파싱해요.
- intersection은 멤버 출력을 깊게 병합해요(`Object.is`로 같은 값과 같은 시각의 Date는 유지하고, plain object와 길이가 같은 배열은 재귀적으로 병합하며, 그 밖의 충돌은 해당 path의 `invalid_intersection`이에요). `unknown` / `any`는 출력에 기여하지 않아요. 하나의 논리 키는 여러 wire key에 대응할 수 있어요. 같은 wire key에 서로 다른 값이 쓰일 때만 충돌이에요.
- Struct는 경계를 검증해요. 캐시하거나, 인가하거나, 전송 리소스를 소유하지는 않아요.

## 관련 레시피

- [POST JSON](../recipes/post-json.md)
- [선언된 404가 있는 GET](../recipes/get-declared-404.md)
