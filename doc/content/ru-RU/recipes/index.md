---
title: "Практические примеры"
description: Соберите и опубликуйте переиспользуемый SDK, затем настройте аутентификацию, вызовы и работу в реальном времени в приложениях.
---

# Практические примеры

Начните с руководства [Создание и публикация SDK](/ru-RU/recipes/publish-http-sdk): это полный путь от экспортированного определения до npm-пакета и использующего приложения. Рецепты ниже показывают отдельные контракты операций и политики приложения, которые можно собрать вокруг этого SDK, с примерами нескольких связанных файлов.

## HTTP

- [Отправка JSON](/ru-RU/recipes/post-json) — сопоставление полей в camelCase с сетевыми ключами `snake_case` и декодирование типизированного ответа `201`.
- [Обработка объявленной 404](/ru-RU/recipes/get-declared-404) — ветвление между типизированным `200` output и объявленным телом ошибки `404` `HTTP_STATUS`.
- [Отмена и таймауты](/ru-RU/recipes/cancel-http) — объединение `AbortController` с `AbortSignal.timeout(...)` и разделение `NET_ABORTED` и `NET_TIMEOUT`.
- [Условные запросы ETag](/ru-RU/recipes/etag-revalidate) — отправка `If-None-Match`, обработка `304 Not Modified` как сбоя `HTTP_STATUS` и хранение кэша `Map` в коде приложения.
- [Запросы GraphQL](/ru-RU/recipes/graphql-http-envelope) — отправка GraphQL-запроса через HTTP `POST` и распаковка `errors[]` против `.nullish()` `data` во вспомогательной функции.
- [Курсорная пагинация](/ru-RU/recipes/cursor-pagination) — потоковое получение постраничных результатов API через асинхронный генератор с передачей отмены `AbortSignal` для каждой страницы.
- [Ключи идемпотентности](/ru-RU/recipes/idempotency-key) — автоматическое добавление заголовков `Idempotency-Key` при повторных попытках `POST`/`PATCH` с помощью `idempotencyKeyHttpInterceptor`.
- [Ограничения параллелизма и пулы вызовов](/ru-RU/recipes/concurrency-limit) — ограничение числа параллельных запросов с помощью `concurrencyLimitHttpInterceptor` и примитивов `@defjs/core/concurrent`.
- [HTTP-хэндл на Undici Pool](/ru-RU/recipes/undici-pool) — подключение `undici.Pool` к `withHTTPHandle` для keep-alive пулинга соединений в Node.js.

## Аутентификация

- [Обновление токена после 401](/ru-RU/recipes/refresh-bearer-once) — добавление токена `Bearer`, дедупликация параллельных обновлений и один повтор внутри HTTP-перехватчика.

## Реальное время

- [Получение событий SSE](/ru-RU/recipes/consume-sse) — открытие типизированного потока Server-Sent Events, чтение и гарантия `stream.close()` + `await stream.closed` в блоке `finally`.
- [Управление сессиями WebSocket](/ru-RU/recipes/websocket-session) — обмен типизированными входящими и исходящими JSON-кадрами, подписка на `onRuntimeError` и чистое закрытие.

## Тестирование и публикация SDK [#testing-and-packaging]

- [Локальные HTTP-тесты](/ru-RU/recipes/test-with-handle) — тестирование построения URL, перехватчиков и декодирования Struct в памяти с `withHTTPHandle(...)`.
- [Создание и публикация SDK](/ru-RU/recipes/publish-http-sdk) — упаковка и публикация SDK без встроенного клиента с помощью `tsdown` и его использование из приложения.
