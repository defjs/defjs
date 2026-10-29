import { DEFINITION } from "./symbols";
import type { AnyStruct, StructDefinition } from "./types";

const KNOWN_KINDS = new Set<StructDefinition["kind"]>([
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

export function isStruct(value: unknown): value is AnyStruct {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.hasOwn(value, DEFINITION)
  ) {
    return false;
  }

  const definition = (value as { [DEFINITION]?: Partial<StructDefinition> })[
    DEFINITION
  ];
  if (typeof definition !== "object" || definition === null) {
    return false;
  }

  if (!KNOWN_KINDS.has(definition.kind as StructDefinition["kind"])) {
    return false;
  }

  const flags = definition.flags as
    { nullable?: unknown; optional?: unknown } | undefined;
  return (
    typeof flags === "object" &&
    flags !== null &&
    typeof flags.nullable === "boolean" &&
    typeof flags.optional === "boolean"
  );
}
