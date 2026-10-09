---
title: Struct
description: Modela formas de solicitud y respuesta, parsea unknowns y codifica cuerpos de cable.
---

# Struct

Modela una solicitud (y sus respuestas) como Structs. Obtienes tipos TypeScript vía `Infer`, y comprobaciones en runtime vía `struct.parse(...)` — sin throw, tupla error-first.

## Basic Setup

```typescript twoslash
import { defineRequest, struct, type Infer } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  active: struct.boolean(),
})

type User = Infer<typeof User>

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({
    name: struct.string(),
    email: struct.string(),
  }),
  builder: (input) => ({ body: input }),
  output: User,
})

const [parseError, user] = struct.parse(User, { id: 7, name: 'Ada', active: true })
if (!parseError) console.log(user.name)
void createUser
```

La salida parseada conserva solo los campos declarados. Campos requeridos ausentes, primitivos incorrectos, valores anidados malos, longitud de tupla incorrecta o `null` no permitido → `StructError`, sin valor parcial. Los Structs son inmutables; `.optional()` y compañía devuelven un Struct nuevo.

## Requerido, opcional, null

Presencia y nulabilidad son cosas distintas:

| Declaración                  | Ausente / `undefined`                   | `null`   | Valor válido           |
| ---------------------------- | --------------------------------------- | -------- | ---------------------- |
| `struct.string()`            | Rechazar                                | Rechazar | Aceptar string         |
| `struct.string().optional()` | Aceptar; omitir campo de objeto ausente | Rechazar | Aceptar string         |
| `struct.string().null()`     | Rechazar                                | Aceptar  | Aceptar string         |
| `struct.string().nullish()`  | Aceptar; omitir campo de objeto ausente | Aceptar  | Aceptar string         |
| `struct.null()`              | Rechazar                                | Aceptar  | Rechazar otros valores |

```typescript twoslash
import { struct } from '@defjs/core'

const Profile = struct.object({
  name: struct.string(),
  nickname: struct.string().optional(),
  biography: struct.string().null(),
  note: struct.string().nullish(),
})

const [error, profile] = struct.parse(Profile, {
  name: 'Ada',
  biography: null,
  note: undefined,
})
if (error) throw error
console.log(profile.name, profile.nickname, profile.biography, profile.note)
```

En la raíz, optional puede ser `undefined`. Dentro de un objeto, los campos optional/nullish omitidos se quedan ausentes. Un input con forma de solicitud usa campos ordinarios llamados `path`, `query`, `headers` y `body`. Marca uno con `.optional()` cuando quien llama pueda omitirlo. Un campo `body` requerido se queda requerido aunque todos los campos de dentro sean opcionales.

## Colocación de la solicitud

