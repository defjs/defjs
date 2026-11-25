import {
  createUniqueNamer,
  toCamelCase,
  toPascalCase,
} from "../../../codegen/naming.ts";
import { isRecord } from "../../../runtime/diagnostics.ts";
import type { CliDiagnostic } from "../../../runtime/types.ts";
import type { SchemaRefMeta } from "../parser/scalar.ts";
import type {
  ObjectFieldIr,
  PrimitiveKind,
  SchemaDeclIr,
  SchemaNode,
} from "./types.ts";

type SchemaMediaContext = "json" | "formData";

export const RESERVED_SCHEMA_NAMES = [
  "Infer",
  "Struct",
  "StructInput",
  "RequestEndpoint",
  "DecodedResponse",
  "HttpMeta",
  "EventStreamEndpoint",
  "Date",
  "Blob",
  "File",
  "Record",
  "NonNullable",
] as const;

interface LowerState {
  readonly schema: SchemaNode;
  readonly references: ReadonlySet<string>;
}

const VALIDATION_KEYWORDS = [
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
] as const;

const HANDLED_FORMATS = new Set(["date-time", "binary"]);

function isBinaryMediaType(mediaType: string): boolean {
  const lower = mediaType.toLowerCase();
  return (
    !lower.startsWith("text/") &&
    lower !== "application/json" &&
    !lower.endsWith("+json")
  );
}

function isBinarySchema(raw: { [key: string]: unknown }): boolean {
  if (raw["format"] === "binary" || raw["contentEncoding"] === "binary") {
    return true;
  }
  return (
    raw["contentEncoding"] === undefined &&
    typeof raw["contentMediaType"] === "string" &&
    isBinaryMediaType(raw["contentMediaType"])
  );
}

function binaryPrimitive(context: SchemaMediaContext): PrimitiveKind {
  return context === "formData" ? "file" : "blob";
}

const STRUCTURAL_SCHEMA_KEYS = [
  "type",
  "properties",
  "additionalProperties",
  "items",
  "prefixItems",
  "enum",
  "const",
  "oneOf",
  "anyOf",
  "allOf",
  "$ref",
] as const;

function asConstraintOnlyUnionBranches(
  raw: { [key: string]: unknown },
  branches: readonly unknown[],
): readonly { [key: string]: unknown }[] | undefined {
  if (!isRecord(raw["properties"])) {
    return undefined;
  }
  const result: { [key: string]: unknown }[] = [];
  for (const branch of branches) {
    if (
      !isRecord(branch) ||
      STRUCTURAL_SCHEMA_KEYS.some((key) => key in branch)
    ) {
      return undefined;
    }
    result.push(branch);
  }
  return result;
}

function readDescription(raw: { [key: string]: unknown }): string | undefined {
  const desc = raw["description"];
  if (typeof desc !== "string") {
    return undefined;
  }
  const trimmed = desc.trim();
  return trimmed === "" ? undefined : trimmed;
}

function extractConstraints(raw: { [key: string]: unknown }): string[] {
  const constraints: string[] = [];
  for (const key of VALIDATION_KEYWORDS) {
    const value = raw[key];
    if (
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      constraints.push(`${key}: ${String(value)}`);
    }
  }
  const format = raw["format"];
  if (typeof format === "string" && !HANDLED_FORMATS.has(format)) {
    constraints.push(`format: ${format}`);
  }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const branches = raw[keyword];
    if (!Array.isArray(branches) || branches.length === 0) {
      continue;
    }
    const constraintBranches = asConstraintOnlyUnionBranches(raw, branches);
    if (constraintBranches === undefined) {
      continue;
    }
    const groups: string[] = [];
    for (const branch of constraintBranches) {
      const req = branch["required"];
      if (Array.isArray(req)) {
        const names = req.filter(
          (entry): entry is string => typeof entry === "string",
        );
        if (names.length > 0) {
          groups.push(names.join(", "));
        }
      }
    }
    if (groups.length > 0) {
      constraints.push(
        `${keyword} required: ${groups.map((g) => `[${g}]`).join(" | ")}`,
      );
    }
  }
  return constraints;
}

