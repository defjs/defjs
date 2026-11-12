---
title: Struct
description: struct-Facade, Infer und StructError.
---

# Struct

Baue Formen für die Wire-Grenze, parse Werte und inferiere TypeScript-Typen.

## struct

Fassade. Bevorzuge sie gegenüber den internen Konstruktoren.

<include cwd lang="typescript">
  examples/api/struct.ts#example
</include>

### Primitive und Container

| Helfer                                                                      | Rolle                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `struct.string()` / `number()` / `boolean()` / `bigint()`                   | Skalare                                                                                      |
| `struct.literal(value)`                                                     | Exaktes Literal                                                                              |
| `struct.null()` / `any()` / `unknown()`                                     | Null / any / unknown. `any()` und `unknown()` lehnen `null` und `undefined` ab               |
| `struct.date()`                                                             | `Date`                                                                                       |
| `struct.array(item)` / `tuple(items)` / `record(value)`                     | Sammlungen. `tuple` nimmt ein Array: `struct.tuple([a, b])`                                  |
| `struct.object(shape)`                                                      | Objekt; Felder akzeptieren `.optional()`, `.null()` / `.nullable()`, `.alias(name)`          |
| `struct.or(...)` / `intersection(...)` / `discriminatedUnion(tag, options)` | Unions                                                                                       |
| `struct.enum(values)`                                                       | String-Liste oder `{ Name: value }`-Map; die Map akzeptiert ihre Werte, nicht ihre Schlüssel |

### Body-Codecs und Binärwerte

| Helfer                                         | Rolle                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `struct.formData(shape)` / `urlencoded(shape)` | Objekt-Struct plus Codec-Tag. Der Tag gilt nur, wenn dieser Wert die Wurzel des Request-Bodys ist                                                                                                      |
| `struct.arrayBuffer()` / `blob()` / `file()`   | Binärwerte. Als Wurzel des Bodys werden sie als Bytes gesendet; als `output` / `error` wählen sie diese Repräsentation                                                                                 |
| `struct.string()`                              | Text. Als HTTP- oder SSE-Body-Root oder als HTTP-/SSE-Inbound bleiben die Bytes Text. Ein eingehender WebSocket-Frame wird zuerst als JSON geparst, daher erwartet ein String-Struct einen JSON-String |

### struct.parse()

<ApiSignature name="struct.parse" />

- **Returns** `[null, value]` oder `[StructError, undefined]`. Der Fehler trägt ein Issue. Objektfelder brechen beim ersten fehlerhaften Feld ab. `struct.or` versucht jeden Zweig und meldet dann `invalid_union`; den Fehler des ersten Zweigs behält es nicht.
- Objektfelder sind erforderlich, sofern sie nicht mit `.optional()` oder `.nullish()` markiert sind. Schlüssel, die die Form nicht deklariert, fallen aus dem Ergebnis.
- Optionales `options.errorMap` überschreibt Issue-Meldungen nur für diesen Parse-Vorgang.
- Standardmäßig liest das Parsen **logische** Schlüssel (`customerName`). Gib `{ aliases: true }`, um Wire-Schlüssel (`customer_name`) zu lesen, so wie HTTP-/JSON-Codecs es tun.

## ErrorMap

<ApiSignature name="ErrorMap" />

## Typen

### Infer

### StructInput

### AnyStruct

### ParseResult

<ApiSignature name="Infer, StructInput, AnyStruct, ParseResult" />

### StructError

<ApiSignature name="StructError" />

`StructIssue`: `path`, `code`, `expected`, `received`, `message`. `code` ist `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` oder `missing_key`.

Siehe [Struct-Leitfaden](/de-DE/docs/struct).

## STRUCT

Ein `unique symbol`, das die aus der Eingabe einer Operation geparsten Objekte markiert. Er ist intern für den Outbound-Encoder und wird nur als Typ exportiert. Weder lesen noch setzen.

## Struct

Parsebare Form: Input-/Output-Typen plus `.optional()`, `.null()` / `.nullable()`, `.nullish()`, `.alias()`.

## StructLike

Alles mit einem `_struct`-Typ-Payload. Siehe [`StructLike`](/de-DE/api/core/structlike-type).

## StructMethods

`.alias()`, `.null()` / `.nullable()`, `.nullish()`, `.optional()`.

## ObjectStruct

Objektförmiges Struct von `struct.object`.

## ArrayStruct

Array-Struct von `struct.array`.

## RecordStruct

Record-Struct von `struct.record`.

## TupleStruct

Tuple-Struct von `struct.tuple`.

## UnionStruct

Union-Struct von `struct.or`.

## DiscriminatedUnionStruct

Struct für diskriminierte Unions von `struct.discriminatedUnion`.

## IntersectionStruct

Intersection-Struct von `struct.intersection`.

## PreservedStruct

Das Struct, das ein Modifikator wie `.optional()` oder `.nullable()` für ein zusammengesetztes Struct zurückgibt; es behält den Typ des zusammengesetzten Structs.

## StructIssue

`path`, `code`, `expected`, `received`, `message`. `code` ist `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union` oder `missing_key`.

## FormattedStructError

Verschachtelter `{ _errors, [key]: … }`-Baum von `StructError.format()`.

## FlattenedStructError

`formErrors` plus `fieldErrors` von `StructError.flatten()`.
