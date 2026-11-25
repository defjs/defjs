import { type GeneratedFile, headerForMode } from "../../../codegen/fs_sync.ts";
import { createUniqueNamer } from "../../../codegen/naming.ts";
import {
  arrExpr,
  arrayType,
  arrowFn,
  binaryExpr,
  block,
  callExpr,
  condExpr,
  constDecl,
  emptyExport,
  exportAll,
  exportTypeAlias,
  exprStmt,
  getterProp,
  id,
  ifStmt,
  importNamed,
  indexSigType,
  intersectionType,
  kwType,
  literalExpr,
  literalType,
  markPure,
  newExpr,
  objExpr,
  printPlannedAstFiles,
  propAccess,
  propAssign,
  propSig,
  retStmt,
  shorthandProp,
  str,
  tupleType,
  typeLit,
  typeQuery,
  typeRef,
  unionType,
  type AstExpression,
  type AstObjectMember,
  type AstStatement,
  type AstTypeNode,
  type PlannedAstFile,
} from "../../../codegen/ts_ast.ts";
import { collectOperationRefIds } from "../ir/operation.ts";
import { requireSchemaDecl, RESERVED_SCHEMA_NAMES } from "../ir/schema.ts";
import type {
  BuilderPlanIr,
  HeaderParamPlanIr,
  HttpOperationIr,
  LoweredBundle,
  ObjectFieldIr,
  OperationIr,
  PathParamPlanIr,
  PrimitiveKind,
  QueryFieldPlanIr,
  SchemaDeclIr,
  SchemaNode,
  SseOperationIr,
} from "../ir/types.ts";
import type { OpenApiGenerationMode, OpenApiOutputFormat } from "../types.ts";
import {
  collectBundleUtilHelpers,
  renderOpenApiUtilCode,
} from "./util_helpers.ts";

function extForFormat(format: OpenApiOutputFormat): string {
  switch (format) {
    case "tsx":
      return ".tsx";
    case "js":
      return ".js";
    case "mjs":
      return ".mjs";
    default:
      return ".ts";
  }
}

export function dtsExtForFormat(
  format: OpenApiOutputFormat,
): ".d.ts" | ".d.mts" | undefined {
  switch (format) {
    case "js":
      return ".d.ts";
    case "mjs":
      return ".d.mts";
    default:
      return undefined;
  }
}

export function importExtForFormat(format: OpenApiOutputFormat): string {
  switch (format) {
    case "js":
      return ".js";
    case "mjs":
      return ".mjs";
    default:
      return "";
  }
}

function isTypeScriptFormat(format: OpenApiOutputFormat): boolean {
  return format === "ts" || format === "tsx";
}

function fieldDocLines(field: ObjectFieldIr): string[] {
  const lines: string[] = [];
  if (field.description !== undefined) {
    lines.push(field.description);
  }
  if (field.constraints.length > 0) {
    lines.push(`@remarks OpenAPI constraints: ${field.constraints.join(", ")}`);
  }
  return lines;
}

export function declDocLines(decl: SchemaDeclIr): string[] {
  const lines: string[] = [];
  if (decl.description !== undefined) {
    lines.push(decl.description);
  }
  if (decl.constraints.length > 0) {
    lines.push(`@remarks OpenAPI constraints: ${decl.constraints.join(", ")}`);
  }
  return lines;
}

export function opDocLines(op: OperationIr): string[] {
  const lines: string[] = [];
  if (op.description !== undefined) {
    lines.push(op.description);
  }
  if (op.kind === "http" && op.mixed2xxNote !== undefined) {
    lines.push(`@remarks ${op.mixed2xxNote}`);
  }
  return lines;
}

function buildPrimitiveExpr(kind: PrimitiveKind): AstExpression {
  let method: string;
  switch (kind) {
    case "string":
      method = "string";
      break;
    case "number":
      method = "number";
      break;
    case "boolean":
      method = "boolean";
      break;
    case "date":
      method = "date";
      break;
    case "null":
      method = "null";
      break;
    case "blob":
      method = "blob";
      break;
    case "file":
      method = "file";
      break;
    default:
      method = "unknown";
      break;
  }
  return markPure(callExpr(propAccess(id("struct"), method)));
}

