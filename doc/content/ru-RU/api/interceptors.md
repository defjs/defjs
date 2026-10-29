---
title: Interceptors
description: Конструкторы interceptor’ов HTTP, SSE и WebSocket.
---

# Interceptors

Оберни `next` для одного транспорта. Регистрируй через `withInterceptors`. Смешанные списки фильтруются по kind в момент execute.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Зови `next(req)` (можно мутированный request) или short-circuit через `makeResponse`. `next` идёт только внутрь: к interceptor’ам, зарегистрированным после этого, а затем к транспорту. Повторный вызов заново проигрывает эту внутреннюю часть начиная с данного interceptor’а; внешние interceptor’ы дважды не выполняются.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` расширяет `AsyncDisposable`. Структурная short-circuit реализация обязана предоставить `[Symbol.asyncDispose](): PromiseLike<void>` и связать его с тем же close lifecycle.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` — session со стороны interceptor:

<ApiSignature name="WebSocketSessionLike" />

Wrapper или short-circuit session должен пересылать тот же teardown `[Symbol.asyncDispose]()`, что и его `close` / `closed` lifecycle; отдельного resolved promise недостаточно. Требование этого member — compile-time breaking change для структурных реализаций. Код, который только принимает session от Defjs, не обязан добавлять новый runtime-вызов.

## Типы с тегом

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor" />

## Базовая аутентификация

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Ставит `Authorization: Basic <encoded>` на каждый запрос. `fn` возвращает `{ username, password }` и вызывается на каждый запрос. Необязательный второй аргумент `{ encode }` получает этот credential и возвращает часть после `Basic `; кодирование по умолчанию — ``btoa(`${username}:${password}`)``. Без `encode` создание interceptor’а бросает ошибку, если `btoa` недоступен.

См. [гайд Interceptors](/ru-RU/docs/interceptors).
