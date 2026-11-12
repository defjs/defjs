import { DEFINITION } from "./symbols";
import type { FAILED } from "./symbols";
import type {
  PrimitiveKind,
  RuntimeStruct,
  Struct,
  StructDefinition,
  StructFlags,
  StructLike,
} from "./types";

export interface PrimitiveDefinitionInput<
  K extends PrimitiveKind,
  TInput,
  TOutput = TInput,
> {
  /** Converts a value `is` accepted. Returns the output, or `invalid` for a value it cannot convert. */
  decode?: (value: TInput, invalid: typeof FAILED) => TOutput | typeof FAILED;
  expected: string;
  is: (value: unknown) => value is TInput;
  kind: K;
  alias?: string;
  runtimeIs?: (value: unknown) => boolean;
}

export function createPrimitiveStruct<TInput, TOutput = TInput>(
  definition: PrimitiveDefinitionInput<PrimitiveKind, TInput, TOutput>,
): Struct<TInput, TOutput> {
  const { decode, is } = definition;
  return makeStruct({
    ...definition,
    // The stored hook takes any value, so it is the one check a parse makes for a struct that converts.
    decode:
      decode &&
      ((value: unknown, invalid: typeof FAILED) =>
        is(value) ? decode(value, invalid) : invalid),
    flags: DEFAULT_FLAGS,
  });
}

export const DEFAULT_FLAGS: StructFlags = { nullable: false, optional: false };

/**
 * Builds the runtime object of a struct and gives it the struct type its constructor declares.
 *
 * `TStruct` is chosen by the constructor, not checked: its `_struct` input and output types are a compile-time-only
 * brand with no runtime value to inspect.
 */
export function makeStruct<TStruct extends StructLike = RuntimeStruct>(
  definition: StructDefinition,
): TStruct & RuntimeStruct {
  const withFlags = (flags: Partial<StructFlags>): RuntimeStruct =>
    makeStruct({
      ...definition,
      flags: {
        ...definition.flags,
        ...flags,
      },
    });

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: every constructor returns a published struct type (Struct<I, O>, ObjectStruct<T>, RecordStruct<S>, …) whose `_struct` brand and phantom members exist only in the type system, so no runtime object can be checked into one, and this is the one place a struct object is given that type. Tried: an optional `_struct` in the published StructLike (`readonly _struct?: StructTypes<I, O, OO>`) breaks inference, 385 errors in 55 files; a class with `declare readonly _struct` still cannot declare each constructor's phantom members and moves the methods off Object.prototype; a real `_struct` property adds an own key to every struct
  return {
    [DEFINITION]: definition,
    alias(name: string) {
      return makeStruct({
        ...definition,
        alias: name,
      });
    },
    null() {
      return withFlags({ nullable: true });
    },
    nullable() {
      return withFlags({ nullable: true });
    },
    nullish() {
      return withFlags({ nullable: true, optional: true });
    },
    optional() {
      return withFlags({ optional: true });
    },
  } as TStruct & RuntimeStruct;
}
