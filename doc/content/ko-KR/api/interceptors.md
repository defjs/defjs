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

[인터셉터 가이드](/ko-KR/docs/interceptors)를 보세요.