function makeNullableType(inner: AstTypeNode): AstTypeNode {
  if (inner.kind === "keywordType" && inner.keyword === "unknown") {
    return inner;
  }
  return unionType([inner, literalType(null)]);
}

export function buildTsTypeNode(
  node: SchemaNode,
  divergingInputNames: ReadonlyMap<string, string>,
  mode: "input" | "output",
): AstTypeNode {
  switch (node.kind) {
    case "primitive":
      switch (node.primitive) {
        case "string":
          return kwType("string");
        case "number":
          return kwType("number");
        case "boolean":
          return kwType("boolean");
        case "date":
          return mode === "input"
            ? unionType([typeRef("Date"), kwType("number"), kwType("string")])
            : typeRef("Date");
        case "null":
          return literalType(null);
        case "blob":
          return typeRef("Blob");
        case "file":
          return typeRef("File");
        default:
          return mode === "input"
            ? typeRef("NonNullable", [kwType("unknown")])
            : kwType("unknown");
      }
    case "literal":
      return literalType(node.value);
    case "enum":
      return unionType(node.values.map((v) => literalType(v)));
    case "array":
      return arrayType(buildTsTypeNode(node.item, divergingInputNames, mode));
    case "tuple":
      return tupleType(
        node.items.map((item) =>
          buildTsTypeNode(item, divergingInputNames, mode),
        ),
      );
    case "record":
      return indexSigType(
        "key",
        buildTsTypeNode(node.value, divergingInputNames, mode),
      );
    case "object":
    case "form": {
      if (node.fields.length === 0) {
        return indexSigType("key", kwType("never"));
      }
      const members = node.fields.map((field) => {
        const inner = buildTsTypeNode(field.schema, divergingInputNames, mode);
        const type = field.nullable ? makeNullableType(inner) : inner;
        return propSig(
          field.propName,
          type,
          !field.required,
          fieldDocLines(field),
        );
      });
      return typeLit(members);
    }
    case "or":
    case "discriminatedUnion":
      return unionType(
        node.options.map((opt) =>
          buildTsTypeNode(opt, divergingInputNames, mode),
        ),
      );
    case "intersection":
      return intersectionType(
        node.members.map((m) => buildTsTypeNode(m, divergingInputNames, mode)),
      );
    case "nullable":
      return makeNullableType(
        buildTsTypeNode(node.inner, divergingInputNames, mode),
      );
    case "ref": {
      const inputName = divergingInputNames.get(node.id);
      return typeRef(
        mode === "input" && inputName !== undefined ? inputName : node.name,
      );
    }
  }
}

export interface DivergingSchemaInfo {
  readonly divergingIds: ReadonlySet<string>;
  readonly inputTypeNames: ReadonlyMap<string, string>;
}

function computeDivergingSchemaIds(
  decls: readonly SchemaDeclIr[],
): Set<string> {
  const diverging = new Set<string>();
  const nodeHasDivergence = (node: SchemaNode): boolean => {
    switch (node.kind) {
      case "primitive":
        return node.primitive === "date" || node.primitive === "unknown";
      case "array":
        return nodeHasDivergence(node.item);
      case "record":
        return nodeHasDivergence(node.value);
      case "nullable":
        return nodeHasDivergence(node.inner);
      case "tuple":
        return node.items.some(nodeHasDivergence);
      case "object":
      case "form":
        return node.fields.some((f) => nodeHasDivergence(f.schema));
      case "or":
      case "discriminatedUnion":
        return node.options.some(nodeHasDivergence);
      case "intersection":
        return node.members.some(nodeHasDivergence);
      case "ref":
        return diverging.has(node.id);
      default:
        return false;
    }
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const decl of decls) {
      if (!diverging.has(decl.id) && nodeHasDivergence(decl.schema)) {
        diverging.add(decl.id);
        changed = true;
      }
    }
  }
  return diverging;
}

export function computeDivergingSchemaInfo(
  decls: readonly SchemaDeclIr[],
): DivergingSchemaInfo {
  const divergingIds = computeDivergingSchemaIds(decls);
  const namer = createUniqueNamer([
    ...RESERVED_SCHEMA_NAMES,
    ...decls.map((decl) => decl.name),
  ]);
  const inputTypeNames = new Map<string, string>();
  for (const decl of decls) {
    if (divergingIds.has(decl.id) && decl.role !== "input") {
      inputTypeNames.set(decl.id, namer(`${decl.name}Input`));
    }
  }
  return { divergingIds, inputTypeNames };
}

