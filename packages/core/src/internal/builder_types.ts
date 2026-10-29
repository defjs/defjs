import type { STRUCT } from "../struct/symbols";
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
} from "../struct/types";

/** Object produced by endpoint input parsing. The symbol points at the struct that produced the node. */
export type Typed = { readonly [STRUCT]: AnyStruct };

export type Scalar = string | number | bigint | boolean | Date;

export type FlatValue = Scalar | readonly Scalar[] | undefined;

export type FlatRecord = { readonly [key: string]: FlatValue };

export type QueryValue =
  | Scalar
  | readonly QueryValue[]
  | { readonly [key: string]: QueryValue }
  | undefined;

export type QueryRecord = { readonly [key: string]: QueryValue };

/** A builder body: a wire value Fetch sends as is, or JSON data. An `interface` value or class instance needs `{ ...value }`. */
export type BodyValue =
  | Scalar
  | null
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | FormData
  | URLSearchParams
  | ReadableStream<Uint8Array>
  | readonly unknown[]
  | { readonly [key: string]: unknown };

export type PathParams<P extends string> =
  P extends `${string}:${infer Name}/${infer Rest}`
    ? Name | PathParams<`/${Rest}`>
    : P extends `${string}:${infer Name}`
      ? Name
      : never;

export type PathValue<P extends string> = [PathParams<P>] extends [never]
  ? never
  : | ({ readonly [K in PathParams<P>]: Scalar } & {
        readonly [STRUCT]?: never;
      })
    | (Typed & { readonly [key: string]: Scalar });

/**
 * Request shape an HTTP builder returns: path, query, headers, and body.
 *
 * `P` is the endpoint path and `M` its method. `GET` and `HEAD` cannot return a
 * body. `BodyValue` is a wire value Fetch sends as is (`string`, `Blob`,
 * `ArrayBuffer`, a typed array or `DataView`, `FormData`, `URLSearchParams`,
 * `ReadableStream<Uint8Array>`) or JSON data (`number`, `boolean`, `bigint`,
 * `Date`, `null`, an array, or an object type with string keys); an `interface`
 * value or class instance needs `{ ...value }`. `path` values must be scalars.
 * A header value may be a scalar or an array of scalars, and `HeadersInit` is
 * accepted. `query` may nest, and a nested object needs `withQuerySerializer`
 * at runtime. `FlatRecord`, `QueryRecord`, `PathValue`, and `BodyValue` are
 * internal helper types.
 *
 * @group http
 */
export type HttpRequestShape<P extends string, M extends string> = {
  /**
   * Request body. Not allowed for GET or HEAD.
   * Other methods send a native body or encoded JSON, depending on the value.
   */
  body?: Uppercase<M> extends "GET" | "HEAD" ? never : BodyValue;
  /**
   * HeadersInit or a flat record of scalars or scalar arrays.
   * Put cross-request policies on the Client.
   */
  headers?: HeadersInit | FlatRecord;
  /**
   * Explicit values for path placeholders. Anonymous objects use template keys;
   * typed objects apply their struct aliases.
   */
  path?: PathValue<P>;
  /**
   * URLSearchParams passes through unchanged; objects are encoded first.
   * Configure the Client's query serializer for nested query values.
   */
  query?: URLSearchParams | QueryRecord;
};

/**
 * Request shape the `builder` of a {@link WebSocketDefinition} may return, where `P` is the endpoint path.
 *
 * - `path` supplies the `:name` segments of `P`: one scalar value per name. It is `never` when the path has none.
 * - `query` is a `URLSearchParams` or a record of scalars, arrays, and nested records.
 * - `headers` and `body` are `never`. A WebSocket handshake takes neither from the builder; put credentials in `beforeConnect` or an interceptor.
 *
 * @group web-socket
 */
export type WebSocketRequestShape<P extends string> = {
  /** WebSocket handshakes cannot have a body. Use session.send after connecting. */
  body?: never;
  /** WebSocket builders cannot set handshake headers. */
  headers?: never;
  /**
   * Explicit values for path placeholders. Anonymous objects use template keys;
   * typed objects apply their struct aliases.
   */
  path?: PathValue<P>;
  /**
   * URLSearchParams passes through unchanged; objects are encoded first.
   * Configure the Client's query serializer for nested query values.
   */
  query?: URLSearchParams | QueryRecord;
};

/**
 * Request shape an SSE builder returns: the same fields as {@link HttpRequestShape} for method `M` and path `P`.
 *
 * @group sse
 */
export type EventStreamRequestShape<
  P extends string,
  M extends string,
> = HttpRequestShape<P, M>;

type NullishBuilderInput<S, Inner> =
  null extends Infer<S>
    ? undefined extends Infer<S>
      ? BuilderInput<Inner> | null | undefined
      : BuilderInput<Inner> | null
    : undefined extends Infer<S>
      ? BuilderInput<Inner> | undefined
      : BuilderInput<Inner>;

type IntersectBuilderInputs<
  T extends readonly StructLike<unknown, unknown, boolean>[],
> = T extends readonly [
  infer Head extends StructLike<unknown, unknown, boolean>,
  ...infer Tail extends readonly StructLike<unknown, unknown, boolean>[],
]
  ? BuilderInput<Head> &
      (Tail["length"] extends 0 ? unknown : IntersectBuilderInputs<Tail>)
  : unknown;

/**
 * Parsed endpoint input that a request builder receives.
 *
 * Object nodes are intersected with the internal `Typed` brand, so they carry the struct that
 * produced them and alias, `Date`, and `bigint` encoding follow the value into
 * the request. Record entries and tuple items are branded the same way. At
 * runtime a record container is also tagged when the parsed value is an object,
 * whether or not it was merged. Array and tuple containers are not. `null` and
 * `undefined` are never tagged. Nullish modifiers recover the struct they
 * wrapped. Union options are distributed; intersection options are combined.
 * Any other struct falls back to `Infer<S>`.
 *
 * `CarriedStruct`, `NullishBuilderInput`, `IntersectBuilderInputs`, and `Typed`
 * are internal helper types.
 *
 * @group http
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
              ? {
                  [K in keyof Items]: Items[K] extends StructLike<
                    unknown,
                    unknown,
                    boolean
                  >
                    ? BuilderInput<Items[K]>
                    : Items[K];
                }
              : S extends ArrayStruct<infer Item>
                ? BuilderInput<Item>[]
                : S extends ObjectStruct<infer Shape>
                  ? { [K in keyof Shape]: BuilderInput<Shape[K]> } & Typed
                  : Infer<S>;

export type BuilderField<TInput, TShape> = [TInput] extends [undefined]
  ? {
      /** Pure, synchronous request builder, evaluated when the command runs. Optional without input. */
      builder?: () => TShape;
    }
  : {
      /** Pure, synchronous function that explicitly places parsed input on the request when the command runs. */
      builder: (input: BuilderInput<TInput>) => TShape;
    };
