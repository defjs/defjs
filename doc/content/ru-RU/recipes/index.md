---
title: "Практические примеры"
description: Тестирование и публикация SDK, интеграция HTTP, аутентификации и реального времени в приложения.
---

Рецепты используют одно разделение: SDK экспортирует типизированные эндпоинты; приложение выполняет их через свой клиент и управляет результатами и жизненным циклом. Для собственного SDK начни с [локальных HTTP-тестов](/ru-RU/recipes/test-with-handle) и [публикации](/ru-RU/recipes/publish-http-sdk). Остальные рецепты посвящены отдельным контрактам API и правилам приложения.

## HTTP

- [Отправка JSON](/ru-RU/recipes/post-json)
- [Обработка объявленной 404](/ru-RU/recipes/get-declared-404)
- [Отмена и таймауты](/ru-RU/recipes/cancel-http)
- [Условные запросы ETag](/ru-RU/recipes/etag-revalidate)
- [Запросы GraphQL](/ru-RU/recipes/graphql-http-envelope)

## Аутентификация

- [Обновление токена после 401](/ru-RU/recipes/refresh-bearer-once)

## Реальное время

- [Получение событий SSE](/ru-RU/recipes/consume-sse)
- [Управление сессиями WebSocket](/ru-RU/recipes/websocket-session)

## Тестирование и публикация SDK [#тесты-и-упаковка]

- [Локальные HTTP-тесты](/ru-RU/recipes/test-with-handle)
- [Создание и публикация SDK](/ru-RU/recipes/publish-http-sdk)
