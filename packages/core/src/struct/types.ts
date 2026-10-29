import type { StructError } from "./errors";
import type { ResolvedStructField } from "./fields";
import type { DEFINITION, FAILED } from "./symbols";

export type Path = Array<number | string>;
export type ParseMode = "field" | "value";

/**
 * Error-first tuple returned by `struct.parse`.
 *
 * On success the error is `null` and `value` is the parsed output `O`. On failure the error is a `StructError` and `value` is always `undefined`.
 *
 * @group struct
 */
export type ParseResult<O> =
  [error: null, value: O] | [error: StructError, value: undefined];
export type LiteralValue = boolean | null | number | string;

export interface StructTypes<
  Input = unknown,
  Output = unknown,
  OptionalOut extends boolean = false,
> {
  input: Input;
  optionalOut: OptionalOut extends true ? true : undefined;
  output: Output;
}

/**
 * Minimal structural brand carried by every struct instance.
 *
 * Anything with a `_struct` type payload. `_struct` holds input and output phantom types: {@link StructInput} and {@link Infer} read `input` and `output` from it, and object structs use `optionalOut` to decide which output fields may be absent.
 *
 * `_struct` exists only in the type system. Structs have no `_struct` property at runtime, and a plain object with that type is not a valid struct. `input` and `output` are the phantom types. `optionalOut` is `true` when the third type argument is `true`, and `undefined` otherwise.
 *
 * @group struct
 */
export interface StructLike<
  I = unknown,
  O = unknown,
  OO extends boolean = boolean,
> {
  /** Phantom payload. `optionalOut` is `true` only when this struct's output fields may be absent. */
  readonly _struct: StructTypes<I, O, OO>;
}

export type AnyStructLike = StructLike<unknown, unknown, boolean>;

export type OptionalOutputStruct = {
  readonly _struct: {
    readonly optionalOut: true;
  };
};

/**
 * A single validation failure produced while parsing a struct.
 *
 * - `code` is the machine-readable category. The parser produces `invalid_type`, `invalid_literal`, `invalid_enum`, `invalid_union`, `invalid_intersection`, and `missing_key`; `custom` is part of the type, but the built-in structs never produce it.
 *
 * - `expected` describes the expected type or value.
 *
 * - `message` is the final text, after an optional {@link ErrorMap} rewrite.
 *
 * - `path` runs from the parse root to the failing location: field names and array indices. It is empty for a root-level failure.
 *
 * - `received` is the value that failed at `path`.
 *
 * @group struct
 */
export interface StructIssue {
  /** Machine-readable failure category. */
  code:
    | "custom"
    | "invalid_enum"
    | "invalid_intersection"
    | "invalid_literal"
    | "invalid_type"
    | "invalid_union"
    | "missing_key";
  /** Human-readable description of the expected type or value. */
  expected: string;
  /** Final message after optional `ErrorMap` rewriting. The default names the received kind, not the value. */
  message: string;
  /** Path from the parse root to the failing location. */
  path: Path;
  /** Value that failed validation at `path`. */
  received: unknown;
}

/**
 * Nested error tree returned by `StructError.format()`.
 *
 * Leaf messages live under `_errors`; nested keys mirror the failing path. A path segment literally named `_errors` is stored as `\_errors`.
 *
 * @group struct
 */
export interface FormattedStructError {
  _errors: string[];
  [key: string]: FormattedStructError | string[];
}

/**
 * Flat field and form error bags returned by `StructError.flatten()`.
 *
 * `formErrors` holds messages of issues with an empty path (root-level issues). `fieldErrors` holds messages keyed by the first path segment, so nested issues are grouped under their top-level field.
 *
 * @group struct
 */
export interface FlattenedStructError {
  /** Messages whose path is empty (root-level issues). */
  formErrors: string[];
  /** Messages keyed by the first path segment. */
  fieldErrors: { [key: string]: string[] };
}