function buildObjectFieldsExpr(
  fields: readonly ObjectFieldIr[],
): AstExpression {
  if (fields.length === 0) {
    return objExpr([], false);
  }
  const props = fields.map((field) => {
    let expr = buildSchemaExpr(field.schema);
    if (field.wireName !== field.propName) {
      expr = markPure(
        callExpr(propAccess(expr, "alias"), [str(field.wireName)]),
      );
    }
    if (field.nullable && !field.required) {
      expr = markPure(callExpr(propAccess(expr, "nullish")));
    } else if (field.nullable) {
      expr = markPure(callExpr(propAccess(expr, "nullable")));
    } else if (!field.required) {
      expr = markPure(callExpr(propAccess(expr, "optional")));
    }
    const docs = fieldDocLines(field);
    if (field.lazyGetter) {
      return getterProp(id(field.propName), expr, docs);
    }
    return propAssign(id(field.propName), expr, docs);
  });
  return objExpr(props, true);
}

function buildSchemaExpr(node: SchemaNode): AstExpression {
  switch (node.kind) {
    case "primitive":
      return buildPrimitiveExpr(node.primitive);
    case "literal":
      return markPure(
        callExpr(propAccess(id("struct"), "literal"), [
          literalExpr(node.value),
        ]),
      );
    case "enum":
      return markPure(
        callExpr(propAccess(id("struct"), "enum"), [
          arrExpr(node.values.map(str)),
        ]),
      );
    case "array":
      return markPure(
        callExpr(propAccess(id("struct"), "array"), [
          buildSchemaExpr(node.item),
        ]),
      );
    case "tuple":
      return markPure(
        callExpr(propAccess(id("struct"), "tuple"), [
          arrExpr(node.items.map(buildSchemaExpr), true),
        ]),
      );
    case "record":
      return markPure(
        callExpr(propAccess(id("struct"), "record"), [
          buildSchemaExpr(node.value),
        ]),
      );
    case "object":
      return markPure(
        callExpr(propAccess(id("struct"), "object"), [
          buildObjectFieldsExpr(node.fields),
        ]),
      );
    case "form":
      return markPure(
        callExpr(propAccess(id("struct"), node.codec), [
          buildObjectFieldsExpr(node.fields),
        ]),
      );
    case "or":
      return markPure(
        callExpr(
          propAccess(id("struct"), "or"),
          node.options.map(buildSchemaExpr),
        ),
      );
    case "discriminatedUnion":
      return markPure(
        callExpr(propAccess(id("struct"), "discriminatedUnion"), [
          str(node.tag),
          arrExpr(node.options.map(buildSchemaExpr), true),
        ]),
      );
    case "intersection":
      return markPure(
        callExpr(
          propAccess(id("struct"), "intersection"),
          node.members.map(buildSchemaExpr),
        ),
      );
    case "nullable":
      return markPure(
        callExpr(propAccess(buildSchemaExpr(node.inner), "nullable")),
      );
    case "ref":
      return id(node.name);
  }
}

function buildPathValueExpr(
  pathAccess: AstExpression,
  p: PathParamPlanIr,
): AstExpression {
  const expr = propAccess(pathAccess, p.propName);
  if (p.isJsonContent) {
    return callExpr(propAccess(id("JSON"), "stringify"), [expr]);
  }
  if (!p.needsSerializer) {
    return expr;
  }
  switch (p.style) {
    case "label":
      return callExpr(
        id("serializeLabelParam"),
        p.explode ? [expr, literalExpr(true)] : [expr],
      );
    case "matrix":
      return callExpr(
        id("serializeMatrixParam"),
        p.explode
          ? [str(p.rawName), expr, literalExpr(true)]
          : [str(p.rawName), expr],
      );
    default:
      return callExpr(
        id("serializeSimpleParam"),
        p.explode ? [expr, literalExpr(true)] : [expr],
      );
  }
}

