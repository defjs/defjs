---
title: Перехватчики
description: Конструкторы перехватчиков HTTP, SSE и WebSocket.
---

# Перехватчики

Оберните `next` для одного транспорта или для всего вызова операции. Регистрируйте через `withInterceptors`. Смешанные списки фильтруются по виду, когда выполняется операция.

## createHttpInterceptor()

<ApiSignature name="createHttpInterceptor, InterceptorFn, HttpInterceptorNext" />

Вызывайте `next(req)` (при необходимости с изменённым запросом) или выполняйте short-circuit через `makeResponse`. `next` идёт только внутрь: к перехватчикам, зарегистрированным после этого, а затем к транспорту. Повторный вызов заново проигрывает эту внутреннюю часть начиная с данного перехватчика; внешние перехватчики дважды не выполняются.

## createSSEInterceptor()

<ApiSignature name="createSSEInterceptor, SSEHandler, SSEInterceptorFn" />

`EventStreamHandle` расширяет `AsyncDisposable`. Структурная реализация short-circuit обязана предоставить `[Symbol.asyncDispose](): PromiseLike<void>` и связать его с тем же жизненным циклом закрытия.

## createWebSocketInterceptor()

<ApiSignature name="createWebSocketInterceptor, WebSocketHandler, WebSocketInterceptorFn" />

`WebSocketSessionLike` — сессия со стороны перехватчика:

<ApiSignature name="WebSocketSessionLike" />

Обёртка или сессия с short-circuit должна пересылать тот же механизм освобождения `[Symbol.asyncDispose]()`, что и её жизненный цикл `close` / `closed`; отдельного разрешённого promise недостаточно.

## createOperationInterceptor()

<ApiSignature name="createOperationInterceptor, OperationInterceptorFn, OperationCall, OperationResult" />

`next()` выполняет весь вызов: валидацию input, выбор эндпоинта, builder, каждую попытку с её транспортными перехватчиками и повторами, а также декодирование ответа. Он не принимает аргументов и выполняет вызов один раз, сколько бы раз его ни вызывали. Функция обобщена по результату, поэтому она может завершиться только тем, чем завершился `next()`. Перехватчики операции выполняются для каждого транспорта, снаружи транспортных перехватчиков. Брошенная ошибка или отклонение promise завершают операцию сбоем `EXT_INTERCEPTOR_FAILED`, а уже открытые вызовом поток или сессия закрываются.

<include cwd>examples/api/create-operation-interceptor.ts#example</include>

## Типы с тегом

## Interceptor

## HttpInterceptor

## SSEInterceptor

## WebSocketInterceptor

## OperationInterceptor

<ApiSignature name="Interceptor, HttpInterceptor, SSEInterceptor, WebSocketInterceptor, OperationInterceptor" />

## Базовая аутентификация

## basicAuthHttpInterceptor()

## basicAuthSSEInterceptor()

## BasicAuthInterceptorOptions

<ApiSignature name="basicAuthHttpInterceptor, basicAuthSSEInterceptor, BasicAuthInterceptorOptions" />

Ставит `Authorization: Basic <encoded>` на каждый запрос. `fn` возвращает `{ username, password }` и вызывается на каждый запрос. Необязательный второй аргумент `{ encode }` получает эти учётные данные и возвращает часть после `Basic `; кодирование по умолчанию — ``btoa(`${username}:${password}`)``. Без `encode` создание перехватчика выбрасывает ошибку, если `btoa` недоступен.

См. [руководство по перехватчикам](/ru-RU/docs/interceptors).
