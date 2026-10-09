import type { STRUCT } from '../struct/symbols'
import type {
  AnyStruct,
  ArrayStruct,
  CarriedStruct,
  DiscriminatedUnionStruct,
  Infer,
  IntersectionStruct,
  ObjectStruct,
  RecordStruct,
  StructLike,
  TupleStruct,
  UnionStruct,
} from '../struct/types'

/** Object produced by endpoint input parsing. The symbol points at the struct that produced the node. */
export type Typed = { readonly [STRUCT]: AnyStruct }

export type Scalar = string | number | bigint | boolean | Date

export type FlatValue = Scalar | readonly Scalar[] | undefined

export type FlatRecord = { readonly [key: string]: FlatValue }

export type QueryValue = Scalar | readonly QueryValue[] | { readonly [key: string]: QueryValue } | undefined

export type QueryRecord = { readonly [key: string]: QueryValue }

export type PathParams<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParams<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never

export type PathValue<P extends string> = [PathParams<P>] extends [never]
  ? never
  : ({ readonly [K in PathParams<P>]: Scalar } & { readonly [STRUCT]?: never }) | (Typed & { readonly [key: string]: Scalar })

export type HttpRequestShape<P extends string, M extends string> = {
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
  headers?: HeadersInit | FlatRecord
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
}

export type WebSocketRequestShape<P extends string> = {
  body?: never
  headers?: never
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
}

export type EventStreamRequestShape<P extends string, M extends string> = HttpRequestShape<P, M>

type NullishBuilderInput<S, Inner> =
  null extends Infer<S>
    ? undefined extends Infer<S>
      ? BuilderInput<Inner> | null | undefined
      : BuilderInput<Inner> | null
    : undefined extends Infer<S>
      ? BuilderInput<Inner> | undefined
      : BuilderInput<Inner>

type IntersectBuilderInputs<T extends readonly StructLike<unknown, unknown, boolean>[]> = T extends readonly [
  infer Head extends StructLike<unknown, unknown, boolean>,
  ...infer Tail extends readonly StructLike<unknown, unknown, boolean>[],
]
  ? BuilderInput<Head> & (Tail['length'] extends 0 ? unknown : IntersectBuilderInputs<Tail>)
  : unknown

/**
 * Parsed endpoint input seen by a builder.
 *
 * Object nodes are intersected with {@link Typed}. Record entries and tuple items are too.
 * At runtime a record container is also tagged when the parsed value is an object, whether or not it
 * was merged. Array and tuple containers are not. `null` and `undefined` are never tagged.
 * Modifiers recover the struct they wrapped. Union options are distributed; intersection options are combined.
 */
export type BuilderInput<S> =
  S extends CarriedStruct<infer Inner>
    ? NullishBuilderInput<S, Inner>
    : S extends UnionStruct<infer Options>
      ? BuilderInput<Options[number]>
      : S extends DiscriminatedUnionStruct<infer Options>
        ? BuilderInput<Options[number]>
        : S extends IntersectionStruct<infer Options>
          ? IntersectBuilderInputs<Options>
          : S extends RecordStruct<infer Value>
            ? { [key: string]: BuilderInput<Value> }
            : S extends TupleStruct<infer Items>
              ? { [K in keyof Items]: Items[K] extends StructLike<unknown, unknown, boolean> ? BuilderInput<Items[K]> : Items[K] }
              : S extends ArrayStruct<infer Item>
                ? BuilderInput<Item>[]
                : S extends ObjectStruct<infer Shape>
                  ? { [K in keyof Shape]: BuilderInput<Shape[K]> } & Typed
                  : Infer<S>

export type BuilderField<TInput, TShape> = [TInput] extends [undefined]
  ? { builder?: () => TShape }
  : BuilderInput<TInput> extends TShape
    ? { builder?: (input: BuilderInput<TInput>) => TShape }
    : { builder: (input: BuilderInput<TInput>) => TShape }
