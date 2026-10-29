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
  readonly members: readonly RuntimeStruct[];
}

export type Guide = GuideSet | RuntimeStruct;

export function isGuideSet(value: unknown): value is GuideSet {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [GUIDE_SET]?: unknown })[GUIDE_SET] === true
  );
}

export function guideTag(members: readonly RuntimeStruct[]): Guide | undefined {
  const unique: RuntimeStruct[] = [];
  for (const member of members) {
    if (!unique.includes(member)) {
      unique.push(member);
    }
  }
  if (unique.length === 0) {
    return undefined;
  }
  if (unique.length === 1) {
    return unique[0];
  }
  return { [GUIDE_SET]: true, members: unique };
}

export function guideMembers(guide: Guide): readonly RuntimeStruct[] {
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
  guides?: WeakMap<object, Guide>,
): Guide | undefined {
  const tag = guides?.get(value) ?? (value as { [STRUCT]?: unknown })[STRUCT];
  if (isGuideSet(tag)) {
    return tag;
  }
  if (!isStruct(tag)) {
    return undefined;
  }
  // Arrays and tuples are not tagged. A foreign struct on the symbol is not a guide.
  const kind = (tag as RuntimeStruct)[DEFINITION].kind;
  if (kind === "object" || kind === "record") {
    return tag as RuntimeStruct;
  }
  return undefined;
}

/** Tag a null-prototype node this parse just created. Enumerable so object spread keeps its guide. */
export function tagOwnNode(
  value: { [key: string]: unknown },
  tag: Guide,
): void {
  (value as { [STRUCT]?: Guide })[STRUCT] = tag;
}