function buildCustomQueryCall(
  target: AstExpression,
  field: QueryFieldPlanIr,
): AstStatement {
  const acc = propAccess(target, field.propName);
  const wire = str(field.wireName);
  switch (field.style) {
    case "deepObject":
      return exprStmt(
        callExpr(id("appendDeepObjectQuery"), [id("query"), wire, acc]),
      );
    case "pipeDelimited":
      return exprStmt(
        callExpr(
          id("appendPipeDelimitedQuery"),
          field.explode
            ? [id("query"), wire, acc, literalExpr(true)]
            : [id("query"), wire, acc],
        ),
      );
    case "spaceDelimited":
      return exprStmt(
        callExpr(
          id("appendSpaceDelimitedQuery"),
          field.explode
            ? [id("query"), wire, acc, literalExpr(true)]
            : [id("query"), wire, acc],
        ),
      );
    case "json":
      return exprStmt(
        callExpr(id("appendJsonQuery"), [id("query"), wire, acc]),
      );
    default:
      return exprStmt(
        callExpr(
          id("appendFormQuery"),
          field.explode
            ? [id("query"), wire, acc]
            : [id("query"), wire, acc, literalExpr(false)],
        ),
      );
  }
}

function buildCustomQueryStatements(
  fields: readonly QueryFieldPlanIr[],
  inputOptional: boolean,
  queryRequired: boolean,
): AstStatement[] {
  const stmts: AstStatement[] = [
    constDecl("query", newExpr(id("URLSearchParams"))),
  ];
  if (queryRequired && !inputOptional) {
    const queryTarget = propAccess(id("input"), "query");
    for (const field of fields) {
      stmts.push(buildCustomQueryCall(queryTarget, field));
    }
    return stmts;
  }
  stmts.push(
    constDecl("q", propAccess(id("input"), "query", inputOptional)),
    ifStmt(
      binaryExpr(id("q"), "!==", id("undefined")),
      fields.map((field) => buildCustomQueryCall(id("q"), field)),
    ),
  );
  return stmts;
}

function buildHeaderValueExpr(
  headerAccess: AstExpression,
  h: HeaderParamPlanIr,
): AstExpression {
  const rawExpr = propAccess(headerAccess, h.propName);
  let serialized: AstExpression;
  if (h.isJsonContent) {
    serialized = callExpr(propAccess(id("JSON"), "stringify"), [rawExpr]);
  } else if (h.needsSerializer) {
    serialized = callExpr(
      id("serializeSimpleParam"),
      h.explode ? [rawExpr, literalExpr(true)] : [rawExpr],
    );
  } else {
    return h.nullable ? binaryExpr(rawExpr, "??", id("undefined")) : rawExpr;
  }

  if (h.required && !h.nullable) {
    return serialized;
  }
  if (h.required) {
    return condExpr(
      binaryExpr(rawExpr, "!==", literalExpr(null)),
      serialized,
      id("undefined"),
    );
  }
  if (!h.nullable) {
    return condExpr(
      binaryExpr(rawExpr, "!==", id("undefined")),
      serialized,
      id("undefined"),
    );
  }
  return condExpr(
    binaryExpr(
      binaryExpr(rawExpr, "!==", id("undefined")),
      "&&",
      binaryExpr(rawExpr, "!==", literalExpr(null)),
    ),
    serialized,
    id("undefined"),
  );
}

