---
title: "Skill"
description: "Instala el skill de Defjs, pide una operación GET tipada y comprueba el resultado con el SDK instalado."
---

# Skill

El skill de Defjs transmite al asistente el contrato entre la definición del SDK y la ejecución en la aplicación. Un asistente compatible puede cargarlo para una tarea relevante; la activación automática depende de la herramienta.

## Instalar el skill [#install]

Ejecuta el comando en el proyecto que debe recibir el skill. La CLI instala en el proyecto actual por defecto y puede detectar el agente actual o pedirte que lo elijas; usa `-a` para indicar un agente de forma explícita.

```sh
bunx skills add defjs/defjs --skill defjs
```

Después de la publicación, las instrucciones del skill se leen en [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). La fuente de GitHub es la rama predeterminada y puede no coincidir con la versión de `@defjs/core` instalada en un proyecto.

## Pedir una operación [#prompt]

Dale al asistente una tarea. Este prompt pide una operación tipada `GET /orders/:id` cuyo cliente permanece en la aplicación:

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## Comprobar el resultado [#verify]

Lee la definición y la aplicación por separado. La definición exporta la operación y no crea el cliente. La aplicación crea el cliente y llama a la operación, por ejemplo `getOrder(client, { id: 1 })`. Si `input` está declarado, `builder` es una función síncrona y pura escrita de forma explícita. El valor de éxito solo se usa cuando el hueco del error está vacío.

Después ejecuta la comprobación de tipos de ese proyecto y las pruebas que cubren el contrato. La instalación de dependencias y las reglas de CI se quedan en ese proyecto.