function isPrimitiveLiteral(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isNullSchemaObject(raw: { [key: string]: unknown }): boolean {
  if (raw["type"] === "null") {
    return true;
  }
  if ("const" in raw && raw["const"] === null) {
    return true;
  }
  const en = raw["enum"];
  return Array.isArray(en) && en.length === 1 && en[0] === null;
}

function wrapNullable(node: SchemaNode, nullable: boolean): SchemaNode {
  if (!nullable || node.kind === "nullable") {
    return node;
  }
  if (node.kind === "primitive" && node.primitive === "null") {
    return node;
  }
  return { kind: "nullable", inner: node };
}

export function requireSchemaDecl(
  declById: ReadonlyMap<string, SchemaDeclIr>,
  id: string,
): SchemaDeclIr {
  const decl = declById.get(id);
  if (!decl) {
    throw new Error(`Missing schema declaration: ${id}`);
  }
  return decl;
}

function unwrapNullableNode(node: SchemaNode): SchemaNode {
  return node.kind === "nullable" ? node.inner : node;
}

function readDiscriminatorProperty(raw: {
  [key: string]: unknown;
}): string | undefined {
  const disc = raw["discriminator"];
  if (!isRecord(disc)) {
    return undefined;
  }
  const propName = disc["propertyName"];
  return typeof propName === "string" && propName !== "" ? propName : undefined;
}

export class SchemaRegistry {
  readonly diagnostics: CliDiagnostic[] = [];
  private readonly refMeta: WeakMap<object, SchemaRefMeta>;
  private readonly uniqueSchemaName = createUniqueNamer(RESERVED_SCHEMA_NAMES);
  private readonly declByKey = new Map<string | object, SchemaDeclIr>();
  private readonly declById = new Map<string, SchemaDeclIr>();
  private readonly declOrder: SchemaDeclIr[] = [];
  private readonly activeDepthByKey = new Map<string | object, number>();
  private readonly recursiveCycleIds = new Set<string>();
  private readonly warnedNonObjectCycles = new Set<string | object>();

  constructor(refMeta: WeakMap<object, SchemaRefMeta>) {
    this.refMeta = refMeta;
  }

  hasSchema(obj: object): boolean {
    const key: string | object = this.refMeta.get(obj)?.key ?? obj;
    return this.declByKey.has(key);
  }

  getSchemaById(id: string): SchemaDeclIr {
    return requireSchemaDecl(this.declById, id);
  }

  allDecls(): readonly SchemaDeclIr[] {
    return this.declOrder;
  }

  lowerSchema(raw: unknown, context: SchemaMediaContext): SchemaNode {
    const refs = new Set<string>();
    return this.lowerNode(raw, context, 0, refs, true).schema;
  }

  ensureNamedSchema(
    raw: { [key: string]: unknown },
    preferredName: string,
    objectFieldDepth = 0,
  ): SchemaDeclIr {
    const meta = this.refMeta.get(raw);
    const key: string | object = meta ? meta.key : raw;
    const existing = this.declByKey.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const baseName = toPascalCase(meta ? meta.name : preferredName, "Schema");
    const id = this.uniqueSchemaName(baseName);
    const refs = new Set<string>();

    const placeholder: SchemaDeclIr = {
      id,
      name: id,
      fileKey: "shared",
      schema: { kind: "primitive", primitive: "unknown" },
      description: readDescription(raw),
      constraints: extractConstraints(raw),
      recursive: false,
      references: refs,
      role: "default",
    };

    this.declByKey.set(key, placeholder);
    this.declById.set(id, placeholder);
    this.activeDepthByKey.set(key, objectFieldDepth);

    const lowered = this.lowerUnwrappedObject(
      raw,
      "json",
      objectFieldDepth,
      refs,
    );

    this.activeDepthByKey.delete(key);

    const finalized: SchemaDeclIr = {
      ...placeholder,
      schema: lowered.schema,
      recursive: this.recursiveCycleIds.has(id) || refs.has(id),
    };
    this.declByKey.set(key, finalized);
    this.declById.set(id, finalized);
    // Append post-order so non-recursive dependencies emit before their parents (avoiding TDZ).
    this.declOrder.push(finalized);
    return finalized;
  }

  registerSynthesizedSchema(
    schema: SchemaNode,
    preferredName: string,
    role: "default" | "input" = "default",
  ): SchemaDeclIr {
    const baseName = toPascalCase(preferredName, "Schema");
    const id = this.uniqueSchemaName(baseName);
    const decl: SchemaDeclIr = {
      id,
      name: id,
      fileKey: "shared",
      schema,
      constraints: [],
      recursive: false,
      references: collectNodeRefIds(schema),
      role,
    };
    this.declById.set(id, decl);
    // Append post-order after all inner referenced dependencies are registered.
    this.declOrder.push(decl);
    return decl;
  }

  computeSccs(): void {
    interface TarjanState {
      index: number;
      lowlink: number;
      onStack: boolean;
    }
    const states = new Map<string, TarjanState>();
    const stack: { id: string; state: TarjanState }[] = [];
    let nextIndex = 0;

    const strongConnect = (id: string) => {
      const state: TarjanState = {
        index: nextIndex,
        lowlink: nextIndex,
        onStack: true,
      };
      nextIndex += 1;
      states.set(id, state);
      stack.push({ id, state });

      const decl = requireSchemaDecl(this.declById, id);
      for (const dep of decl.references) {
        const depState = states.get(dep);
        if (!depState) {
          const child = strongConnect(dep);
          if (child.lowlink < state.lowlink) {
            state.lowlink = child.lowlink;
          }
        } else if (depState.onStack && depState.index < state.lowlink) {
          state.lowlink = depState.index;
        }
      }

      if (state.lowlink === state.index) {
        const scc: string[] = [];
        for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
          top.state.onStack = false;
          scc.push(top.id);
          if (top.id === id) {
            break;
          }
        }
        if (scc.length > 1 || decl.references.has(id)) {
          this.markSccRecursive(new Set(scc));
        }
      }
      return state;
    };

    for (const decl of this.declOrder) {
      if (!states.has(decl.id)) {
        strongConnect(decl.id);
      }
    }
    this.sortDeclOrderByEagerDeps();
  }

  private sortDeclOrderByEagerDeps(): void {
    const ordered: SchemaDeclIr[] = [];
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) {
        return;
      }
      visited.add(id);
      const decl = requireSchemaDecl(this.declById, id);
      for (const depId of collectEagerRefIds(decl.schema)) {
        visit(depId);
      }
      ordered.push(decl);
    };
    for (const decl of this.declOrder) {
      visit(decl.id);
    }
    this.declOrder.splice(0, this.declOrder.length, ...ordered);
  }

  private markSccRecursive(sccIds: ReadonlySet<string>): void {
    for (const id of sccIds) {
      const decl = requireSchemaDecl(this.declById, id);
      const updatedSchema = this.markGettersForScc(decl.schema, sccIds);
      const updated: SchemaDeclIr = {
        ...decl,
        recursive: true,
        schema: updatedSchema,
      };
      this.declById.set(id, updated);
      const idx = this.declOrder.findIndex((item) => item.id === id);
      this.declOrder[idx] = updated;
    }
  }

  private markGettersForScc(
    node: SchemaNode,
    sccIds: ReadonlySet<string>,
  ): SchemaNode {
    switch (node.kind) {
      case "object":
        return {
          kind: "object",
          fields: node.fields.map((field) => {
            const updatedSchema = this.markGettersForScc(field.schema, sccIds);
            const refs = collectNodeRefIds(updatedSchema);
            let reachesScc = false;
            for (const refId of refs) {
              if (sccIds.has(refId)) {
                reachesScc = true;
                break;
              }
            }
            return {
              ...field,
              schema: updatedSchema,
              lazyGetter: field.lazyGetter || reachesScc,
            };
          }),
        };
      case "nullable":
        return {
          kind: "nullable",
          inner: this.markGettersForScc(node.inner, sccIds),
        };
      case "array":
        return {
          kind: "array",
          item: this.markGettersForScc(node.item, sccIds),
        };
      case "tuple":
        return {
          kind: "tuple",
          items: node.items.map((item) => this.markGettersForScc(item, sccIds)),
        };
      case "record":
        return {
          kind: "record",
          value: this.markGettersForScc(node.value, sccIds),
        };
      case "or":
        return {
          kind: "or",
          options: node.options.map((opt) =>
            this.markGettersForScc(opt, sccIds),
          ),
        };
      case "discriminatedUnion":
        return {
          kind: "discriminatedUnion",
          tag: node.tag,
          options: node.options.map((opt) =>
            this.markGettersForScc(opt, sccIds),
          ),
        };
      case "intersection":
        return {
          kind: "intersection",
          members: node.members.map((member) =>
            this.markGettersForScc(member, sccIds),
          ),
        };
      default:
        return node;
    }
  }

  private lowerNode(
    raw: unknown,
    context: SchemaMediaContext,
    objectFieldDepth: number,
    refs: Set<string>,
    allowNamedRef: boolean,
  ): LowerState {
    if (!isRecord(raw)) {
      return {
        schema: { kind: "primitive", primitive: "unknown" },
        references: refs,
      };
    }

    const meta = this.refMeta.get(raw);
    const key: string | object = meta ? meta.key : raw;

    const entryDepth = this.activeDepthByKey.get(key);
    if (entryDepth !== undefined) {
      const activeDecl = this.declByKey.get(key);
      if (activeDecl !== undefined && objectFieldDepth > entryDepth) {
        this.recursiveCycleIds.add(activeDecl.id);
        refs.add(activeDecl.id);
        return {
          schema: {
            kind: "ref",
            id: activeDecl.id,
            name: activeDecl.name,
          },
          references: refs,
        };
      }
      if (!this.warnedNonObjectCycles.has(key)) {
        this.warnedNonObjectCycles.add(key);
        this.diagnostics.push({
          code: "CLI_UNSUPPORTED_NON_OBJECT_CYCLE",
          severity: "warning",
          message:
            "Circular schema cycle does not pass through an object property getter; breaking cycle with struct.unknown()",
          location: activeDecl?.name,
        });
      }
      return {
        schema: { kind: "primitive", primitive: "unknown" },
        references: refs,
      };
    }

    if (allowNamedRef && context === "json" && meta !== undefined) {
      const decl = this.ensureNamedSchema(raw, meta.name, objectFieldDepth);
      refs.add(decl.id);
      return {
        schema: { kind: "ref", id: decl.id, name: decl.name },
        references: refs,
      };
    }

    this.activeDepthByKey.set(key, objectFieldDepth);
    const lowered = this.lowerUnwrappedObject(
      raw,
      context,
      objectFieldDepth,
      refs,
    );
    this.activeDepthByKey.delete(key);
    return lowered;
  }

  private lowerUnwrappedObject(
    raw: { [key: string]: unknown },
    context: SchemaMediaContext,
    objectFieldDepth: number,
    refs: Set<string>,
  ): LowerState {
    const nullableFlag = raw["nullable"] === true || raw["x-nullable"] === true;

    if ("const" in raw) {
      const constVal = raw["const"];
      if (isPrimitiveLiteral(constVal)) {
        return {
          schema: wrapNullable(
            { kind: "literal", value: constVal },
            nullableFlag,
          ),
          references: refs,
        };
      }
    }

    const enumRaw = raw["enum"];
    if (Array.isArray(enumRaw) && enumRaw.length > 0) {
      return {
        schema: this.lowerEnum(enumRaw, nullableFlag),
        references: refs,
      };
    }

    const oneOfRaw = raw["oneOf"];
    if (
      Array.isArray(oneOfRaw) &&
      oneOfRaw.length > 0 &&
      asConstraintOnlyUnionBranches(raw, oneOfRaw) === undefined
    ) {
      return this.lowerUnion(
        oneOfRaw,
        readDiscriminatorProperty(raw),
        nullableFlag,
        context,
        objectFieldDepth,
        refs,
      );
    }

    const anyOfRaw = raw["anyOf"];
    if (
      Array.isArray(anyOfRaw) &&
      anyOfRaw.length > 0 &&
      asConstraintOnlyUnionBranches(raw, anyOfRaw) === undefined
    ) {
      return this.lowerUnion(
        anyOfRaw,
        readDiscriminatorProperty(raw),
        nullableFlag,
        context,
        objectFieldDepth,
        refs,
      );
    }

    const allOfRaw = raw["allOf"];
    if (Array.isArray(allOfRaw) && allOfRaw.length > 0) {
      const members = allOfRaw.map(
        (member) =>
          this.lowerNode(member, context, objectFieldDepth, refs, true).schema,
      );
      const base: SchemaNode =
        members.length === 1 && members[0] !== undefined
          ? members[0]
          : { kind: "intersection", members };
      return {
        schema: wrapNullable(base, nullableFlag),
        references: refs,
      };
    }

    const rawType = raw["type"];
    if (Array.isArray(rawType)) {
      const nonNull = rawType.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry !== "null",
      );
      const hasNull = nullableFlag || rawType.includes("null");
      if (nonNull.length === 0) {
        return {
          schema: { kind: "primitive", primitive: "null" },
          references: refs,
        };
      }
      if (nonNull.length === 1 && nonNull[0] !== undefined) {
        const inner = this.lowerByType(
          nonNull[0],
          raw,
          context,
          objectFieldDepth,
          refs,
        );
        return {
          schema: wrapNullable(inner, hasNull),
          references: refs,
        };
      }
      const variants = nonNull.map((t) =>
        this.lowerByType(t, raw, context, objectFieldDepth, refs),
      );
      return {
        schema: wrapNullable({ kind: "or", options: variants }, hasNull),
        references: refs,
      };
    }

    const inferredType =
      typeof rawType === "string" ? rawType : this.inferTypeFromShape(raw);
    if (inferredType === undefined) {
      return {
        schema: wrapNullable(
          {
            kind: "primitive",
            primitive: isBinarySchema(raw)
              ? binaryPrimitive(context)
              : "unknown",
          },
          nullableFlag,
        ),
        references: refs,
      };
    }
    const base = this.lowerByType(
      inferredType,
      raw,
      context,
      objectFieldDepth,
      refs,
    );
    return {
      schema: wrapNullable(base, nullableFlag),
      references: refs,
    };
  }

  private inferTypeFromShape(raw: {
    [key: string]: unknown;
  }): string | undefined {
    if (isRecord(raw["properties"]) || "additionalProperties" in raw) {
      return "object";
    }
    if ("items" in raw || Array.isArray(raw["prefixItems"])) {
      return "array";
    }
    return undefined;
  }

  private lowerEnum(
    values: readonly unknown[],
    nullableFlag: boolean,
  ): SchemaNode {
    const hasNull = nullableFlag || values.includes(null);
    const nonNull = [...new Set(values.filter((v) => v !== null))];
    if (nonNull.length === 0) {
      return { kind: "primitive", primitive: "null" };
    }
    if (nonNull.every((v): v is string => typeof v === "string")) {
      if (nonNull.length === 1 && nonNull[0] !== undefined) {
        return wrapNullable({ kind: "literal", value: nonNull[0] }, hasNull);
      }
      return wrapNullable({ kind: "enum", values: nonNull }, hasNull);
    }
    const literals: SchemaNode[] = [];
    for (const entry of nonNull) {
      if (!isPrimitiveLiteral(entry)) {
        return wrapNullable(
          { kind: "primitive", primitive: "unknown" },
          hasNull,
        );
      }
      literals.push({ kind: "literal", value: entry });
    }
    if (literals.length === 1 && literals[0] !== undefined) {
      return wrapNullable(literals[0], hasNull);
    }
    return wrapNullable({ kind: "or", options: literals }, hasNull);
  }

  private lowerUnion(
    branches: readonly unknown[],
    discriminatorProp: string | undefined,
    nullableFlag: boolean,
    context: SchemaMediaContext,
    objectFieldDepth: number,
    refs: Set<string>,
  ): LowerState {
    let hasNull = nullableFlag;
    const nonNullBranches: unknown[] = [];
    for (const branch of branches) {
      if (isRecord(branch) && isNullSchemaObject(branch)) {
        hasNull = true;
      } else {
        nonNullBranches.push(branch);
      }
    }

    if (nonNullBranches.length === 0) {
      return {
        schema: { kind: "primitive", primitive: "null" },
        references: refs,
      };
    }

    const loweredOptions = nonNullBranches.map(
      (branch) =>
        this.lowerNode(branch, context, objectFieldDepth, refs, true).schema,
    );

    if (loweredOptions.length === 1 && loweredOptions[0] !== undefined) {
      return {
        schema: wrapNullable(loweredOptions[0], hasNull),
        references: refs,
      };
    }

    if (
      discriminatorProp !== undefined &&
      this.canUseDiscriminatedUnion(discriminatorProp, loweredOptions)
    ) {
      return {
        schema: wrapNullable(
          {
            kind: "discriminatedUnion",
            tag: discriminatorProp,
            options: loweredOptions,
          },
          hasNull,
        ),
        references: refs,
      };
    }

    return {
      schema: wrapNullable({ kind: "or", options: loweredOptions }, hasNull),
      references: refs,
    };
  }

  private canUseDiscriminatedUnion(
    tagWireName: string,
    options: readonly SchemaNode[],
  ): boolean {
    const seenValues = new Set<string | number | boolean | null>();
    for (const opt of options) {
      const resolved = this.resolveNonRecursiveObject(opt);
      if (!resolved) {
        return false;
      }
      const field = resolved.fields.find(
        (candidate) =>
          candidate.wireName === tagWireName ||
          candidate.propName === tagWireName,
      );
      if (!field || !field.required || field.nullable) {
        return false;
      }
      if (field.schema.kind !== "literal") {
        return false;
      }
      if (seenValues.has(field.schema.value)) {
        return false;
      }
      seenValues.add(field.schema.value);
    }
    return true;
  }

  resolveNonRecursiveObject(
    node: SchemaNode,
  ): Extract<SchemaNode, { kind: "object" }> | undefined {
    if (node.kind === "object") {
      return node;
    }
    if (node.kind === "ref") {
      const decl = requireSchemaDecl(this.declById, node.id);
      if (decl.recursive || decl.schema.kind !== "object") {
        return undefined;
      }
      return decl.schema;
    }
    return undefined;
  }

  private lowerByType(
    typeName: string,
    raw: { [key: string]: unknown },
    context: SchemaMediaContext,
    objectFieldDepth: number,
    refs: Set<string>,
  ): SchemaNode {
    switch (typeName) {
      case "string": {
        if (isBinarySchema(raw)) {
          return {
            kind: "primitive",
            primitive: binaryPrimitive(context),
          };
        }
        if (raw["format"] === "date-time") {
          return { kind: "primitive", primitive: "date" };
        }
        return { kind: "primitive", primitive: "string" };
      }
      case "number":
      case "integer":
        return { kind: "primitive", primitive: "number" };
      case "boolean":
        return { kind: "primitive", primitive: "boolean" };
      case "null":
        return { kind: "primitive", primitive: "null" };
      case "file":
        return {
          kind: "primitive",
          primitive: binaryPrimitive(context),
        };
      case "array":
        return this.lowerArray(raw, context, objectFieldDepth, refs);
      case "object":
        return this.lowerObject(raw, context, objectFieldDepth, refs);
      default:
        return { kind: "primitive", primitive: "unknown" };
    }
  }

  private lowerArray(
    raw: { [key: string]: unknown },
    context: SchemaMediaContext,
    objectFieldDepth: number,
    refs: Set<string>,
  ): SchemaNode {
    const prefixItems = raw["prefixItems"];
    const hasExtraItems = "items" in raw && raw["items"] !== false;
    if (
      Array.isArray(prefixItems) &&
      prefixItems.length > 0 &&
      !hasExtraItems
    ) {
      const items = prefixItems.map(
        (item) =>
          this.lowerNode(item, context, objectFieldDepth, refs, true).schema,
      );
      return { kind: "tuple", items };
    }
    if (isRecord(raw["items"])) {
      const item = this.lowerNode(
        raw["items"],
        context,
        objectFieldDepth,
        refs,
        true,
      ).schema;
      return { kind: "array", item };
    }
    return {
      kind: "array",
      item: { kind: "primitive", primitive: "unknown" },
    };
  }

  lowerObjectFields(
    raw: { [key: string]: unknown },
    context: SchemaMediaContext,
    refs: Set<string>,
    objectFieldDepth = 0,
  ): ObjectFieldIr[] {
    const properties = raw["properties"];
    if (!isRecord(properties)) {
      return [];
    }
    const requiredSet = new Set<string>();
    const reqList = raw["required"];
    if (Array.isArray(reqList)) {
      for (const item of reqList) {
        if (typeof item === "string") {
          requiredSet.add(item);
        }
      }
    }

    const fieldNamer = createUniqueNamer();
    const fields: ObjectFieldIr[] = [];
    for (const [wireName, propSchema] of Object.entries(properties)) {
      const propName = fieldNamer(toCamelCase(wireName, "field"));
      const required = requiredSet.has(wireName);
      const loweredProp = this.lowerNode(
        propSchema,
        context,
        objectFieldDepth + 1,
        refs,
        true,
      ).schema;
      const isNullable = loweredProp.kind === "nullable";
      const innerSchema = unwrapNullableNode(loweredProp);
      const propObj = isRecord(propSchema) ? propSchema : {};

      fields.push({
        propName,
        wireName,
        schema: innerSchema,
        required,
        nullable: isNullable,
        description: readDescription(propObj),
        constraints: extractConstraints(propObj),
        lazyGetter: false,
      });
    }
    return fields;
  }

  private lowerObject(
    raw: { [key: string]: unknown },
    context: SchemaMediaContext,
    objectFieldDepth: number,
    refs: Set<string>,
  ): SchemaNode {
    const properties = raw["properties"];
    if (isRecord(properties)) {
      return {
        kind: "object",
        fields: this.lowerObjectFields(raw, context, refs, objectFieldDepth),
      };
    }

    const additional = raw["additionalProperties"];
    if (isRecord(additional)) {
      const valueSchema = this.lowerNode(
        additional,
        context,
        objectFieldDepth,
        refs,
        true,
      ).schema;
      return { kind: "record", value: valueSchema };
    }

    return {
      kind: "record",
      value: { kind: "primitive", primitive: "unknown" },
    };
  }
}

