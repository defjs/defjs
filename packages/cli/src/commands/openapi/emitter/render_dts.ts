import { type GeneratedFile, headerForMode } from "../../../codegen/fs_sync.ts";
import {
  declareConst,
  exportTypeAlias,
  importNamed,
  kwType,
  literalType,
  namedTupleMember,
  printPlannedAstFiles,
  propSig,
  tupleType,
  typeLit,
  typeRef,
  unionType,
  type AstStatement,
  type AstTypeNode,
  type PlannedAstFile,
} from "../../../codegen/ts_ast.ts";
import { requireSchemaDecl } from "../ir/schema.ts";
import type {
  HttpOperationIr,
  LoweredBundle,
  OperationIr,
  SchemaDeclIr,
  SseOperationIr,
} from "../ir/types.ts";
import type { OpenApiGenerationMode, OpenApiOutputFormat } from "../types.ts";
import {
  buildBarrelFilePlan,
  buildTsTypeNode,
  computeDivergingSchemaInfo,
  declDocLines,
  type DivergingSchemaInfo,
  dtsExtForFormat,
  importExtForFormat,
  opDocLines,
} from "./render_ts.ts";
import {
  collectBundleUtilHelpers,
  renderOpenApiUtilDts,
} from "./util_helpers.ts";

function buildSchemaDtsPlan(
  fileKey: string,
  decls: readonly SchemaDeclIr[],
  allDecls: readonly SchemaDeclIr[],
  divergingInfo: DivergingSchemaInfo,
  dtsExt: string,
  options: {
    readonly mode: OpenApiGenerationMode;
    readonly format: OpenApiOutputFormat;
    readonly coreImport: string;
  },
): PlannedAstFile {
  const declMap = new Map<string, SchemaDeclIr>();
  for (const decl of allDecls) {
    declMap.set(decl.id, decl);
  }
  const impExt = importExtForFormat(options.format);
  const crossTypesByFile = new Map<string, Set<string>>();

  for (const decl of decls) {
    for (const refId of decl.references) {
      const target = requireSchemaDecl(declMap, refId);
      if (target.fileKey !== fileKey) {
        let bucket = crossTypesByFile.get(target.fileKey);
        if (!bucket) {
          bucket = new Set<string>();
          crossTypesByFile.set(target.fileKey, bucket);
        }
        bucket.add(target.name);
        const divName = divergingInfo.inputTypeNames.get(target.id);
        if (divName !== undefined) {
          bucket.add(divName);
        }
      }
    }
  }

  const imports: AstStatement[] = [
    importNamed(["Struct"], options.coreImport, true),
  ];
  for (const [targetFile, bucket] of crossTypesByFile.entries()) {
    imports.push(
      importNamed([...bucket].sort(), `./${targetFile}${impExt}`, true),
    );
  }

  const groups: (readonly AstStatement[])[] = [imports];

  for (const decl of decls) {
    const docs = declDocLines(decl);
    if (decl.role === "input") {
      const inType = buildTsTypeNode(
        decl.schema,
        divergingInfo.inputTypeNames,
        "input",
      );
      const structArgs: AstTypeNode[] = [typeRef(decl.name)];
      if (divergingInfo.divergingIds.has(decl.id)) {
        structArgs.push(
          buildTsTypeNode(decl.schema, divergingInfo.inputTypeNames, "output"),
        );
      }
      groups.push([
        exportTypeAlias(decl.name, inType),
        declareConst(decl.name, typeRef("Struct", structArgs), { jsDoc: docs }),
      ]);
    } else {
      const outType = buildTsTypeNode(
        decl.schema,
        divergingInfo.inputTypeNames,
        "output",
      );
      const divInputName = divergingInfo.inputTypeNames.get(decl.id);
      if (divInputName !== undefined) {
        const inType = buildTsTypeNode(
          decl.schema,
          divergingInfo.inputTypeNames,
          "input",
        );
        groups.push([
          exportTypeAlias(decl.name, outType),
          exportTypeAlias(divInputName, inType),
          declareConst(
            decl.name,
            typeRef("Struct", [typeRef(divInputName), typeRef(decl.name)]),
            { jsDoc: docs },
          ),
        ]);
      } else {
        groups.push([
          exportTypeAlias(decl.name, outType),
          declareConst(decl.name, typeRef("Struct", [typeRef(decl.name)]), {
            jsDoc: docs,
          }),
        ]);
      }
    }
  }

  return {
    path: `schema/${fileKey}${dtsExt}`,
    header: headerForMode(options.mode),
    groups,
  };
}

function buildOperationArgsType(op: OperationIr): AstTypeNode {
  if (op.inputSchema === undefined) {
    return tupleType([]);
  }
  return tupleType([
    namedTupleMember("input", typeRef(op.inputSchema.name), op.inputOptional),
  ]);
}

function buildHttpOpDts(
  op: HttpOperationIr,
  argsType: AstTypeNode,
  neededCoreTypes: Set<string>,
): AstStatement {
  neededCoreTypes.add("RequestEndpoint");
  const dataType =
    op.outputSchema !== undefined
      ? typeRef(op.outputSchema.name)
      : kwType("undefined");
  const errType =
    op.errorSchema !== undefined
      ? typeRef(op.errorSchema.name)
      : kwType("undefined");
  let responseType: AstTypeNode;
  if (op.outputSchema !== undefined) {
    neededCoreTypes.add("DecodedResponse");
    responseType = typeRef("DecodedResponse", [dataType]);
  } else {
    neededCoreTypes.add("HttpMeta");
    responseType = typeRef("HttpMeta");
  }
  return declareConst(
    op.name,
    typeRef("RequestEndpoint", [argsType, dataType, errType, responseType]),
    { jsDoc: opDocLines(op) },
  );
}

