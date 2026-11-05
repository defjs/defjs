---
title: "Diseño del SDK"
description: "Diseña operaciones, Structs y paquetes que describan un contrato sin poseer un cliente de la aplicación."
---

## Una operación por definición [#one-operation]

Da a cada operación su propia definición y su propio módulo. Una operación tiene un método, una forma de path, un input y un contrato de output. Separar por operación mantiene legible el contrato y permite que una aplicación importe solo las operaciones que llama.

Prefiere:

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

Evita un módulo que cree un cliente o guarde un endpoint junto a las definiciones.

## Empareja el input con un builder explícito [#builder]

Declara en `input` cada valor de quien llama y colócalo en `builder`. No confíes en que el nombre de un campo coincida con un parámetro del path. `builder` es síncrono y puro: puede remodelar valores, pero no debe leer credenciales, llamar a la red ni mutar estado compartido.

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## Los Structs describen la forma en el cable [#structs]

Usa Struct para los datos que cruzan el cable. Usa alias cuando el nombre de cable difiera del nombre de TypeScript. Trata las reglas de negocio, la validación entre campos y la normalización como política de la aplicación, no como comportamiento de Struct.

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## Usa un nombre de operación estable [#operation-name]

Define `operation` con una identidad de baja cardinalidad, como `orders.read`. Etiqueta la telemetría y el diagnóstico sin arrastrar la URL, el input del usuario ni un valor por solicitud.

## Mantén el SDK libre de estado de ejecución [#no-client]

Un paquete de SDK exporta definiciones, Structs y tipos. No llama a `createClient`, no guarda un cliente singleton ni lee variables de entorno. La aplicación decide el endpoint y las credenciales.

## Versiona el contrato de forma deliberada [#versioning]

Trata como breaking la eliminación de un campo, el cambio de método o de path y el estrechamiento de un input. Las adiciones suelen ser compatibles. Mantén honesto el rango de peer del paquete, publica con el mismo texto de definición contra el que compila la aplicación y registra la etiqueta de release del paquete publicado.
