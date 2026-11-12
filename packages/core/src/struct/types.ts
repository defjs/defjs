import type { StructError } from "./errors";
import type { STRUCT } from "./symbols";

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

// Kept until web_socket/codec.ts names StructLike itself.
export type AnyStructLike = StructLike;

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
 * - `alias(name)` sets the wire name of an object field. `struct.parse` reads logical names unless `aliases: true` is passed; JSON and flat request codecs write the alias.
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

// The modifiers every composite struct inherits: each keeps the composite itself (`Self`) behind the new struct.
interface PreservingModifiers<Self, I, O> extends StructMethods<I, O, false> {
  null(): PreservedStruct<Self, I | null, O | null, false>;
  nullable(): PreservedStruct<Self, I | null, O | null, false>;
  nullish(): PreservedStruct<
    Self,
    I | null | undefined,
    O | null | undefined,
    true
  >;
  optional(): PreservedStruct<Self, I | undefined, O | undefined, true>;
}

/**
 * Broad struct constraint that accepts any struct, for endpoint and client generics.
 *
 * Used by generics such as `defineRequest` and `Fault`. Prefer a concrete `Struct<…>` when you need precise input and output inference.
 *
 * @group struct
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- INTENT: published as `type AnyStruct = Struct<any, any, boolean>`. With `Struct<unknown, unknown, boolean>` a generic `TInput extends AnyStruct` no longer relates StructInput<TInput> to EndpointInput<TInput>: TS2322 in defineRequest (2), defineEventStream and defineWebSocket
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

export type FieldOutput<S> = S extends StructLike
  ? S extends OptionalOutputStruct
    ? Exclude<S["_struct"]["output"], undefined>
    : S["_struct"]["output"]
  : never;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- INTENT: published, and documented on struct.object(), as `{ [key: string]: any }`. With `unknown` values the `T[K]["_struct"]` lookups fail (TS2322 in outbound_request.spec.ts and json.spec.ts); with `StructLike` values a recursive shape loses inference (TS7022 in json.spec.ts "caches recursive discriminator metadata…")
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

export type TupleInput<T extends readonly StructLike[]> = {
  -readonly [K in keyof T]: StructInput<T[K]>;
};

export type TupleOutput<T extends readonly StructLike[]> = {
  -readonly [K in keyof T]: StructOutput<T[K]>;
};

export type UnionOutput<T extends readonly StructLike[]> = Exclude<
  StructOutput<T[number]>,
  undefined
>;

export type UnionInput<T extends readonly StructLike[]> = Exclude<
  StructInput<T[number]>,
  undefined
>;

type IntersectionInputValue<T extends readonly StructLike[]> =
  T extends readonly [
    infer Head extends StructLike,
    ...infer Tail extends StructLike[],
  ]
    ? StructInput<Head> & IntersectionInputValue<Tail>
    : unknown;

export type IntersectionInput<T extends readonly StructLike[]> = Exclude<
  IntersectionInputValue<T>,
  undefined
>;

type IntersectionOutputValue<T extends readonly StructLike[]> =
  T extends readonly [
    infer Head extends StructLike,
    ...infer Tail extends StructLike[],
  ]
    ? StructOutput<Head> & IntersectionOutputValue<Tail>
    : unknown;

export type IntersectionOutput<T extends readonly StructLike[]> = Exclude<
  IntersectionOutputValue<T>,
  undefined
>;

export type StringStruct = Struct<string, string>;

export type NumberStruct = Struct<number, number>;

export type UnknownStruct = Struct<PresentValue, unknown>;

export type ArrayInput<S extends StructLike> = StructInput<S>[];
export type ArrayOutput<S extends StructLike> = StructOutput<S>[];

export interface ArrayStructTypes<S extends StructLike> extends StructTypes<
  ArrayInput<S>,
  ArrayOutput<S>,
  false
> {
  input: ArrayInput<S>;
  optionalOut: undefined;
  output: ArrayOutput<S>;
}

export interface ArrayStruct<S extends StructLike>
  extends
    PreservingModifiers<ArrayStruct<S>, ArrayInput<S>, ArrayOutput<S>>,
    StructLike<ArrayInput<S>, ArrayOutput<S>, false> {
  readonly _struct: ArrayStructTypes<S>;
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
    PreservingModifiers<ObjectStruct<T>, ObjectInput<T>, ObjectOutput<T>>,
    StructLike<ObjectInput<T>, ObjectOutput<T>, false> {
  readonly _struct: ObjectStructTypes<T>;
}

declare const recordValueStruct: unique symbol;
declare const tupleItemStructs: unique symbol;

type RecordInput<S extends StructLike> = {
  [key: string]: StructInput<S>;
};
type RecordOutput<S extends StructLike> = {
  [key: string]: FieldOutput<S>;
};

/**
 * Value struct carried by `struct.record`.
 * Tagged parsing stores this struct on the record object itself. `null` and `undefined` are not tagged.
 */
