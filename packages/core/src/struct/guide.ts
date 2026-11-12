import { isStruct } from "./guards";
import { DEFINITION, STRUCT } from "./symbols";
import type { RuntimeStruct } from "./types";

const GUIDE_SET = Symbol.for("defjs.struct.guideSet");

/**
 * Conjunction of structs used as an outbound guide and as an intersection parse tag.
 * A single struct is the one-element case and stays the struct itself. This is not a public struct:
 * it has no definition, so construction never walks member shapes.
 */
export interface GuideSet {
  readonly [GUIDE_SET]: true;
  readonly members: readonly [RuntimeStruct, ...RuntimeStruct[]];
}

export type Guide = GuideSet | RuntimeStruct;

export function isGuideSet(value: unknown): value is GuideSet {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, GUIDE_SET) === true
  );
}

export function guideTag(
  members: readonly [RuntimeStruct, ...RuntimeStruct[]],
): Guide;
export function guideTag(members: readonly RuntimeStruct[]): Guide | undefined;
export function guideTag(members: readonly RuntimeStruct[]): Guide | undefined {
  const first = members[0];
  if (first === undefined) {
    return undefined;
  }
  const unique: [RuntimeStruct, ...RuntimeStruct[]] = [first];
  for (const member of members) {
    if (!unique.includes(member)) {
      unique.push(member);
    }
  }
  if (unique.length === 1) {
    return first;
  }
  return { [GUIDE_SET]: true, members: unique };
}

export function guideMembers(
  guide: Guide,
): readonly [RuntimeStruct, ...RuntimeStruct[]] {
  return isGuideSet(guide) ? guide.members : [guide];
}

export function combineGuides(
  left: Guide | undefined,
  right: Guide | undefined,
): Guide | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return guideTag([...guideMembers(left), ...guideMembers(right)]);
}

export function readOwnGuide(
  value: object,
  guides: WeakMap<object, Guide> | undefined,
): Guide | undefined {
  // Reflect.get is one ordinary [[Get]], like `value[STRUCT]`; an `in` check would also call a proxy's has trap.
  const tag: unknown = guides?.get(value) ?? Reflect.get(value, STRUCT);
  if (isGuideSet(tag)) {
    return tag;
  }
  if (!isStruct(tag)) {
    return undefined;
  }
  // Arrays and tuples are not tagged. A foreign struct on the symbol is not a guide.
  const kind = tag[DEFINITION].kind;
  if (kind === "object" || kind === "record") {
    return tag;
  }
  return undefined;
}

/** Tag a null-prototype node this parse just created. Enumerable so object spread keeps its guide. */
export function tagOwnNode(
  value: { [STRUCT]?: Guide; [key: string]: unknown },
  tag: Guide | undefined,
): void {
  value[STRUCT] = tag;
}
