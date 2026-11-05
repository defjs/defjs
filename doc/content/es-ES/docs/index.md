---
title: "Guía"
description: Diseña contratos y operaciones de SDK, publícalos y configura la ejecución en las aplicaciones que los consumen.
---

Defjs separa la API que publica un equipo del cliente que usa una aplicación. Sigue el camino de autoría del SDK para definir y empaquetar operaciones; sigue el camino de la aplicación para configurar la ejecución y tratar los resultados.

## Prefacio [#getting-started]

- [Resumen del proyecto](/es-ES)
- [Inicio rápido](/es-ES/docs/start)
- [Crear y publicar un SDK](/es-ES/recipes/publish-http-sdk)
- [Por qué las definiciones y la ejecución están separadas](/es-ES/docs/design-decisions)

## Contratos y ejecución [#calls-and-contracts]

Los autores del SDK son dueños de los Struct y de las definiciones de endpoint. Las aplicaciones aportan el Client y llaman a las operaciones con él.

- [Contratos de datos / Struct](/es-ES/docs/struct)
- [Configuración del cliente / Client](/es-ES/docs/client)

## Solicitudes y tiempo real

- [Solicitudes HTTP](/es-ES/docs/http)
- [Flujos de eventos SSE](/es-ES/docs/sse)
- [Sesiones WebSocket](/es-ES/docs/web-socket)

## Errores e interceptores

- [Manejo de errores](/es-ES/docs/errors)
- [Interceptores](/es-ES/docs/interceptors)

## Plugins

Paquetes opcionales para el cliente de la aplicación consumidora. Las definiciones del SDK siguen siendo independientes de ellos.

- [Plugins](/es-ES/docs/integrations)
- [React](/es-ES/docs/integrations/react)
- [Vue](/es-ES/docs/integrations/vue)
- [OpenTelemetry en el servidor](/es-ES/docs/integrations/opentelemetry-server)

## IA

- [Desarrollo asistido por IA](/es-ES/docs/ai)
- [Llamar a API de IA](/es-ES/docs/ai-api)

[Decisiones de diseño](/es-ES/docs/design-decisions)
