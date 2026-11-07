import { issue } from "./errors";
import { DEFINITION } from "./symbols";
import type { FAILED } from "./symbols";
import type {
  DecodeFailure,
  Path,
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
  decode?: (
    value: TInput,
    path: Path,
    fail: DecodeFailure,
  ) => TOutput | typeof FAILED;
  /** Receives whatever value is being encoded, which this struct did not necessarily produce. */
  encode?: (value: unknown) => unknown;
  expected: string;
  is: (value: unknown) => value is TInput;
  kind: K;
  alias?: string;
  runtimeIs?: (value: unknown) => boolean;
}

export function createPrimitiveStruct<TInput, TOutput = TInput>(
  definition: PrimitiveDefinitionInput<PrimitiveKind, TInput, TOutput>,
): Struct<TInput, TOutput> {
  const { decode, expected, is } = definition;
  return makeStruct({
    ...definition,
    // The stored hook takes any value. It is called after `is` accepted the value, and checks it again itself.
    decode:
      decode &&
      ((value: unknown, path: Path, fail: DecodeFailure) =>
        is(value)
          ? decode(value, path, fail)
          : fail(issue(path, "invalid_type", expected, value))),
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
      if (typeof name !== "string") {
        throw new TypeError("alias() requires a string name");
      }

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