function buildBuilderExpr(plan: BuilderPlanIr, inputOptional: boolean) {
  const inputExpr = id("input");
  const pathAccess = plan.pathWrapperProp
    ? propAccess(inputExpr, plan.pathWrapperProp, inputOptional)
    : inputExpr;

  const hasComplexHeaders = plan.headers.some(
    (h) => h.isJsonContent || h.needsSerializer,
  );
  const headersDirect = !inputOptional && plan.headersRequired;
  const needsHeaderVar = hasComplexHeaders && !headersDirect;
  const needsBlock = plan.customQueryFields !== undefined || needsHeaderVar;
  const headerAccess = needsHeaderVar
    ? id("h")
    : propAccess(inputExpr, "headers", inputOptional);

  const entries: AstObjectMember[] = [];

  if (plan.pathParams.length > 0) {
    entries.push(
      propAssign(
        id("path"),
        objExpr(
          plan.pathParams.map((p) =>
            propAssign(id(p.templateName), buildPathValueExpr(pathAccess, p)),
          ),
          false,
        ),
      ),
    );
  }

  if (plan.customQueryFields !== undefined) {
    entries.push(shorthandProp("query"));
  } else if (plan.hasQuery) {
    entries.push(
      propAssign(id("query"), propAccess(inputExpr, "query", inputOptional)),
    );
  }

  if (plan.headers.length > 0) {
    const headersLiteral = objExpr(
      plan.headers.map((h) =>
        propAssign(str(h.wireName), buildHeaderValueExpr(headerAccess, h)),
      ),
      true,
    );
    entries.push(
      propAssign(
        id("headers"),
        headersDirect
          ? headersLiteral
          : condExpr(headerAccess, headersLiteral, id("undefined")),
      ),
    );
  }

  if (plan.hasBody) {
    entries.push(
      propAssign(id("body"), propAccess(inputExpr, "body", inputOptional)),
    );
  }

  const returnObj = objExpr(entries, true);

  if (needsBlock) {
    const stmts: AstStatement[] = [];
    if (plan.customQueryFields !== undefined) {
      stmts.push(
        ...buildCustomQueryStatements(
          plan.customQueryFields,
          inputOptional,
          plan.queryRequired,
        ),
      );
    }
    if (needsHeaderVar) {
      stmts.push(
        constDecl("h", propAccess(inputExpr, "headers", inputOptional)),
      );
    }
    stmts.push(retStmt(returnObj));
    return arrowFn(["input"], block(stmts));
  }

  return arrowFn(["input"], returnObj);
}

function buildSchemaFilePlan(
  fileKey: string,
  decls: readonly SchemaDeclIr[],
  allDecls: readonly SchemaDeclIr[],
  divergingInfo: DivergingSchemaInfo,
  options: {
    readonly mode: OpenApiGenerationMode;
    readonly format: OpenApiOutputFormat;
    readonly coreImport: string;
  },
): PlannedAstFile {
  const ext = extForFormat(options.format);
  const impExt = importExtForFormat(options.format);
  const tsMode = isTypeScriptFormat(options.format);

  const declMap = new Map<string, SchemaDeclIr>();
  for (const decl of allDecls) {
    declMap.set(decl.id, decl);
  }

  const crossRefsByFile = new Map<string, Set<string>>();
  let needsStructType = false;
  let needsInferType = false;
  let needsStructInputType = false;

  for (const decl of decls) {
    if (tsMode) {
      if (decl.recursive) {
        needsStructType = true;
      } else if (decl.role === "input") {
        needsStructInputType = true;
      } else {
        needsInferType = true;
      }
    }
    for (const refId of decl.references) {
      const target = requireSchemaDecl(declMap, refId);
      if (target.fileKey !== fileKey) {
        let bucket = crossRefsByFile.get(target.fileKey);
        if (!bucket) {
          bucket = new Set<string>();
          crossRefsByFile.set(target.fileKey, bucket);
        }
        bucket.add(target.name);
      }
    }
  }

  const imports: AstStatement[] = [importNamed(["struct"], options.coreImport)];
  const coreTypes: string[] = [];
  if (needsInferType) {
    coreTypes.push("Infer");
  }
  if (needsStructType) {
    coreTypes.push("Struct");
  }
  if (needsStructInputType) {
    coreTypes.push("StructInput");
  }
  if (coreTypes.length > 0) {
    imports.push(importNamed(coreTypes.sort(), options.coreImport, true));
  }
  for (const [targetFile, bucket] of crossRefsByFile.entries()) {
    imports.push(importNamed([...bucket].sort(), `./${targetFile}${impExt}`));
  }

  const groups: (readonly AstStatement[])[] = [imports];

  for (const decl of decls) {
    const docs = declDocLines(decl);
    const expr = markPure(buildSchemaExpr(decl.schema));
    if (tsMode && decl.recursive) {
      const stmts: AstStatement[] = [
        exportTypeAlias(
          decl.name,
          buildTsTypeNode(decl.schema, divergingInfo.inputTypeNames, "output"),
        ),
      ];
      let typeAnnotation: AstTypeNode;
      const divInputName = divergingInfo.inputTypeNames.get(decl.id);
      if (divInputName !== undefined) {
        stmts.push(
          exportTypeAlias(
            divInputName,
            buildTsTypeNode(decl.schema, divergingInfo.inputTypeNames, "input"),
          ),
        );
        typeAnnotation = typeRef("Struct", [
          typeRef(divInputName),
          typeRef(decl.name),
        ]);
      } else {
        typeAnnotation = typeRef("Struct", [typeRef(decl.name)]);
      }
      stmts.push(
        constDecl(decl.name, expr, {
          isExport: true,
          type: typeAnnotation,
          jsDoc: docs,
        }),
      );
      groups.push(stmts);
    } else {
      const stmts: AstStatement[] = [
        constDecl(decl.name, expr, { isExport: true, jsDoc: docs }),
      ];
      if (tsMode) {
        const helperName = decl.role === "input" ? "StructInput" : "Infer";
        stmts.push(
          exportTypeAlias(
            decl.name,
            typeRef(helperName, [typeQuery(decl.name)]),
          ),
        );
      }
      groups.push(stmts);
    }
  }

  return {
    path: `schema/${fileKey}${ext}`,
    header: headerForMode(options.mode),
    groups,
  };
}