/**
 * Chainable modifiers available on every `Struct` instance.
 *
 * Each method returns a new struct and leaves the original unchanged.
 *
 * - `alias(name)` sets the wire name of an object field. `struct.parse` reads logical names unless `aliases: true` is passed; JSON and flat request codecs write the alias. A non-string `name` throws `TypeError`.
 *
 * - `null()` and `nullable()` are the same: they also accept `null`.
 *
 * - `optional()` also accepts `undefined`. In an object, the key may be missing, and an absent field stays absent in the output.
 *
 * - `nullish()` accepts both `null` and `undefined`.
 *
 * @group struct
 */
export interface StructMethods<I, O, OO extends boolean> {
  /**
   * Override the external wire name for this field without changing the TypeScript property name.
   *
   * @param name - Wire / protocol field name.
   * @returns The same struct branded with the alias.
   */
  alias(name: string): this;
  /**
   * Allow `null` in addition to the current input and output types.
   *
   * @returns A struct that accepts and emits `null`.
   */
  null(): Struct<I | null, O | null, OO>;
  /**
   * Alias for {@link StructMethods.null}.
   *
   * @returns A struct that accepts and emits `null`.
   */
  nullable(): Struct<I | null, O | null, OO>;
  /**
   * Allow `null` or `undefined`, marking the field optional in object output.
   *
   * @returns A struct that accepts `null`/`undefined` and treats the field as optional.
   */
  nullish(): Struct<I | null | undefined, O | null | undefined, true>;
  /**
   * Allow `undefined`, marking the field optional in object shapes.
   *
   * @returns A struct that accepts `undefined` and treats the field as optional.
   */
  optional(): Struct<I | undefined, O | undefined, true>;
}

/**
 * Public struct contract: input and output types, modifier methods, and the `_struct` type brand.
 *
 * A parseable shape. `Input` is what it accepts ({@link StructInput}), `Output` is what a successful parse returns ({@link Infer}), and `OptionalOut` marks a field that may be absent from object output.
 *
 * Build structs with the {@link struct} facade (`struct.string()`, `struct.object()`, …). Every modifier in {@link StructMethods} returns a new struct and leaves the original unchanged.
 *
 * @group struct
 */
export type Struct<
  Input = unknown,
  Output = Input,
  OptionalOut extends boolean = false,
> = StructMethods<Input, Output, OptionalOut> &
  StructLike<Input, Output, OptionalOut>;

export type PresentValue = NonNullable<unknown>;

declare const carriedStruct: unique symbol;

/** Keeps the struct that a nullish modifier wrapped, so builders still see its fields. */
export type CarriedStruct<T> = { readonly [carriedStruct]: T };

declare const unionStructOptions: unique symbol;
declare const intersectionStructOptions: unique symbol;
declare const discriminatedUnionOptions: unique symbol;

// A later modifier must keep the struct the first one carried, or builders fall back to Infer.
interface PreservedStruct<T, I, O, OO extends boolean>
  extends Struct<I, O, OO>, CarriedStruct<T> {
  null(): PreservedStruct<T, I | null, O | null, OO>;
  nullable(): PreservedStruct<T, I | null, O | null, OO>;
  nullish(): PreservedStruct<
    T,
    I | null | undefined,
    O | null | undefined,
    true
  >;
  optional(): PreservedStruct<T, I | undefined, O | undefined, true>;
}

/**
 * Broad struct constraint that accepts any struct, for endpoint and client generics.
 *
 * Used by generics such as `defineRequest`, `Fault`, and `HttpCommand`. Prefer a concrete `Struct<…>` when you need precise input and output inference.
 *
 * @group struct
 */
// Type boundary: AnyStruct is the broad constraint used by endpoint generics. The concrete struct.any()
// return type excludes nullish input until a modifier explicitly adds it.
// oxlint-disable-next-line typescript/no-explicit-any
export type AnyStruct = Struct<any, any, boolean>;

/**
 * Type helper that extracts the accepted input type of a struct.
 *
 * The type a struct accepts, as opposed to {@link Infer}, which is what a successful parse returns. `T` is a struct, or any {@link StructLike}. Anything else gives `never`.
 *
 * The two differ when a struct converts its input:
 *
 * ```ts
 * const Created = struct.date();
 *
 * type In = StructInput<typeof Created>; // Date | number | string
 * type Out = Infer<typeof Created>; // Date
 * ```
 *
 * @typeParam T - A struct-like value with a `_struct.input` brand.
 * @group struct
 */
