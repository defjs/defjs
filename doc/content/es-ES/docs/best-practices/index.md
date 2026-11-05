---
title: "Descripción general"
description: "Los contratos y límites que mantienen un SDK predecible entre autores de SDK, aplicaciones y runtimes."
---

Estas prácticas no son necesarias para que Defjs funcione. Mantienen un SDK predecible cuando varias personas poseen la definición, la aplicación y el transporte. Cada página parte de una regla, muestra una forma preferida y una forma que conviene evitar, y explica el límite que hay detrás.

## Mantén separadas la definición y la ejecución [#definition-execution]

Una definición es datos. Declara el método, el path, el input, el output y el contrato de error. No crea un cliente, no lee credenciales ni inicia E/S. La aplicación crea el cliente y llama a la operación. Llamar a la operación es lo que ejecuta la solicitud.

Esta separación permite que un paquete de SDK se publique sin endpoint ni credenciales, y que una misma definición se ejecute con endpoints distintos en un navegador, un servidor o una prueba.

## Declara el input y colócalo explícitamente [#input-builder]

`input` describe los valores que aporta quien llama. `builder` decide dónde va cada valor: path, query, headers o body. La ubicación nunca se infiere del nombre de un campo ni de la plantilla del path.

`builder` es una función síncrona y pura. Se ejecuta en tiempo de ejecución. Un throw se convierte en `REQ_BUILD_FAILED`.

## Lee primero el hueco de error [#error-first]

Cada operación devuelve una tupla error-first. El primer elemento es un fault o `null`. Los fallos de solicitud, de respuesta y de transporte no se lanzan en el lugar de la llamada.

Lee el fault antes de usar el valor de éxito. Estrecha por `code` y después lee los campos que pertenecen a ese fault.

## La aplicación posee el cliente [#client-ownership]

La aplicación posee el endpoint, las credenciales, los interceptores, los transportes y el tiempo de vida de los streams y las sesiones. El SDK posee el contrato. Los plugins pueden pasar un cliente de la aplicación a través del árbol de un framework; no crean ni cachean uno.

## Páginas de esta sección [#pages]

- [Diseño del SDK](/es-ES/docs/best-practices/sdk-design) — definiciones, Structs, nombres y publicación.
- [Integración de la aplicación](/es-ES/docs/best-practices/application) — creación del cliente, configuración, interceptores y plugins de framework.
- [Gestión de errores](/es-ES/docs/best-practices/errors) — códigos de fallo, estrechamiento, logging y reintentos.
- [Streaming y tiempo real](/es-ES/docs/best-practices/streaming) — SSE, WebSocket, propiedad y contrapresión.
- [Pruebas](/es-ES/docs/best-practices/testing) — transportes inyectados, pruebas de contrato y temporizadores.
- [Seguridad](/es-ES/docs/best-practices/security) — credenciales, XSRF, validación de URL y redacción.
- [Rendimiento](/es-ES/docs/best-practices/performance) — streaming, colas, failover y medición.
