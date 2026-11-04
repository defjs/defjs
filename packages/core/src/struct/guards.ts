import { DEFINITION } from "./symbols";
import type { RuntimeStruct, StructDefinition } from "./types";

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

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: keep direct metadata gets; added in checks invoke Proxy has traps and reject values the original guard accepted
  const definition = (value as { [DEFINITION]?: Partial<StructDefinition> })[
    DEFINITION
  ];
  if (typeof definition !== "object" || definition === null) {
    return false;
  }

  if (!KNOWN_KINDS.has(definition.kind)) {
    return false;
  }

  const flags = definition.flags;
  return (
    typeof flags === "object" &&
    flags !== null &&
    typeof flags.nullable === "boolean" &&
    typeof flags.optional === "boolean"
  );
}
