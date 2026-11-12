import { describe, expectTypeOf, it } from "vitest";
import {
  StructError,
  struct,
  type ArrayStruct,
  type DiscriminatedUnionStruct,
  type ErrorMap,
  type Infer,
  type IntersectionStruct,
  type ObjectStruct,
  type ParseResult,
  type PreservedStruct,
  type RecordStruct,
  type StructInput,
  type StructIssue,
  type StructLike,
  type StructMethods,
  type TupleStruct,
  type UnionStruct,
} from "./index";

// @ts-expect-error ObjectShape is internal.
import type { ObjectShape } from "./index";

// @ts-expect-error RequestShape is internal.
import type { RequestShape } from "./index";

// @ts-expect-error RequestBodyCodec was removed with the requestBody kind.
import type { RequestBodyCodec } from "./index";

// @ts-expect-error ContentCodecKind is internal.
import type { ContentCodecKind } from "./index";

// @ts-expect-error ContentBoundaryDescriptor is internal.
import type { ContentBoundaryDescriptor } from "./index";

describe("struct public API", () => {
  it("exports struct, Infer, and error types", () => {
    const Id = struct.string();
    const User = struct.object({ id: Id });
    const Request = struct.object({ path: User });

    expectTypeOf<Infer<typeof User>>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<StructInput<typeof User>>().toEqualTypeOf<{ id: string }>();
    expectTypeOf(User).toExtend<ObjectStruct<{ id: typeof Id }>>();
    expectTypeOf(Request).toExtend<ObjectStruct<{ path: typeof User }>>();
    expectTypeOf(User).toExtend<
      StructLike<{ id: string }, { id: string }, false>
    >();
    expectTypeOf(User).toExtend<
      StructMethods<{ id: string }, { id: string }, false>
    >();
    expectTypeOf(struct.parse(User, { id: "u_1" })).toEqualTypeOf<
      ParseResult<{ id: string }>
    >();
    const issues: StructIssue[] = [];
    expectTypeOf(StructError).toBeConstructibleWith(issues);
    expectTypeOf<"invalid_intersection">().toExtend<StructIssue["code"]>();
    expectTypeOf<ErrorMap>().toBeFunction();
  });

  it("exports the composite struct types an SDK declaration file names", () => {
    const Item = struct.string();
    const Tag = struct.object({ kind: struct.literal("a") });
    const Left = struct.object({ a: struct.string() });
    const Right = struct.object({ b: struct.number() });

    expectTypeOf(struct.array(Item)).toExtend<ArrayStruct<typeof Item>>();
    expectTypeOf(struct.record(Item)).toExtend<RecordStruct<typeof Item>>();
    expectTypeOf(struct.tuple([Item])).toExtend<
      TupleStruct<readonly [typeof Item]>
    >();
    expectTypeOf(struct.or(Item, Left)).toExtend<
      UnionStruct<readonly [typeof Item, typeof Left]>
    >();
    expectTypeOf(struct.discriminatedUnion("kind", [Tag])).toExtend<
      DiscriminatedUnionStruct<readonly [typeof Tag]>
    >();
    expectTypeOf(struct.intersection(Left, Right)).toExtend<
      IntersectionStruct<readonly [typeof Left, typeof Right]>
    >();
    expectTypeOf(struct.array(Item).optional()).toExtend<
      PreservedStruct<
        ArrayStruct<typeof Item>,
        string[] | undefined,
        string[] | undefined,
        true
      >
    >();
  });

  it("narrows parse result error and value positions together", () => {
    const User = struct.object({ id: struct.string() });
    const result = struct.parse(User, {});

    if (result[0]) {
      expectTypeOf(result[0]).toEqualTypeOf<StructError>();
      expectTypeOf(result[1]).toEqualTypeOf<undefined>();
    } else {
      expectTypeOf(result[0]).toEqualTypeOf<null>();
      expectTypeOf(result[1]).toEqualTypeOf<{ id: string }>();
    }
  });
});

export type MissingObjectShape = ObjectShape;
export type MissingRequestShape = RequestShape;
export type MissingRequestBodyCodec = RequestBodyCodec;
export type MissingContentCodecKind = ContentCodecKind;
export type MissingContentBoundaryDescriptor = ContentBoundaryDescriptor;
