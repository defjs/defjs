---
title: Struct
description: struct 퍼사드, Infer, StructError예요.
---

# Struct {#page}

와이어 경계의 모양을 만들고, 값을 파싱하고, TypeScript 타입을 추론해요.

## struct {#struct}

퍼사드예요. 내부 생성자보다 이걸 쓰세요.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
```

### 원시값과 컨테이너

| Helper                                                                      | 역할                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | 스칼라                                                                         |
| `struct.literal(value)`                                                     | 정확한 리터럴                                                                  |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown                                                           |
| `struct.date()`                                                             | `Date`                                                                         |
| `struct.array(item)` / `tuple(...)` / `record(value)`                       | 컬렉션                                                                         |
| `struct.object(shape)`                                                      | 객체. 필드는 `.optional()`, `.null()` / `.nullable()`, `.alias(name)`을 받아요 |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | 유니언                                                                         |
| `struct.enum(values)`                                                       | 문자열 목록 또는 `{ Name: value }` map                                         |

### body 코덱과 바이너리 값

| Helper                                         | 역할                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | 객체 struct에 코덱 태그를 더해요. 태그는 그 값이 요청 body 루트일 때만 적용돼요       |
| `struct.arrayBuffer()` / `blob()` / `file()`   | 바이너리 값이에요. body 루트면 바이트로 보내고, `output` / `error`면 그 표현을 골라요 |
| `struct.string()`                              | 텍스트예요. body 루트이거나 들어오는 `string` struct이면 바이트는 텍스트로 남아요     |

### struct.parse() {#struct.parse}

```ts
function parse<S>(struct: S, value: unknown, options?: { aliases?: boolean; errorMap?: ErrorMap }): ParseResult<Infer<S>>
```

- **반환** `[null, value]` 또는 `[StructError, undefined]`예요.
- 선택 `errorMap`은 이번 파싱의 issue 메시지만 다시 써요.
- 기본은 **논리** 키(`displayName`)를 읽어요. HTTP/JSON 코덱처럼 와이어 키(`display_name`)를 읽으려면 `{ aliases: true }`를 넘기세요.

## ErrorMap {#ErrorMap}

```ts
type ErrorMap = (issue: StructIssue) => string | undefined
```

## 타입

### Infer {#Infer}

### StructInput {#StructInput}

### AnyStruct {#AnyStruct}

### ParseResult {#ParseResult}

```ts
type Infer<T> = /* output type of T */
type StructInput<T> = /* input type of T */
type AnyStruct = Struct<any, any, boolean>
type ParseResult<O> = [error: null, value: O] | [error: StructError, value: undefined]
```

### StructError {#StructError}

```ts
class StructError extends Error {
  readonly issues: StructIssue[]
  format(): FormattedStructError
  flatten(): FlattenedStructError
  prettify(): string
}
```

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code`는 `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, `missing_key` 중 하나예요.

[Struct 가이드](/core/struct)를 보세요.

## Struct {#Struct}

파싱할 수 있는 모양이에요. input/output 타입에 `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`가 있어요.

## StructLike {#StructLike}

`_struct` 타입 payload가 있는 모든 것이에요.

## StructMethods {#StructMethods}

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`이에요.

## ObjectStruct {#ObjectStruct}

`struct.object`가 만든 객체 모양 struct예요.

## StructIssue {#StructIssue}

`path`, `code`, `expected`, `received`, `message`예요. `code`는 `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, `missing_key` 중 하나예요.

## FormattedStructError {#FormattedStructError}

`StructError.format()`이 만드는 중첩 `{ _errors, [key]: … }` 트리예요.

## FlattenedStructError {#FlattenedStructError}

`StructError.flatten()`의 `formErrors`와 `fieldErrors`예요.
