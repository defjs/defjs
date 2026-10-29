---
title: Struct
description: struct 퍼사드, Infer, StructError예요.
---

# Struct

와이어 경계의 모양을 만들고, 값을 파싱하고, TypeScript 타입을 추론해요.

## struct

퍼사드예요. 내부 생성자보다 이걸 쓰세요.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias("display_name"),
});

function readUser() {
  const [error, user] = struct.parse(User, { id: 1, displayName: "Ada" });
  if (error) {
    console.error(error.message);
    return;
  }
  console.log(user.displayName);
}

readUser();
```

### 원시값과 컨테이너

| 헬퍼                                                                        | 역할                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | 스칼라                                                                         |
| `struct.literal(value)`                                                     | 정확한 리터럴                                                                  |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()`와 `unknown()`은 `null`과 `undefined`를 거부해요  |
| `struct.date()`                                                             | `Date`                                                                         |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | 컬렉션. `tuple`은 배열 하나를 받아요: `struct.tuple([a, b])`                   |
| `struct.object(shape)`                                                      | 객체. 필드는 `.optional()`, `.null()` / `.nullable()`, `.alias(name)`을 받아요 |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | 유니언                                                                         |
| `struct.enum(values)`                                                       | 문자열 목록 또는 `{ Name: value }` map. map은 키가 아니라 값을 받아요          |

### body 코덱과 바이너리 값

| 헬퍼                                           | 역할                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | 객체 struct에 코덱 태그를 더해요. 태그는 그 값이 요청 body 루트일 때만 적용돼요                                                                                                               |
| `struct.arrayBuffer()` / `blob()` / `file()`   | 바이너리 값이에요. body 루트면 바이트로 보내고, `output` / `error`면 그 표현을 골라요                                                                                                         |
| `struct.string()`                              | 텍스트예요. HTTP나 SSE의 body 루트이거나 HTTP/SSE로 들어오는 값이면 바이트는 텍스트로 남아요. WebSocket으로 들어오는 프레임은 먼저 JSON으로 파싱되므로 string struct는 JSON 문자열을 기대해요 |

### struct.parse()

<ApiSignature name="struct.parse" />

- **반환** `[null, value]` 또는 `[StructError, undefined]`예요. 오류에는 issue가 하나만 담겨요. 객체 필드는 첫 번째 잘못된 필드에서 멈춰요. `struct.or`는 모든 분기를 시도한 뒤 `invalid_union`을 보고하고, 첫 분기 실패를 남기지 않아요.
- 객체 필드는 `.optional()`이나 `.nullish()`로 표시하지 않으면 필수예요. shape에 선언하지 않은 키는 결과에서 빠져요.
- 선택 `options.errorMap`은 이번 파싱의 issue 메시지만 다시 써요.
- 기본은 **논리** 키(`displayName`)를 읽어요. HTTP/JSON 코덱처럼 와이어 키(`display_name`)를 읽으려면 `{ aliases: true }`를 넘기세요.

## ErrorMap

<ApiSignature name="ErrorMap" />

## 타입

### Infer

### StructInput

### AnyStruct

### ParseResult

<ApiSignature name="Infer, StructInput, AnyStruct, ParseResult" />

### StructError

<ApiSignature name="StructError" />

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code`는 `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, `missing_key` 중 하나예요.

[Struct 가이드](/ko-KR/docs/struct)를 보세요.

## STRUCT

엔드포인트 입력에서 파싱된 객체에 태그를 붙이는 `unique symbol`이에요. 나가는 방향의 인코더 내부용이며 타입으로만 export돼요. 읽거나 설정하지 마세요.

## Struct

파싱할 수 있는 모양이에요. input/output 타입에 `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`가 있어요.

## StructLike

`_struct` 타입 payload가 있는 모든 것이에요. [`StructLike`](/ko-KR/api/core/structlike-type)를 보세요.

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`이에요.

## ObjectStruct

`struct.object`가 만든 객체 모양 struct예요.

## StructIssue

`path`, `code`, `expected`, `received`, `message`예요. `code`는 `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, `missing_key` 중 하나예요.

## FormattedStructError

`StructError.format()`이 만드는 중첩 `{ _errors, [key]: … }` 트리예요.

## FlattenedStructError

`StructError.flatten()`의 `formErrors`와 `fieldErrors`예요.
