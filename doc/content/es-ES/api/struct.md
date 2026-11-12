---
title: Struct
description: Fachada struct, Infer y StructError.
---

# Struct

Construye formas del límite de red, analiza valores e infiere tipos TypeScript.

## struct

Fachada. Prefiere esto frente a los constructores internos.

<include cwd lang="typescript">
  examples/api/struct.ts#example
</include>

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

### Códecs de cuerpo y valores binarios

| Helper                                         | Rol                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct.formData(shape)` / `urlencoded(shape)` | Struct de objeto más un tag de códec. El tag solo se aplica cuando ese valor es la raíz del cuerpo de la solicitud                                                                                                  |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Valores binarios. Como raíz de cuerpo se envían como bytes; como `output` / `error` seleccionan esa representación                                                                                                  |
| `struct.string()`                              | Texto. Como raíz de cuerpo HTTP o SSE, o como dato de entrada HTTP/SSE, los bytes siguen siendo texto. Una trama entrante de WebSocket se analiza primero como JSON, así que un struct string espera un string JSON |

### struct.parse()

<ApiSignature name="struct.parse" />

- **Devuelve** `[null, value]` o `[StructError, undefined]`. El error lleva un solo issue. Los campos de un objeto se detienen en el primer campo incorrecto. `struct.or` prueba todas las ramas y luego informa `invalid_union`; no conserva el fallo de la primera rama.
- Los campos de un objeto son obligatorios salvo que se marquen con `.optional()` o `.nullish()`. Las claves que la forma no declara se descartan del resultado.
- `options.errorMap` opcional reescribe los mensajes de issue solo para este análisis.
- Por defecto lee claves **lógicas** (`customerName`). Pasa `{ aliases: true }` para leer claves de cable (`customer_name`) igual que los códecs HTTP/JSON.

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

Un `unique symbol` que etiqueta los objetos analizados a partir del input de la operación. Es interno del codificador de salida y se exporta solo como tipo. No lo leas ni lo establezcas.

## Struct

Forma analizable: tipos input/output más `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Cualquier cosa con un payload de tipo `_struct`. Consulta [`StructLike`](/es-ES/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## StringStruct

Struct de cadena, de `struct.string`.

## NumberStruct

Struct de número, de `struct.number`.

## UnknownStruct

Struct unknown, de `struct.unknown`.

## ObjectStruct

Struct con forma de objeto, de `struct.object`.

## ArrayStruct

Struct de array, de `struct.array`.

## RecordStruct

Struct de registro, de `struct.record`.

## TupleStruct

Struct de tupla, de `struct.tuple`.

## UnionStruct

Struct de unión, de `struct.or`.

## DiscriminatedUnionStruct

Struct de unión discriminada, de `struct.discriminatedUnion`.

## IntersectionStruct

Struct de intersección, de `struct.intersection`.

## PreservedStruct

El struct que devuelve un modificador como `.optional()` o `.nullable()` sobre un struct compuesto; conserva el tipo del compuesto.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` es `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` o `missing_key`.

## FormattedStructError

Árbol anidado `{ _errors, [key]: … }` de `StructError.format()`.

## FlattenedStructError

`formErrors` más `fieldErrors` de `StructError.flatten()`.
