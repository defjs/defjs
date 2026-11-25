---
title: 인터셉터
description: HTTP, SSE, WebSocket 인터셉터 생성자예요.
---

# 인터셉터

전송 하나, 또는 작업 호출 전체에서 `next`를 감싸요. `withInterceptors`로 등록해요. 혼합 목록은 작업이 실행될 때 종류별로 걸러져요.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

`next(req)`를 호출하거나 (바꾼 요청도 가능) `makeResponse`로 단락(short-circuit)시켜요. `next`는 안쪽으로만 진행해요. 이 인터셉터 뒤에 등록된 인터셉터들을 거쳐 전송까지 가요. 다시 호출하면 이 인터셉터 뒤에 등록된 안쪽만 다시 실행하고, 바깥쪽 인터셉터는 두 번 실행되지 않아요.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle`은 `AsyncDisposable`을 상속해요. 구조적 단락(short-circuit) 구현은 `[Symbol.asyncDispose](): PromiseLike<void>`를 제공하고 같은 종료 수명 주기에 연결해야 해요.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike`는 인터셉터가 보는 세션이에요.

<ApiSignature name="WebSocketSessionLike" />

래퍼나 단락 세션은 `close` / `closed` 수명 주기와 같은 `[Symbol.asyncDispose]()` 정리를 전달해야 해요. 관계없는 resolve된 Promise를 반환하는 것만으로는 부족해요.

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()`는 호출 전체를 실행해요. 입력 검증, 엔드포인트 선택, 빌더, 전송 인터셉터와 재시도를 포함한 모든 시도, 응답 디코딩까지예요. 인자는 받지 않고, 몇 번 호출해도 호출을 한 번만 실행해요. 함수는 결과에 대해 제네릭이라서 `next()`가 resolve한 값으로만 resolve할 수 있어요. 작업 인터셉터는 모든 전송에서 실행되고, 전송 인터셉터의 바깥쪽에서 실행돼요. throw나 reject는 작업을 `EXT_INTERCEPTOR_FAILED`로 resolve하고, 호출이 이미 열어 둔 스트림이나 세션은 닫아요.

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## 태그가 있는 타입

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## 기본 인증

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

요청마다 `Authorization: Basic <encoded>`를 설정해요. `fn`은 `{ username, password }`를 반환하고 요청마다 호출돼요. 선택적 두 번째 인자 `{ encode }`는 그 자격 증명을 받아 `Basic ` 뒤의 부분을 반환해요. 기본 인코딩은 ``btoa(`${username}:${password}`)``예요. `encode` 없이 `btoa`를 쓸 수 없으면 인터셉터를 만들 때 throw해요.

## 동시성 제한

### concurrencyLimitHttpInterceptor()

### BulkheadOverflowError

### ConcurrencyLimitInterceptorOptions

<ApiSignature name="concurrencyLimitHttpInterceptor, BulkheadOverflowError, ConcurrencyLimitInterceptorOptions" />

버킷별(`key`, 기본값은 공유 버킷 하나)로 동시에 진행 중인 HTTP 시도 수를 제한해요. `maxConcurrency`를 넘는 요청은 최대 `maxQueue`(기본값 `Infinity`)까지 FIFO 순서로 대기하거나, `BulkheadOverflowError`로 reject돼요(`{ attempted: false }`와 함께 `EXT_INTERCEPTOR_FAILED`로 표면화돼요). 허가권(permit)은 `withRetry` 백오프 대기 동안 반환되며, 시작 전이나 대기 중에 abort된 요청은 `NET_ABORTED` 또는 `NET_TIMEOUT`으로 해결돼요. [동시성 제한 및 풀링된 호출](/ko-KR/recipes/concurrency-limit)을 보세요.

## 멱등성 키

### idempotencyKeyHttpInterceptor()

### IdempotencyKeyInterceptorOptions

<ApiSignature name="idempotencyKeyHttpInterceptor, IdempotencyKeyInterceptorOptions" />

`req.headers`를 복제하고 메서드가 `methods`(기본값 `['POST', 'PATCH']`)와 일치하는 요청에 `headerName`(기본값 `'Idempotency-Key'`)을 설정해요. `respectExisting`이 `true`(기본값)일 때 이미 해당 헤더가 있는 요청은 건너뛰어요. `generate`가 없으면 `req.correlationId`를 재사용(또는 v4 UUID로 폴백)하므로 한 호출의 모든 `withRetry` 시도가 같은 키를 보내요. `generate`가 있으면 최대 4,096개 항목의 제한된 캐시에서 `req.correlationId`를 기준으로 메모이제이션해요. [멱등성 키](/ko-KR/recipes/idempotency-key)를 보세요.

[인터셉터 가이드](/ko-KR/docs/interceptors)를 보세요.