export interface RecordStruct<S extends StructLike>
  extends
    PreservingModifiers<RecordStruct<S>, RecordInput<S>, RecordOutput<S>>,
    StructLike<RecordInput<S>, RecordOutput<S>, false> {
  readonly [recordValueStruct]: S;
}

/** Item structs carried by `struct.tuple`, so builders tag each position. The tuple itself is not tagged. */
export interface TupleStruct<T extends readonly StructLike[]>
  extends
    PreservingModifiers<TupleStruct<T>, TupleInput<T>, TupleOutput<T>>,
    StructLike<TupleInput<T>, TupleOutput<T>, false> {
  readonly [tupleItemStructs]: T;
}

export interface UnionStruct<T extends readonly StructLike[]>
  extends
    PreservingModifiers<UnionStruct<T>, UnionInput<T>, UnionOutput<T>>,
    StructLike<UnionInput<T>, UnionOutput<T>, false> {
  readonly [unionStructOptions]: T;
}

export interface DiscriminatedUnionStruct<
  TOptions extends readonly ObjectStruct<ObjectShape>[],
>
  extends
    PreservingModifiers<
      DiscriminatedUnionStruct<TOptions>,
      StructInput<TOptions[number]>,
      StructOutput<TOptions[number]>
    >,
    StructLike<
      StructInput<TOptions[number]>,
      StructOutput<TOptions[number]>,
      false
    > {
  readonly [discriminatedUnionOptions]: TOptions;
}

export interface IntersectionStruct<T extends readonly StructLike[]>
  extends
    PreservingModifiers<
      IntersectionStruct<T>,
      IntersectionInput<T>,
      IntersectionOutput<T>
    >,
    StructLike<IntersectionInput<T>, IntersectionOutput<T>, false> {
  readonly [intersectionStructOptions]: T;
}

/** The node of an endpoint-input parse: a plain object that carries the struct that produced it. */
export type TaggedObject = { readonly [STRUCT]: AnyStruct };
type NullishTagged<S, Inner> =
  null extends Infer<S>
    ? undefined extends Infer<S>
      ? TaggedStructOutput<Inner> | null | undefined
      : TaggedStructOutput<Inner> | null
    : undefined extends Infer<S>
      ? TaggedStructOutput<Inner> | undefined
      : TaggedStructOutput<Inner>;
type IntersectTagged<T extends readonly StructLike[]> = T extends readonly [
  infer H extends StructLike,
  ...infer Tail extends readonly StructLike[],
]
  ? TaggedStructOutput<H> & IntersectTagged<Tail>
  : unknown;
/** Runtime-tagged output of an internal endpoint-input parse. Not part of the package root. */
export type TaggedStructOutput<S> =
  S extends CarriedStruct<infer Inner>
    ? NullishTagged<S, Inner>
    : S extends UnionStruct<infer Options>
      ? TaggedStructOutput<Options[number]>
      : S extends DiscriminatedUnionStruct<infer Options>
        ? TaggedStructOutput<Options[number]>
        : S extends IntersectionStruct<infer Options>
          ? IntersectTagged<Options>
          : S extends RecordStruct<infer Value>
            ? { [key: string]: TaggedStructOutput<Value> }
            : S extends TupleStruct<infer Items>
              ? {
                  [K in keyof Items]: Items[K] extends StructLike
                    ? TaggedStructOutput<Items[K]>
                    : Items[K];
                }
              : S extends ArrayStruct<infer Item>
                ? TaggedStructOutput<Item>[]
                : S extends ObjectStruct<infer Shape>
                  ? {
                      [K in keyof Shape]: TaggedStructOutput<Shape[K]>;
                    } & TaggedObject
                  : Infer<S>;
// `[Tag]` is not a bare type parameter: a generic caller that returns `Infer<S>` would otherwise infer `Tag` from its own return type.
export type ParsedStructOutput<S extends StructLike, Tag extends boolean> = [
  Tag,
] extends [true]
  ? TaggedStructOutput<S>
  : Infer<S>;
