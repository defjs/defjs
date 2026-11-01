---
title: "Руководство"
description: Проектируй контракты и операции SDK, публикуй их и настраивай выполнение в приложениях-потребителях.
---

Defjs отделяет API, который публикует группа, от клиента, которым пользуется приложение. Иди путём автора SDK, чтобы описать и упаковать операции; иди путём приложения, чтобы настроить выполнение и обработать результаты.

## Разработка SDK [#getting-started]

- [Обзор проекта](/ru-RU)
- [Быстрый старт](/ru-RU/docs/start)
- [Создание и публикация SDK](/ru-RU/recipes/publish-http-sdk)
- [Почему определения и выполнение разделены](/ru-RU/docs/design-decisions)

## Контракты и выполнение [#calls-and-contracts]

Авторы SDK владеют Struct и определениями эндпоинтов. Приложения дают Client и вызывают с ним операции.

- [Контракты данных / Struct](/ru-RU/docs/struct)
- [Настройка клиента / Client](/ru-RU/docs/client)

## Запросы и реальное время

- [HTTP-запросы](/ru-RU/docs/http)
- [Потоки событий SSE](/ru-RU/docs/sse)
- [Сессии WebSocket](/ru-RU/docs/web-socket)

## Ошибки и перехват

- [Обработка ошибок](/ru-RU/docs/errors)
- [Перехватчики](/ru-RU/docs/interceptors)

## Плагины

Необязательные пакеты для клиента приложения-потребителя. Определения SDK от них не зависят.

- [Плагины](/ru-RU/docs/integrations)
- [React](/ru-RU/docs/integrations/react)
- [Vue](/ru-RU/docs/integrations/vue)
- [OpenTelemetry на сервере](/ru-RU/docs/integrations/opentelemetry-server)

## ИИ

- [Разработка с помощью ИИ](/ru-RU/docs/ai)
- [Вызов API ИИ](/ru-RU/docs/ai-api)

[Проектные решения](/ru-RU/docs/design-decisions)
