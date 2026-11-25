import { createUniqueNamer } from "../../../codegen/naming.ts";
import { isRecord } from "../../../runtime/diagnostics.ts";
import type { SchemaRefMeta } from "../parser/scalar.ts";
import { collectOperationRefIds, lowerOperations } from "./operation.ts";
import { requireSchemaDecl, SchemaRegistry } from "./schema.ts";
import type {
  LoweredBundle,
  LoweringOptions,
  OperationIr,
  SchemaDeclIr,
} from "./types.ts";

function assignSchemaFileKeys(
  decls: readonly SchemaDeclIr[],
  operations: readonly OperationIr[],
): readonly SchemaDeclIr[] {
  const declById = new Map<string, SchemaDeclIr>();
  const groupsById = new Map<string, Set<string>>();
  for (const decl of decls) {
    declById.set(decl.id, decl);
    groupsById.set(decl.id, new Set());
  }

  const visitDep = (schemaId: string, group: string, visited: Set<string>) => {
    if (visited.has(schemaId)) {
      return;
    }
    visited.add(schemaId);
    groupsById.get(schemaId)?.add(group);
    const decl = requireSchemaDecl(declById, schemaId);
    for (const depId of decl.references) {
      visitDep(depId, group, visited);
    }
  };

  const activeGroups = new Set<string>();
  for (const op of operations) {
    activeGroups.add(op.group);
    const directRefs = collectOperationRefIds(op);
    const visited = new Set<string>();
    for (const refId of directRefs) {
      visitDep(refId, op.group, visited);
    }
  }

  const reservedKeys = new Set<string>(["index", "shared"]);
  for (const group of activeGroups) {
    if (group !== "index") {
      reservedKeys.add(group);
    }
  }
  const keyNamer = createUniqueNamer(reservedKeys);
  const indexFileKey = keyNamer("index-schemas");

  return decls.map((decl) => {
    const groups = groupsById.get(decl.id);
    let fileKey = "shared";
    if (groups && groups.size === 1) {
      for (const onlyGroup of groups) {
        fileKey = onlyGroup === "index" ? indexFileKey : onlyGroup;
      }
    }
    return { ...decl, fileKey };
  });
}

export function lowerOpenApiDocument(
  doc: { [key: string]: unknown },
  refMeta: WeakMap<object, SchemaRefMeta>,
  options: LoweringOptions,
): LoweredBundle {
  const registry = new SchemaRegistry(refMeta);

  // Lower operations first so used schemas acquire their preferred naming and group usage,
  // then materialize any remaining unreferenced components.schemas entries into schema/shared.
  const { operations, diagnostics: opDiagnostics } = lowerOperations(
    doc,
    registry,
    options,
  );

  const registerUnseenSchemas = (container: unknown) => {
    if (!isRecord(container)) {
      return;
    }
    for (const [name, schemaRaw] of Object.entries(container)) {
      if (isRecord(schemaRaw) && !registry.hasSchema(schemaRaw)) {
        registry.ensureNamedSchema(schemaRaw, name);
      }
    }
  };

  const components = doc["components"];
  if (isRecord(components)) {
    registerUnseenSchemas(components["schemas"]);
  }
  registerUnseenSchemas(doc["definitions"]);

  registry.computeSccs();

  const schemas = assignSchemaFileKeys(registry.allDecls(), operations);
  const groups = [...new Set(operations.map((op) => op.group))].sort();

  return {
    schemas,
    operations,
    groups,
    diagnostics: [...registry.diagnostics, ...opDiagnostics],
  };
}