export type StructInput<T> = T extends {
  readonly _struct: { readonly input: unknown };
}
  ? T["_struct"]["input"]
  : never;
type StructOutput<T> = T extends {
  readonly _struct: { readonly output: unknown };
}
  ? T["_struct"]["output"]
  : never;

/**
 * Infers the parsed output type of a struct, as an alias of the internal output brand.
 *
 * The type a successful parse produces. Use `Infer<typeof User>` for the decoded value of a struct, and `StructInput` for the accepted input type. A type that is not a struct yields `never`.
 *
 * ```ts
 * const User = struct.object({ id: struct.number(), name: struct.string() });
 * type User = Infer<typeof User>; // { id: number; name: string }
 * ```
 *
 * @typeParam T - A struct-like value with a `_struct.output` brand.
 * @group struct
 */
export type Infer<T> = StructOutput<T>;

// Type boundary: FieldOutput inspects the generic struct surface; `unknown` lets the
// conditional type match any StructLike without over-constraining callers.
export type FieldOutput<S> =
  S extends StructLike<unknown, unknown, boolean>
    ? S extends OptionalOutputStruct
      ? Exclude<S["_struct"]["output"], undefined>
      : S["_struct"]["output"]
    : never;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

// Type boundary: ObjectShape accepts any field struct type; `any` is the only way to express "a record whose
// values are arbitrary struct instances" before the caller provides a concrete shape.
// oxlint-disable-next-line typescript/no-explicit-any
export type ObjectShape = { [key: string]: any };

export type ObjectInput<T extends ObjectShape> = Simplify<
  {
    -readonly [
      K in keyof T as true extends T[K]["_struct"]["optionalOut"] ? never : K
    ]: T[K]["_struct"]["input"];
  } & {
    -readonly [
      K in keyof T as true extends T[K]["_struct"]["optionalOut"] ? K : never
    ]?: Exclude<T[K]["_struct"]["input"], undefined>;
  }
>;

export type ObjectOutput<T extends ObjectShape> = Simplify<
  {
    -readonly [
      K in keyof T as true extends T[K]["_struct"]["optionalOut"] ? never : K
    ]: FieldOutput<T[K]>;
  } & {
    -readonly [
      K in keyof T as true extends T[K]["_struct"]["optionalOut"] ? K : never
    ]?: FieldOutput<T[K]>;
  }
>;

export type TupleInput<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = {
  -readonly [K in keyof T]: StructInput<T[K]>;
};

export type TupleOutput<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = {
  -readonly [K in keyof T]: StructOutput<T[K]>;
};

export type UnionOutput<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = Exclude<StructOutput<T[number]>, undefined>;

export type UnionInput<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = Exclude<StructInput<T[number]>, undefined>;

type IntersectionInputValue<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = T extends readonly [
  infer Head extends StructLike<unknown, unknown, boolean>,
  ...infer Tail extends StructLike<unknown, unknown, boolean>[],
]
  ? StructInput<Head> & IntersectionInputValue<Tail>
  : unknown;

export type IntersectionInput<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = Exclude<IntersectionInputValue<T>, undefined>;

type IntersectionOutputValue<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = T extends readonly [
  infer Head extends StructLike<unknown, unknown, boolean>,
  ...infer Tail extends StructLike<unknown, unknown, boolean>[],
]
  ? StructOutput<Head> & IntersectionOutputValue<Tail>
  : unknown;

export type IntersectionOutput<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = Exclude<IntersectionOutputValue<T>, undefined>;

export type StringStruct = Struct<string, string>;

export type NumberStruct = Struct<number, number>;

export type UnknownStruct = Struct<PresentValue, unknown>;

// Type boundary: ArrayInput/Output work with any element struct; `unknown` is the generic placeholder.
export type ArrayInput<S extends StructLike<unknown, unknown, boolean>> =
  StructInput<S>[];
export type ArrayOutput<S extends StructLike<unknown, unknown, boolean>> =
  StructOutput<S>[];

// Type boundary: ArrayStructTypes generalises over any element struct.
export interface ArrayStructTypes<
  S extends StructLike<unknown, unknown, boolean>,