Path, query, headers y body son campos que devuelve el builder, no un struct de request. Omite `builder` cuando `input` ya tiene esa forma. `struct.urlencoded(shape)` y `struct.formData(shape)` son structs de objeto con un tag de códec. El tag solo corre cuando ese valor es la raíz del body: las claves usan alias y los arrays repiten el nombre del campo.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createUser = defineRequest({
  method: 'POST',
  path: '/organizations/:organizationId/users',
  input: struct.object({
    path: struct.object({ organizationId: struct.string() }),
    query: struct.object({ notify: struct.boolean().optional() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
})

const command = createUser({
  path: { organizationId: 'acme' },
  query: { notify: true },
  headers: { requestId: 'request-42' },
  body: { displayName: 'Ada' },
})
void command
```

| Raíz del body                                 | Se envía como     | Content type por defecto                          |
| --------------------------------------------- | ----------------- | ------------------------------------------------- |
| objeto tipado, array, number, boolean, `null` | texto JSON        | `application/json`                                |
| struct `string` o un string en bruto          | texto             | `text/plain;charset=UTF-8`                        |
| `struct.urlencoded(shape)` en la raíz         | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `struct.formData(shape)` en la raíz           | `FormData`        | boundary multipart de la plataforma               |
| `Blob` / `File`                               | el blob           | tipo del blob o `application/octet-stream`        |
| `ArrayBuffer` / view / stream                 | bytes             | `application/octet-stream`                        |

`struct.file()` es un struct de valor para un campo de formulario y para un body de archivo en bruto. Los builders de WebSocket no pueden devolver `headers` ni `body`. HTTP y SSE sí. `GET` y `HEAD` no pueden.

## Alias

`.alias(...)` separa nombres lógicos de nombres de cable. `struct.parse(...)` usa claves lógicas. Los códecs JSON y de solicitud plana codifican alias; la decodificación de respuesta JSON mapea claves de cable de vuelta a campos lógicos.

```typescript twoslash
import { struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
})

const [parseError, user] = struct.parse(User, { displayName: 'Ada' })
if (parseError) throw parseError
console.log(user.displayName)

const [wireError] = struct.parse(User, { display_name: 'Ada' })
console.log(wireError?.issues[0]?.path)
```

| Límite                                             | Campo                        |
| -------------------------------------------------- | ---------------------------- |
| `struct.parse(User, ...)` y la entrada del comando | Lógico `displayName`         |
| Objeto tipado entregado al builder                 | Cable `display_name`         |
| Decodificación JSON / SSE / WebSocket              | Cable → lógico `displayName` |
| Objeto anónimo escrito en el builder               | La clave que escribiste      |

Los alias funcionan en campos anidados, arrays, objects, unions y discriminadores. Mantén los nombres lógicos en el código de la app; pon el nombre externo en el struct una sola vez. Hacer spread de un objeto tipado conserva esa codificación. Fijar a la vez el campo lógico y su clave de cable en el mismo objeto es `REQ_BUILD_FAILED`. Si haces `JSON.stringify` de un valor tú mismo, sales de este camino: el serializador ve nombres lógicos.

La guía se elige en cada nodo, no solo en la raíz. Un objeto nuevo bajo un padre anónimo conserva las claves que escribiste. El mismo objeto bajo un padre tipado usa el struct de ese campo.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

Cuando una guía union coincide con más de una rama, cada rama se codifica y se compara. Una salida de cable idéntica se conserva; una diferencia es `REQ_BUILD_FAILED`.

Una intersección mixta que contiene una parte que no es un objeto queda etiquetada, al parsearla, con la conjunción de las etiquetas de las partes que coinciden; un valor de intersección mixta recién escrito y no parseado se trata como un objeto anónimo.

## Fallos de parse

`struct.parse(...)` devuelve `[null, value]` o `[StructError, undefined]`. `StructError` extiende `Error` y expone `issues`, más `format()`, `flatten()` y `prettify()`.

```typescript twoslash
import { struct, StructError } from '@defjs/core'

const User = struct.object({ id: struct.number(), name: struct.string() })
const [error, value] = struct.parse(User, { id: 'not-a-number' })

if (error) {
  console.log(error instanceof StructError)
  console.log(error.issues[0]?.code, error.issues[0]?.path)
  console.log(error.flatten().fieldErrors)
  console.log(error.format(), error.prettify())
}
void value
```

Un `StructIssue` tiene `code`, `expected`, `message`, `path` y `received`. `code` es `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` o `missing_key`. Los issues pueden guardar entrada no confiable — redacta antes de registrar o devolver. `struct.parse(..., { errorMap })` reescribe los mensajes de issue solo para esa llamada.

La validación Struct es solo estructural. No hay reglas públicas de rango, formato, refinement, auth o transición de estado. Haz esas comprobaciones antes de construir un comando.

## Reference

Constructores públicos en `@defjs/core` (los internos no son APIs de fachada):

```typescript twoslash
import { struct } from '@defjs/core'

const Any = struct.any()
const ArrayOfStrings = struct.array(struct.string())
const Bytes = struct.arrayBuffer()
const BigIntValue = struct.bigint()
const BlobValue = struct.blob()
const BooleanValue = struct.boolean()
const DateValue = struct.date()
const Discriminated = struct.discriminatedUnion('kind', [
  struct.object({ kind: struct.literal('created'), id: struct.number() }),
  struct.object({ kind: struct.literal('deleted'), id: struct.number() }),
])
const Status = struct.enum(['draft', 'published'])
const FileValue = struct.file()
const Form = struct.formData({ file: struct.file() })
const Combined = struct.intersection(struct.object({ id: struct.number() }), struct.object({ name: struct.string() }))
const Literal = struct.literal('ready')
const NullValue = struct.null()
const NumberValue = struct.number()
const ObjectValue = struct.object({ id: struct.number() })
const Union = struct.or(struct.string(), struct.number())
const RecordValue = struct.record(struct.number())
const StringValue = struct.string()
const Tuple = struct.tuple([struct.string(), struct.number()])
const Unknown = struct.unknown()
const FormUrlEncoded = struct.urlencoded({ name: struct.string() })

void [Any, ArrayOfStrings, Bytes, BigIntValue, BlobValue, BooleanValue, DateValue, Discriminated, Status, FileValue, Form, Combined]
void [Literal, NullValue, NumberValue, ObjectValue, Union, RecordValue, StringValue, Tuple, Unknown, FormUrlEncoded]
```

| Constructor                      | Entrada                                                        | Salida inferida                  |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------- |
| `struct.number()`                | Número distinto de `NaN`                                       | `number`, incluyendo ±`Infinity` |
| `struct.date()`                  | `Date`, number o string de fecha                               | `Date` válido                    |
| `struct.bigint()`                | `bigint` o string aceptado por `BigInt(...)`                   | `bigint`                         |
| `struct.enum(...)`               | Miembro string o number declarado                              | Esa unión literal                |
| `struct.discriminatedUnion(...)` | Objeto con discriminador literal requerido                     | Rama de objeto seleccionada      |
| `struct.or(...)`                 | Primera rama coincidente; la codificación comprueba ambigüedad | Unión de salidas de rama         |
| `struct.intersection(...)`       | Valores aceptados por cada miembro                             | Intersección de salidas          |
| `struct.record(value)`           | Objeto plano cuyos valores coinciden con `value`               | Record de valores parseados      |
| `struct.tuple(items)`            | Array de exactamente la longitud declarada                     | Tupla de longitud fija           |

Cada Struct soporta `.alias(name)`, `.optional()`, `.null()` y `.nullish()`. `struct.discriminatedUnion` necesita opciones de objeto con un discriminador literal requerido y rechaza duplicados.

Importa `struct`, `Infer`, `Struct`, `StructError` y tipos públicos relacionados desde `@defjs/core`. Usa `struct.parse(...)` como parser. No importes `createObjectStruct`, símbolos de definición, internos de codec ni `packages/core/src`.

No-promesas de la fachada:

- Las salidas object/record usan un prototipo null — no asumas métodos de `Object.prototype`.
- Las claves de objeto desconocidas se descartan.
- `struct.number()` rechaza `NaN`, acepta infinitos.
- `struct.or(...)` prueba ramas en orden; rechaza codificaciones ambiguas cuando las ramas discrepan.
- `struct.intersection(...)` parsea miembros en orden de declaración.
- Una intersection fusiona en profundidad las salidas de los miembros (los valores iguales por `Object.is` y las dates con el mismo instante se quedan, los plain objects y los arrays de igual longitud se fusionan de forma recursiva, cualquier otro choque es `invalid_intersection` en ese path), `unknown` / `any` no aportan nada, y una clave lógica puede corresponder a varias wire keys; solo hay conflicto cuando se escriben valores desiguales en la misma wire key.
- Un Struct valida un límite; no cachea, no autoriza ni es dueño de un recurso de transporte.

## Recetas relacionadas

- [POST JSON](../recipes/post-json.md)
- [GET con un 404 declarado](../recipes/get-declared-404.md)