function buildInputExpr(op: OperationIr): AstExpression | undefined {
  if (op.inputSchema === undefined) {
    return undefined;
  }
  const ref = id(op.inputSchema.name);
  return op.inputOptional
    ? markPure(callExpr(propAccess(ref, "optional")))
    : ref;
}

function buildHttpOpPlan(op: HttpOperationIr): AstStatement {
  const props: AstObjectMember[] = [
    propAssign(id("method"), str(op.method)),
    propAssign(id("path"), str(op.path)),
  ];
  const inputExpr = buildInputExpr(op);
  if (inputExpr !== undefined && op.builder !== undefined) {
    props.push(propAssign(id("input"), inputExpr));
    props.push(
      propAssign(id("builder"), buildBuilderExpr(op.builder, op.inputOptional)),
    );
  }
  if (op.outputSchema !== undefined) {
    props.push(propAssign(id("output"), id(op.outputSchema.name)));
  }
  if (op.errorSchema !== undefined) {
    props.push(propAssign(id("error"), id(op.errorSchema.name)));
  }
  return constDecl(
    op.name,
    markPure(callExpr(id("defineRequest"), [objExpr(props, true)])),
    {
      isExport: true,
      jsDoc: opDocLines(op),
    },
  );
}

function buildSseOpPlan(op: SseOperationIr): AstStatement {
  const props: AstObjectMember[] = [];
  if (op.method !== "GET") {
    props.push(propAssign(id("method"), str(op.method)));
  }
  props.push(propAssign(id("path"), str(op.path)));
  const inputExpr = buildInputExpr(op);
  if (inputExpr !== undefined && op.builder !== undefined) {
    props.push(propAssign(id("input"), inputExpr));
    props.push(
      propAssign(id("builder"), buildBuilderExpr(op.builder, op.inputOptional)),
    );
  }
  props.push(
    propAssign(
      id("events"),
      objExpr(
        op.events.map((ev) =>
          propAssign(str(ev.eventName), id(ev.schema.name)),
        ),
        true,
      ),
    ),
  );
  if (op.errorSchema !== undefined) {
    props.push(propAssign(id("error"), id(op.errorSchema.name)));
  }
  return constDecl(
    op.name,
    markPure(callExpr(id("defineEventStream"), [objExpr(props, true)])),
    {
      isExport: true,
      jsDoc: opDocLines(op),
    },
  );
}

