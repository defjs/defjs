import { formatPath } from "./errors";
import { MAX_DEPTH, type RuntimeStruct } from "./definition";
import { combineGuides, readOwnGuide, tagOwnNode, type Guide } from "./guide";
import { isPlainObject, nullObject } from "./plain_object";
import { DEFINITION } from "./symbols";
import type { Path } from "./types";

type MergeConflict = { ok: false; path: Path; received: unknown };

export type IntersectionMerge = { ok: true; value: unknown } | MergeConflict;

export type PlainObjectMerge =
  { ok: true; value: { [key: string]: unknown } } | MergeConflict;

type MergeContext = { owned: WeakSet<object>; guides: WeakMap<object, Guide> };

/**
 * Deep-merge two intersection outputs.
 *
 * `Object.is` keeps NaN and distinguishes signed zeroes. Equal-time Dates are one instant even
 * though the instances differ. Plain objects are copied onto a null prototype so `__proto__` stays
 * an own data key. Anything else, including arrays of different lengths, is a conflict.
 *
 * With a `context`, each merged object takes the union of its sides' parse tags. One-sided children are
 * copied with the tag their own parser already wrote, so a later walk is not required. Null and
 * undefined never enter this branch. `depth` is the caller's logical path length, not a fresh merge budget.
 * Distinct containers consume a level even when they came from opaque leaves; identical references do not recurse.
 */
export function mergeIntersectionValues(
  left: unknown,
  right: unknown,
  depth: number,
  context?: MergeContext,
): IntersectionMerge {
  if (Object.is(left, right)) {
    return { ok: true, value: left };
  }
  if (
    left instanceof Date &&
    right instanceof Date &&
    left.getTime() === right.getTime()
  ) {
    return { ok: true, value: left };
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    return mergePlainObjects(left, right, depth, context);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length || depth >= MAX_DEPTH) {
      return { ok: false, path: [], received: right };
    }
    const output = new Array<unknown>(left.length);
    for (let index = 0; index < left.length; index += 1) {
      const merged = mergeIntersectionValues(
        left[index],
        right[index],
        depth + 1,
        context,
      );
      if (!merged.ok) {
        return {
          ok: false,
          path: [index, ...merged.path],
          received: merged.received,
        };
      }
      output[index] = merged.value;
    }
    return { ok: true, value: output };
  }
  return { ok: false, path: [], received: right };
}

/** The plain-object case of {@link mergeIntersectionValues}, for two distinct objects. */
export function mergePlainObjects(
  left: { [key: string]: unknown },
  right: { [key: string]: unknown },
  depth: number,
  context?: MergeContext,
): PlainObjectMerge {
  if (depth >= MAX_DEPTH) {
    return { ok: false, path: [], received: right };
  }
  const output = nullObject();
  for (const key of Object.keys(left)) {
    output[key] = left[key];
  }
  for (const key of Object.keys(right)) {
    if (!Object.hasOwn(output, key)) {
      output[key] = right[key];
      continue;
    }
    const merged = mergeIntersectionValues(
      output[key],
      right[key],
      depth + 1,
      context,
    );
    if (!merged.ok) {
      return {
        ok: false,
        path: [key, ...merged.path],
        received: merged.received,
      };
    }
    output[key] = merged.value;
  }
  if (context !== undefined) {
    context.owned.add(output);
    const tag = combineGuides(
      readOwnGuide(left, context.guides),
      readOwnGuide(right, context.guides),
    );
    if (tag) {
      tagOwnNode(output, tag);
    }
  }
  return { ok: true, value: output };
}

export function intersectionEncodeError(path: Path): TypeError {
  return new TypeError(`invalid intersection encode at ${formatPath(path)}`);
}

/** `unknown` and `any` are the identity of intersection, including an intersection made only of them. */
export function isIntersectionIdentity(struct: RuntimeStruct): boolean {
  const definition = struct[DEFINITION];
  if (definition.kind === "any" || definition.kind === "unknown") {
    return true;
  }
  if (definition.kind !== "intersection") {
    return false;
  }
  for (const option of definition.options) {
    if (!isIntersectionIdentity(option)) {
      return false;
    }
  }
  return true;
}