function collectEagerRefIds(
  node: SchemaNode,
  into = new Set<string>(),
): Set<string> {
  switch (node.kind) {
    case "ref":
      into.add(node.id);
      return into;
    case "array":
      return collectEagerRefIds(node.item, into);
    case "record":
      return collectEagerRefIds(node.value, into);
    case "nullable":
      return collectEagerRefIds(node.inner, into);
    case "tuple":
      for (const item of node.items) collectEagerRefIds(item, into);
      return into;
    case "object":
    case "form":
      for (const field of node.fields) {
        if (!field.lazyGetter) {
          collectEagerRefIds(field.schema, into);
        }
      }
      return into;
    case "or":
    case "discriminatedUnion":
      for (const opt of node.options) collectEagerRefIds(opt, into);
      return into;
    case "intersection":
      for (const member of node.members) collectEagerRefIds(member, into);
      return into;
    default:
      return into;
  }
}

export function collectNodeRefIds(
  node: SchemaNode,
  into = new Set<string>(),
): Set<string> {
  switch (node.kind) {
    case "ref":
      into.add(node.id);
      return into;
    case "array":
      return collectNodeRefIds(node.item, into);
    case "record":
      return collectNodeRefIds(node.value, into);
    case "nullable":
      return collectNodeRefIds(node.inner, into);
    case "tuple":
      for (const item of node.items) collectNodeRefIds(item, into);
      return into;
    case "object":
    case "form":
      for (const field of node.fields) collectNodeRefIds(field.schema, into);
      return into;
    case "or":
    case "discriminatedUnion":
      for (const opt of node.options) collectNodeRefIds(opt, into);
      return into;
    case "intersection":
      for (const member of node.members) collectNodeRefIds(member, into);
      return into;
    default:
      return into;
  }
}