function buildRequestFilePlan(
  group: string,
  operations: readonly OperationIr[],
  allDecls: readonly SchemaDeclIr[],
  options: {
    readonly mode: OpenApiGenerationMode;
    readonly format: OpenApiOutputFormat;
    readonly coreImport: string;
  },
): PlannedAstFile {
  const ext = extForFormat(options.format);
  const impExt = importExtForFormat(options.format);
  const declMap = new Map<string, SchemaDeclIr>();
  for (const decl of allDecls) {
    declMap.set(decl.id, decl);
  }

  const coreValues: string[] = [];
  if (operations.some((op) => op.kind === "http")) {
    coreValues.push("defineRequest");
  }
  if (operations.some((op) => op.kind === "sse")) {
    coreValues.push("defineEventStream");
  }

  const schemaImports = new Map<string, Set<string>>();
  for (const op of operations) {
    for (const refId of collectOperationRefIds(op)) {
      const decl = requireSchemaDecl(declMap, refId);
      let set = schemaImports.get(decl.fileKey);
      if (!set) {
        set = new Set<string>();
        schemaImports.set(decl.fileKey, set);
      }
      set.add(decl.name);
    }
  }

  const imports: AstStatement[] = [
    importNamed(coreValues.sort(), options.coreImport),
  ];
  for (const [fileKey, namesSet] of [...schemaImports.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    imports.push(
      importNamed([...namesSet].sort(), `../schema/${fileKey}${impExt}`),
    );
  }
  const usedUtilHelpers = collectBundleUtilHelpers(operations);
  if (usedUtilHelpers.size > 0) {
    imports.push(importNamed([...usedUtilHelpers].sort(), `../util${impExt}`));
  }

  const groups: (readonly AstStatement[])[] = [imports];
  for (const op of operations) {
    groups.push([
      op.kind === "http" ? buildHttpOpPlan(op) : buildSseOpPlan(op),
    ]);
  }

  return {
    path: `request/${group}${ext}`,
    header: headerForMode(options.mode),
    groups,
  };
}

export function buildBarrelFilePlan(
  path: string,
  exportPaths: readonly string[],
  mode: OpenApiGenerationMode,
): PlannedAstFile {
  const stmts: AstStatement[] =
    exportPaths.length === 0
      ? [emptyExport()]
      : exportPaths.map((rel) => exportAll(rel));
  return {
    path,
    header: headerForMode(mode),
    groups: [stmts],
  };
}

export function renderBundleCodeFiles(
  bundle: LoweredBundle,
  options: {
    readonly mode: OpenApiGenerationMode;
    readonly format: OpenApiOutputFormat;
    readonly coreImport: string;
  },
): GeneratedFile[] {
  const ext = extForFormat(options.format);
  const impExt = importExtForFormat(options.format);
  const divergingInfo = computeDivergingSchemaInfo(bundle.schemas);
  const plannedFiles: PlannedAstFile[] = [];

  const schemasByFile = new Map<string, SchemaDeclIr[]>();
  for (const decl of bundle.schemas) {
    let list = schemasByFile.get(decl.fileKey);
    if (!list) {
      list = [];
      schemasByFile.set(decl.fileKey, list);
    }
    list.push(decl);
  }

  const schemaEntries = [...schemasByFile.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const schemaKeys = schemaEntries.map(([key]) => key);
  for (const [fileKey, decls] of schemaEntries) {
    plannedFiles.push(
      buildSchemaFilePlan(
        fileKey,
        decls,
        bundle.schemas,
        divergingInfo,
        options,
      ),
    );
  }

  if (schemaKeys.length > 0) {
    plannedFiles.push(
      buildBarrelFilePlan(
        `schema/index${ext}`,
        schemaKeys.map((key) => `./${key}${impExt}`),
        options.mode,
      ),
    );
  }

  const opsByGroup = new Map<string, OperationIr[]>();
  for (const op of bundle.operations) {
    let list = opsByGroup.get(op.group);
    if (!list) {
      list = [];
      opsByGroup.set(op.group, list);
    }
    list.push(op);
  }

  const groupEntries = [...opsByGroup.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const groupKeys = groupEntries.map(([key]) => key);
  for (const [group, ops] of groupEntries) {
    plannedFiles.push(
      buildRequestFilePlan(group, ops, bundle.schemas, options),
    );
  }

  const rootExports: string[] = [];
  if (schemaKeys.length > 0) {
    rootExports.push(`./schema/index${impExt}`);
  }
  for (const group of groupKeys) {
    rootExports.push(`./request/${group}${impExt}`);
  }
  plannedFiles.push(
    buildBarrelFilePlan(`index${ext}`, rootExports, options.mode),
  );

  const files = printPlannedAstFiles(plannedFiles);

  const bundleUtilHelpers = collectBundleUtilHelpers(bundle.operations);
  if (bundleUtilHelpers.size > 0) {
    files.push({
      path: `util${ext}`,
      content: renderOpenApiUtilCode(bundleUtilHelpers, {
        header: headerForMode(options.mode),
        format: options.format,
      }),
    });
  }

  return files;
}