> extends StructTypes<ArrayInput<S>, ArrayOutput<S>, false> {
  input: ArrayInput<S>;
  optionalOut: undefined;
  output: ArrayOutput<S>;
}

// Type boundary: ArrayStruct generalises over any element struct.
export interface ArrayStruct<S extends StructLike<unknown, unknown, boolean>>
  extends
    StructMethods<ArrayInput<S>, ArrayOutput<S>, false>,
    StructLike<ArrayInput<S>, ArrayOutput<S>, false> {
  readonly _struct: ArrayStructTypes<S>;
  null(): PreservedStruct<
    ArrayStruct<S>,
    ArrayInput<S> | null,
    ArrayOutput<S> | null,
    false
  >;
  nullable(): PreservedStruct<
    ArrayStruct<S>,
    ArrayInput<S> | null,
    ArrayOutput<S> | null,
    false
  >;
  nullish(): PreservedStruct<
    ArrayStruct<S>,
    ArrayInput<S> | null | undefined,
    ArrayOutput<S> | null | undefined,
    true
  >;
  optional(): PreservedStruct<
    ArrayStruct<S>,
    ArrayInput<S> | undefined,
    ArrayOutput<S> | undefined,
    true
  >;
}

export interface ObjectStructTypes<T extends ObjectShape> extends StructTypes<
  ObjectInput<T>,
  ObjectOutput<T>,
  false
> {
  input: ObjectInput<T>;
  optionalOut: undefined;
  output: ObjectOutput<T>;
}

/**
 * Object-shaped struct type produced by `struct.object(shape)`.
 *
 * Fields are required by default. A field marked `optional()` or `nullish()` becomes an optional key, so field presence follows those modifiers. Unknown keys are stripped when parsing. Wire names can differ from TypeScript keys via `.alias()`. A failed parse returns `[StructError, undefined]`. `ObjectInput`, `ObjectOutput`, `ObjectStructTypes`, and `PreservedStruct` are internal helper types.
 *
 * @group struct
 */
export interface ObjectStruct<T extends ObjectShape>
  extends
    StructMethods<ObjectInput<T>, ObjectOutput<T>, false>,
    StructLike<ObjectInput<T>, ObjectOutput<T>, false> {
  readonly _struct: ObjectStructTypes<T>;
  null(): PreservedStruct<
    ObjectStruct<T>,
    ObjectInput<T> | null,
    ObjectOutput<T> | null,
    false
  >;
  nullable(): PreservedStruct<
    ObjectStruct<T>,
    ObjectInput<T> | null,
    ObjectOutput<T> | null,
    false
  >;
  nullish(): PreservedStruct<
    ObjectStruct<T>,
    ObjectInput<T> | null | undefined,
    ObjectOutput<T> | null | undefined,
    true
  >;
  optional(): PreservedStruct<
    ObjectStruct<T>,
    ObjectInput<T> | undefined,
    ObjectOutput<T> | undefined,
    true
  >;
}

declare const recordValueStruct: unique symbol;
declare const tupleItemStructs: unique symbol;

type RecordInput<S extends StructLike<unknown, unknown, boolean>> = {
  [key: string]: StructInput<S>;
};
type RecordOutput<S extends StructLike<unknown, unknown, boolean>> = {
  [key: string]: FieldOutput<S>;
};

/**
 * Value struct carried by `struct.record`.
 * Tagged parsing stores this struct on the record object itself. `null` and `undefined` are not tagged.
 */
export interface RecordStruct<
  S extends StructLike<unknown, unknown, boolean>,
> extends Struct<RecordInput<S>, RecordOutput<S>> {
  readonly [recordValueStruct]: S;
  null(): PreservedStruct<
    RecordStruct<S>,
    RecordInput<S> | null,
    RecordOutput<S> | null,
    false
  >;
  nullable(): PreservedStruct<
    RecordStruct<S>,
    RecordInput<S> | null,
    RecordOutput<S> | null,
    false
  >;
  nullish(): PreservedStruct<
    RecordStruct<S>,
    RecordInput<S> | null | undefined,
    RecordOutput<S> | null | undefined,
    true
  >;
  optional(): PreservedStruct<
    RecordStruct<S>,
    RecordInput<S> | undefined,
    RecordOutput<S> | undefined,
    true
  >;
}

