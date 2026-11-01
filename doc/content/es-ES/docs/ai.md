---
title: "Desarrollo asistido por IA"
description: "Instala el skill de Defjs, pide un endpoint GET tipado y comprueba el resultado con el SDK instalado."
---

Pedir a un asistente que escriba código Defjs y llamar a un servicio de IA desde la aplicación son dos tareas distintas. Esta página es el recorrido del asistente. [Llamar a API de IA](/es-ES/docs/ai-api) es el recorrido de la aplicación. Un asistente compatible puede cargar el Skill instalado cuando sea relevante; la activación depende de la herramienta.

## Instalar el skill [#install]

La CLI de skills necesita Node.js 22.20 o posterior. Ese requisito es del instalador. No es el runtime de `@defjs/core`. El runtime está en el [inicio rápido](/es-ES/docs/start).

Ejecuta el comando en el proyecto que debe recibir el Skill. La CLI instala en el proyecto actual por defecto y puede detectar el agente actual o pedirte que lo elijas; usa `-a` para indicar un agente de forma explícita.

```sh
npx skills add defjs/defjs --skill defjs
```

Después de la publicación, las instrucciones del skill se leen en [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). El código de GitHub es la rama predeterminada y puede no coincidir con la versión de `@defjs/core` instalada en un proyecto.

## Pedir un endpoint [#prompt]

Dale al asistente una tarea. Este prompt pide un `GET /users/:id` tipado cuyo cliente permanece en la aplicación:

```txt
Use @defjs/core to define GET /users/:id.
The input is { id: number }; a successful response is { id: number, name: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## Comprobar el resultado [#verify]

Lee la definición y la aplicación por separado. La definición exporta la operación y no crea el cliente. La aplicación crea el cliente y llama a la operación, por ejemplo `getUser(client, { id: 1 })`. Si `input` está declarado, `builder` es una función síncrona y pura escrita de forma explícita. El valor de éxito solo se usa cuando el hueco del error está vacío.

Después ejecuta la comprobación de tipos de ese proyecto y las pruebas que cubren el contrato. La instalación de dependencias y las reglas de CI se quedan en ese proyecto.

## Markdown en inglés para asistentes [#resources]

Las guías, los ejemplos y los resúmenes de API de este sitio están escritos para personas y existen en cada idioma. Estas tres direcciones se generan solo desde las páginas en inglés. No tienen prefijo de idioma y no son la traducción de la página que estás leyendo.

- [Índice de páginas en inglés](/llms.txt) enumera las páginas en inglés y enlaza sus direcciones web.
- [Guías en inglés compiladas](/llms-full.txt) une esas páginas en un archivo.
- [Inicio rápido en Markdown](/llms.mdx/docs/start/content.md) es el texto en inglés de una página. El resto de las páginas en inglés usa la misma forma, `/llms.mdx/…/content.md`.

Lee el [inicio rápido](/es-ES/docs/start) cuando quieras esa guía en este idioma. Dale al asistente la dirección Markdown cuando deba seguir la API. Sigue obligado a respetar la versión de `@defjs/core` instalada en el proyecto: la documentación del sitio puede diferir de la versión instalada, así que comprueba las API de esa versión. El código de GitHub de la documentación también es la rama predeterminada y puede no coincidir con la versión instalada. Quita los secretos y revisa la política de datos del proyecto antes de compartir código o contexto con una herramienta de IA.