function buildSseOpDts(
  op: SseOperationIr,
  argsType: AstTypeNode,
  divergingInfo: DivergingSchemaInfo,
  neededCoreTypes: Set<string>,
): AstStatement {
  neededCoreTypes.add("EventStreamEndpoint");
  const eventUnion = unionType(
    op.events.map((ev) =>
      typeLit([
        propSig("event", literalType(ev.eventName), false),
        propSig("data", typeRef(ev.schema.name), false),
        propSig("id", kwType("string"), true),
      ]),
    ),
  );
  let errorStructType: AstTypeNode = kwType("undefined");
  if (op.errorSchema !== undefined) {
    neededCoreTypes.add("Struct");
    const errInName =
      divergingInfo.inputTypeNames.get(op.errorSchema.id) ??
      op.errorSchema.name;
    errorStructType = typeRef("Struct", [
      typeRef(errInName),
      typeRef(op.errorSchema.name),
    ]);
  }
  return declareConst(
    op.name,
    typeRef("EventStreamEndpoint", [argsType, eventUnion, errorStructType]),
    { jsDoc: opDocLines(op) },
  );
}

function buildRequestDtsPlan(
  group: string,
  operations: readonly OperationIr[],
  allDecls: readonly SchemaDeclIr[],
  divergingInfo: DivergingSchemaInfo,
  dtsExt: string,
  options: {
    readonly mode: OpenApiGenerationMode;
    readonly format: OpenApiOutputFormat;
    readonly coreImport: string;
  },
): PlannedAstFile {
  const declMap = new Map<string, SchemaDeclIr>();
  for (const decl of allDecls) {
    declMap.set(decl.id, decl);
  }
  const impExt = importExtForFormat(options.format);
  const neededCoreTypes = new Set<string>();
  const opStmts = operations.map((op) => {
    const argsType = buildOperationArgsType(op);
    return op.kind === "http"
      ? buildHttpOpDts(op, argsType, neededCoreTypes)
      : buildSseOpDts(op, argsType, divergingInfo, neededCoreTypes);
  });

  const schemaTypeImports = new Map<string, Set<string>>();
  const addTypeImport = (id: string, includeInputType: boolean) => {
    const decl = requireSchemaDecl(declMap, id);
    let set = schemaTypeImports.get(decl.fileKey);
    if (!set) {
      set = new Set<string>();
      schemaTypeImports.set(decl.fileKey, set);
    }
    set.add(decl.name);
    if (includeInputType) {
      const divName = divergingInfo.inputTypeNames.get(decl.id);
      if (divName !== undefined) {
        set.add(divName);
      }
    }
  };

  for (const op of operations) {
    if (op.inputSchema !== undefined) {
      addTypeImport(op.inputSchema.id, false);
    }
    if (op.errorSchema !== undefined) {
      addTypeImport(op.errorSchema.id, op.kind === "sse");
    }
    if (op.kind === "http" && op.outputSchema !== undefined) {
      addTypeImport(op.outputSchema.id, false);
    }
    if (op.kind === "sse") {
      for (const ev of op.events) {
        addTypeImport(ev.schema.id, false);
      }
    }
  }

  const imports: AstStatement[] = [
    importNamed([...neededCoreTypes].sort(), options.coreImport, true),
  ];
  for (const [fileKey, namesSet] of [...schemaTypeImports.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    imports.push(
      importNamed([...namesSet].sort(), `../schema/${fileKey}${impExt}`, true),
    );
  }

  return {
    path: `request/${group}${dtsExt}`,
    header: headerForMode(options.mode),
    groups: [imports, opStmts],
  };
}

export function renderBundleDtsFiles(
  bundle: LoweredBundle,
  options: {
    readonly mode: OpenApiGenerationMode;
    readonly format: OpenApiOutputFormat;
    readonly coreImport: string;
  },
): GeneratedFile[] {
  const dtsExt = dtsExtForFormat(options.format);
  if (dtsExt === undefined) {
    return [];
  }

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
      buildSchemaDtsPlan(
        fileKey,
        decls,
        bundle.schemas,
        divergingInfo,
        dtsExt,
        options,
      ),
    );
  }

  if (schemaKeys.length > 0) {
    plannedFiles.push(
      buildBarrelFilePlan(
        `schema/index${dtsExt}`,
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
      buildRequestDtsPlan(
        group,
        ops,
        bundle.schemas,
        divergingInfo,
        dtsExt,
        options,
      ),
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
    buildBarrelFilePlan(`index${dtsExt}`, rootExports, options.mode),
  );

  const files = printPlannedAstFiles(plannedFiles);

  const bundleUtilHelpers = collectBundleUtilHelpers(bundle.operations);
  if (bundleUtilHelpers.size > 0) {
    files.push({
      path: `util${dtsExt}`,
      content: renderOpenApiUtilDts(bundleUtilHelpers, {
        header: headerForMode(options.mode),
      }),
    });
  }

  return files;
}