/** Item structs carried by `struct.tuple`, so builders tag each position. The tuple itself is not tagged. */
export interface TupleStruct<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> extends Struct<TupleInput<T>, TupleOutput<T>> {
  readonly [tupleItemStructs]: T;
  null(): PreservedStruct<
    TupleStruct<T>,
    TupleInput<T> | null,
    TupleOutput<T> | null,
    false
  >;
  nullable(): PreservedStruct<
    TupleStruct<T>,
    TupleInput<T> | null,
    TupleOutput<T> | null,
    false
  >;
  nullish(): PreservedStruct<
    TupleStruct<T>,
    TupleInput<T> | null | undefined,
    TupleOutput<T> | null | undefined,
    true
  >;
  optional(): PreservedStruct<
    TupleStruct<T>,
    TupleInput<T> | undefined,
    TupleOutput<T> | undefined,
    true
  >;
}

export interface UnionStruct<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> extends Struct<UnionInput<T>, UnionOutput<T>> {
  readonly [unionStructOptions]: T;
  null(): PreservedStruct<
    UnionStruct<T>,
    UnionInput<T> | null,
    UnionOutput<T> | null,
    false
  >;
  nullable(): PreservedStruct<
    UnionStruct<T>,
    UnionInput<T> | null,
    UnionOutput<T> | null,
    false
  >;
  nullish(): PreservedStruct<
    UnionStruct<T>,
    UnionInput<T> | null | undefined,
    UnionOutput<T> | null | undefined,
    true
  >;
  optional(): PreservedStruct<
    UnionStruct<T>,
    UnionInput<T> | undefined,
    UnionOutput<T> | undefined,
    true
  >;
}

export interface DiscriminatedUnionStruct<
  TOptions extends readonly ObjectStruct<ObjectShape>[],
> extends Struct<
  StructInput<TOptions[number]>,
  StructOutput<TOptions[number]>
> {
  readonly [discriminatedUnionOptions]: TOptions;
  null(): PreservedStruct<
    DiscriminatedUnionStruct<TOptions>,
    StructInput<TOptions[number]> | null,
    StructOutput<TOptions[number]> | null,
    false
  >;
  nullable(): PreservedStruct<
    DiscriminatedUnionStruct<TOptions>,
    StructInput<TOptions[number]> | null,
    StructOutput<TOptions[number]> | null,
    false
  >;
  nullish(): PreservedStruct<
    DiscriminatedUnionStruct<TOptions>,
    StructInput<TOptions[number]> | null | undefined,
    StructOutput<TOptions[number]> | null | undefined,
    true
  >;
  optional(): PreservedStruct<
    DiscriminatedUnionStruct<TOptions>,
    StructInput<TOptions[number]> | undefined,
    StructOutput<TOptions[number]> | undefined,
    true
  >;
}

export interface IntersectionStruct<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> extends Struct<IntersectionInput<T>, IntersectionOutput<T>> {
  readonly [intersectionStructOptions]: T;
  null(): PreservedStruct<
    IntersectionStruct<T>,
    IntersectionInput<T> | null,
    IntersectionOutput<T> | null,
    false
  >;
  nullable(): PreservedStruct<
    IntersectionStruct<T>,
    IntersectionInput<T> | null,
    IntersectionOutput<T> | null,
    false
  >;
  nullish(): PreservedStruct<
    IntersectionStruct<T>,
    IntersectionInput<T> | null | undefined,
    IntersectionOutput<T> | null | undefined,
    true
  >;
  optional(): PreservedStruct<
    IntersectionStruct<T>,
    IntersectionInput<T> | undefined,
    IntersectionOutput<T> | undefined,
    true
  >;
}

export type StructFlags = {
  nullable: boolean;
  optional: boolean;
};

export type BaseDefinition = {
  alias?: string;
  flags: StructFlags;
};

export type PrimitiveKind =
  | "arrayBuffer"
  | "bigint"
  | "blob"
  | "boolean"
  | "date"
  | "file"
  | "null"
  | "number"
  | "string";

