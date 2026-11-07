import { DEFINITION } from "./symbols";
import type { ObjectRuntimeStruct, RuntimeStruct } from "./types";

const KNOWN_KINDS = new Set<unknown>([
  "any",
  "array",
  "arrayBuffer",
  "bigint",
  "blob",
  "boolean",
  "date",
  "discriminatedUnion",
  "enum",
  "file",
  "intersection",
  "literal",
  "null",
  "number",
  "object",
  "or",
  "record",
  "string",
  "tuple",
  "unknown",
]);

export function isStruct(value: unknown): value is RuntimeStruct {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.hasOwn(value, DEFINITION)
  ) {
    return false;
  }

  // Reflect.get is one ordinary [[Get]] per field, in the same order as property reads. An `in` check
  // would also call a proxy's has trap and could reject a value these reads accept.
  const definition: unknown = Reflect.get(value, DEFINITION);
  if (typeof definition !== "object" || definition === null) {
    return false;
  }

  if (!KNOWN_KINDS.has(Reflect.get(definition, "kind"))) {
    return false;
  }

  const flags: unknown = Reflect.get(definition, "flags");
  return (
    typeof flags === "object" &&
    flags !== null &&
    typeof Reflect.get(flags, "nullable") === "boolean" &&
    typeof Reflect.get(flags, "optional") === "boolean"
  );
}

export function isObjectRuntimeStruct(
  struct: RuntimeStruct,
): struct is ObjectRuntimeStruct {
  return struct[DEFINITION].kind === "object";
}
