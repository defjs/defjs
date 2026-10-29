---
title: Struct
description: Fachada struct, Infer y StructError.
---

# Struct

Construye formas del límite de cable, parsea valores e infiere tipos TypeScript.

## struct

Fachada. Prefiere esto frente a los constructores internos.

```ts
const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias("display_name"),
});

const [error, user] = struct.parse(User, { id: 1, displayName: "Ada" });
```

### Primitivos y contenedores

| Helper                                                                      | Rol                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Escalares                                                                            |
| `struct.literal(value)`                                                     | Literal exacto                                                                       |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()` y `unknown()` rechazan `null` y `undefined`            |
| `struct.date()`                                                             | `Date`                                                                               |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | Colecciones. `tuple` recibe un solo array: `struct.tuple([a, b])`                    |
| `struct.object(shape)`                                                      | Objeto; los campos aceptan `.optional()`, `.null()` / `.nullable()`, `.alias(name)`  |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Uniones                                                                              |
| `struct.enum(values)`                                                       | Lista de strings o mapa `{ Name: value }`; el mapa acepta sus valores, no sus claves |

### Códecs de body y valores binarios

| Helper                                         | Rol                                                                                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Struct de objeto más un tag de códec. El tag solo aplica cuando ese valor es la raíz del body de la solicitud                                                                                                   |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Valores binarios. Como raíz de body se envían como bytes; como `output` / `error` seleccionan esa representación                                                                                                |
| `struct.string()`                              | Texto. Como raíz de body HTTP o SSE, o como dato de entrada HTTP/SSE, los bytes siguen siendo texto. Un frame entrante de WebSocket se parsea primero como JSON, así que un struct string espera un string JSON |

### struct.parse()

<ApiSignature name="struct.parse" />

- **Devuelve** `[null, value]` o `[StructError, undefined]`. El error lleva un solo issue. Los campos de un objeto se detienen en el primer campo incorrecto. `struct.or` prueba todas las ramas y luego informa `invalid_union`; no conserva el fallo de la primera rama.
- Los campos de un objeto son obligatorios salvo que se marquen con `.optional()` o `.nullish()`. Las claves que la forma no declara se descartan del resultado.
- `options.errorMap` opcional reescribe los mensajes de issue solo para este parse.
- Por defecto lee claves **lógicas** (`displayName`). Pasa `{ aliases: true }` para leer claves de cable (`display_name`) igual que los códecs HTTP/JSON.

## ErrorMap

<ApiSignature name="ErrorMap" />

## Tipos

### Infer

### StructInput

### AnyStruct

### ParseResult

<ApiSignature name="Infer, StructInput, AnyStruct, ParseResult" />

### StructError

<ApiSignature name="StructError" />

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` es `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` o `missing_key`.

Mira la [guía de Struct](/es-ES/docs/struct).

## STRUCT

Un `unique symbol` que etiqueta los objetos parseados a partir del input del endpoint. Es interno del codificador de salida y se exporta solo como tipo. No lo leas ni lo establezcas.

## Struct

Forma parseable: tipos input/output más `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Cualquier cosa con un payload de tipo `_struct`. Consulta [`StructLike`](/es-ES/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

Struct con forma de objeto, de `struct.object`.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` es `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` o `missing_key`.

## FormattedStructError

Árbol anidado `{ _errors, [key]: … }` de `StructError.format()`.

## FlattenedStructError

`formErrors` más `fieldErrors` de `StructError.flatten()`.