/**
 * What a decode hook returns for a value it rejects.
 *
 * The parser passes its own `failure`. That function parks the issue and applies the error map of the parse in
 * progress, including when the hook was built by another copy of this package.
 */
export type DecodeFailure = (issue: StructIssue) => typeof FAILED;

export type PrimitiveDefinition<
  K extends PrimitiveKind,
  TInput,
  TOutput = TInput,
> = BaseDefinition & {
  /**
   * Returns the decoded value, or what `fail` returns for a value it rejects. `path` is a copy the hook may keep or change.
   * `fail` comes from the parser, not from the module that defined the hook, so a struct built by another copy of this
   * package reports its failures to the copy that is parsing. That same `fail` applies the parsing copy's error map.
   */
  decode?: (
    value: TInput,
    path: Path,
    fail: DecodeFailure,
  ) => TOutput | typeof FAILED;
  encode?: (value: TOutput) => unknown;
  expected: string;
  is: (value: unknown) => value is TInput;
  kind: K;
  runtimeIs?: (value: unknown) => boolean;
};

export type AnyDefinition = BaseDefinition & {
  kind: "any";
};

export type UnknownDefinition = BaseDefinition & {
  kind: "unknown";
};

export type LiteralDefinition<T extends LiteralValue> = BaseDefinition & {
  expected: string;
  kind: "literal";
  value: T;
};

export type EnumDefinition<T extends number | string> = BaseDefinition & {
  expected: string;
  kind: "enum";
  values: readonly [T, ...T[]];
  valueSet?: ReadonlySet<T> | null;
};

export type ArrayDefinition = BaseDefinition & {
  kind: "array";
  item: StructLike<unknown, unknown, boolean>;
};

export type ObjectDefinitionCache = {
  declaredDescriptors: PropertyDescriptorMap;
  fields?: readonly ResolvedStructField[];
  resolvedShape?: ObjectShape;
};

export type ObjectDefinition = BaseDefinition & {
  readonly cache: ObjectDefinitionCache;
  codec?: "formData" | "urlencoded";
  kind: "object";
  shape: ObjectShape;
};

export type RecordDefinition = BaseDefinition & {
  kind: "record";
  value: StructLike<unknown, unknown, boolean>;
};

export type TupleDefinition = BaseDefinition & {
  kind: "tuple";
  items: readonly [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ];
};

export type UnionDefinition = BaseDefinition & {
  expected: string;
  kind: "or";
  options: readonly [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ];
  uniformIdentityEncode?: boolean;
};

export type DiscriminatedUnionDefinition = BaseDefinition & {
  kind: "discriminatedUnion";
  discriminator: string;
  discriminatorWireKeys?: readonly string[];
  expected: string;
  map: Map<unknown, StructLike<unknown, unknown, boolean>>;
  options: readonly [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ];
  wireKeyByValue?: Map<unknown, string>;
};

export type IntersectionDefinition = BaseDefinition & {
  expected: string;
  kind: "intersection";
  objectSides: boolean;
  options: readonly [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ];
};

export type StructDefinition =
  | ArrayDefinition
  | AnyDefinition
  | DiscriminatedUnionDefinition
  | EnumDefinition<string | number>
  | IntersectionDefinition
  | LiteralDefinition<LiteralValue>
  | ObjectDefinition
  | PrimitiveDefinition<PrimitiveKind, unknown, unknown>
  | RecordDefinition
  | TupleDefinition
  | UnknownDefinition
  | UnionDefinition;

export type ParseFailure = {
  issue: StructIssue;
  ok: false;
};

export type ParseSuccess<T> = {
  ok: true;
  value: T;
};

export type InternalParseResult<T> = ParseFailure | ParseSuccess<T>;

export type RuntimeStruct = {
  readonly [DEFINITION]: StructDefinition;
  readonly _struct: StructTypes<unknown, unknown, boolean>;
  alias(name: string): RuntimeStruct;
  null(): RuntimeStruct;
  nullable(): RuntimeStruct;
  nullish(): RuntimeStruct;
  optional(): RuntimeStruct;
};
