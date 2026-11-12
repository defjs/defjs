import type { DEFINITION, FAILED } from "./symbols";
import type { LiteralValue, ObjectShape, StructTypes } from "./types";

// Bound data-driven recursion independently of the engine's stack size. Opaque any/unknown values are not traversed.
export const MAX_DEPTH = 256;

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

export type PrimitiveDefinition<
  K extends PrimitiveKind,
  TInput,
  TOutput = TInput,
> = BaseDefinition & {
  /**
   * Returns the decoded value, or `invalid` for a value this struct does not accept or cannot convert. `invalid` is the
   * sentinel of the parser that is running, not of the module that defined the hook, so a struct built by another copy
   * of this package fails on the copy that is parsing. That copy builds the issue and applies its error map.
   */
  decode?: (value: TInput, invalid: typeof FAILED) => TOutput | typeof FAILED;
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
  values: readonly T[];
  valueSet?: ReadonlySet<T> | null;
};

export type ArrayDefinition = BaseDefinition & {
  kind: "array";
  item: RuntimeStruct;
};

export interface ResolvedStructField {
  readonly key: string;
  readonly struct: RuntimeStruct;
  readonly wireKey: string;
}

export type ObjectDefinitionCache = {
  declaredDescriptors: PropertyDescriptorMap;
  entries?: readonly (readonly [key: string, struct: RuntimeStruct])[];
  fields?: readonly ResolvedStructField[];
};

export type ObjectDefinition = BaseDefinition & {
  readonly cache: ObjectDefinitionCache;
  codec?: "formData" | "urlencoded";
  kind: "object";
  shape: ObjectShape;
};

export type RecordDefinition = BaseDefinition & {
  kind: "record";
  value: RuntimeStruct;
};

export type TupleDefinition = BaseDefinition & {
  kind: "tuple";
  items: readonly RuntimeStruct[];
};

export type UnionDefinition = BaseDefinition & {
  expected: string;
  kind: "or";
  options: readonly RuntimeStruct[];
};

export type DiscriminatedUnionDefinition = BaseDefinition & {
  kind: "discriminatedUnion";
  discriminator: string;
  /** Every wire name an option gives the tag field, in option order. */
  discriminatorWireKeys: readonly string[];
  expected: string;
  map: Map<unknown, ObjectRuntimeStruct>;
  options: readonly ObjectRuntimeStruct[];
  /** The wire name of the tag field in the option a tag value selects. */
  wireKeyByValue: Map<unknown, string>;
};

/** Set only when construction flattened every member to an object struct, so those options are typed as such. */
type IntersectionSides =
  | { objectSides: true; options: readonly ObjectRuntimeStruct[] }
  | { objectSides: false; options: readonly RuntimeStruct[] };

export type IntersectionDefinition = BaseDefinition &
  IntersectionSides & {
    expected: string;
    kind: "intersection";
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

export type ObjectRuntimeStruct = RuntimeStruct<ObjectDefinition>;

export interface RuntimeStruct<D extends StructDefinition = StructDefinition> {
  readonly [DEFINITION]: D;
  readonly _struct: StructTypes<unknown, unknown, boolean>;
  alias(name: string): RuntimeStruct;
  null(): RuntimeStruct;
  nullable(): RuntimeStruct;
  nullish(): RuntimeStruct;
  optional(): RuntimeStruct;
}
