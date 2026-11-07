---
title: Перехватчики
description: Конструкторы перехватчиков HTTP, SSE и WebSocket.
---

# Перехватчики

Оберните `next` для одного транспорта. Регистрируйте через `withInterceptors`. Смешанные списки фильтруются по виду, когда выполняется операция.

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

Ставит `Authorization: Basic <encoded>` на каждый запрос. `fn` возвращает `{ username, password }` и вызывается на каждый запрос. Необязательный второй аргумент `{ encode }` получает эти учётные данные и возвращает часть после `Basic `; кодирование по умолчанию — ``btoa(`${username}:${password}`)``. Без `encode` создание перехватчика выбрасывает ошибку, если `btoa` недоступен.

См. [руководство по перехватчикам](/ru-RU/docs/interceptors).
