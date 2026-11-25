import type { OperationIr } from "../ir/types.ts";
import type { OpenApiOutputFormat } from "../types.ts";

type OpenApiUtilHelperId =
  | "appendDeepObjectQuery"
  | "appendFormQuery"
  | "appendJsonQuery"
  | "appendPipeDelimitedQuery"
  | "appendSpaceDelimitedQuery"
  | "serializeLabelParam"
  | "serializeMatrixParam"
  | "serializeSimpleParam";

interface OpenApiUtilParam {
  readonly name: string;
  readonly type: string;
  readonly defaultValue?: string;
}

interface OpenApiUtilFunctionSpec {
  readonly name: string;
  readonly exported: boolean;
  readonly deps: readonly string[];
  readonly params: readonly OpenApiUtilParam[];
  readonly returnType: string;
  readonly renderBody: (tsMode: boolean) => string;
}

function strArrayDecl(varName: string, tsMode: boolean): string {
  return tsMode ? `const ${varName}: string[] = [];` : `const ${varName} = [];`;
}

export const OPENAPI_UTIL_CATALOG: ReadonlyMap<
  string,
  OpenApiUtilFunctionSpec
> = new Map<string, OpenApiUtilFunctionSpec>([
  [
    "isParamRecord",
    {
      name: "isParamRecord",
      exported: false,
      deps: [],
      params: [{ name: "value", type: "unknown" }],
      returnType: "value is { [key: string]: unknown }",
      renderBody: () => `  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );`,
    },
  ],
  [
    "stringifyParam",
    {
      name: "stringifyParam",
      exported: false,
      deps: [],
      params: [{ name: "value", type: "unknown" }],
      returnType: "string",
      renderBody: () => `  if (value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    default:
      return JSON.stringify(value) ?? "";
  }`,
    },
  ],
  [
    "appendDelimited",
    {
      name: "appendDelimited",
      exported: false,
      deps: ["isParamRecord", "stringifyParam"],
      params: [
        { name: "params", type: "URLSearchParams" },
        { name: "name", type: "string" },
        { name: "value", type: "unknown" },
        { name: "delimiter", type: "string" },
        { name: "explode", type: "boolean" },
      ],
      returnType: "void",
      renderBody: (tsMode) => `  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    ${strArrayDecl("items", tsMode)}
    for (const item of value) {
      if (item !== undefined && item !== null) {
        if (explode) {
          params.append(name, stringifyParam(item));
        } else {
          items.push(stringifyParam(item));
        }
      }
    }
    if (!explode && items.length > 0) {
      params.set(name, items.join(delimiter));
    }
    return;
  }
  if (isParamRecord(value)) {
    ${strArrayDecl("pairs", tsMode)}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        if (explode) {
          params.append(k, stringifyParam(v));
        } else {
          pairs.push(k, stringifyParam(v));
        }
      }
    }
    if (!explode && pairs.length > 0) {
      params.set(name, pairs.join(delimiter));
    }
    return;
  }
  params.set(name, stringifyParam(value));`,
    },
  ],
  [
    "appendFormQuery",
    {
      name: "appendFormQuery",
      exported: true,
      deps: ["appendDelimited"],
      params: [
        { name: "params", type: "URLSearchParams" },
        { name: "name", type: "string" },
        { name: "value", type: "unknown" },
        { name: "explode", type: "boolean", defaultValue: "true" },
      ],
      returnType: "void",
      renderBody: () => `  appendDelimited(params, name, value, ",", explode);`,
    },
  ],
  [
    "appendSpaceDelimitedQuery",
    {
      name: "appendSpaceDelimitedQuery",
      exported: true,
      deps: ["appendDelimited"],
      params: [
        { name: "params", type: "URLSearchParams" },
        { name: "name", type: "string" },
        { name: "value", type: "unknown" },
        { name: "explode", type: "boolean", defaultValue: "false" },
      ],
      returnType: "void",
      renderBody: () => `  appendDelimited(params, name, value, " ", explode);`,
    },
  ],
  [
    "appendPipeDelimitedQuery",
    {
      name: "appendPipeDelimitedQuery",
      exported: true,
      deps: ["appendDelimited"],
      params: [
        { name: "params", type: "URLSearchParams" },
        { name: "name", type: "string" },
        { name: "value", type: "unknown" },
        { name: "explode", type: "boolean", defaultValue: "false" },
      ],
      returnType: "void",
      renderBody: () => `  appendDelimited(params, name, value, "|", explode);`,
    },
  ],
  [
    "appendDeepObjectQuery",
    {
      name: "appendDeepObjectQuery",
      exported: true,
      deps: ["isParamRecord", "stringifyParam"],
      params: [
        { name: "params", type: "URLSearchParams" },
        { name: "name", type: "string" },
        { name: "value", type: "unknown" },
      ],
      returnType: "void",
      renderBody: () => `  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    let i = 0;
    for (const item of value) {
      appendDeepObjectQuery(params, \`\${name}[\${i}]\`, item);
      i += 1;
    }
    return;
  }
  if (isParamRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        appendDeepObjectQuery(params, \`\${name}[\${k}]\`, v);
      }
    }
    return;
  }
  params.append(name, stringifyParam(value));`,
    },
  ],
  [
    "appendJsonQuery",
    {
      name: "appendJsonQuery",
      exported: true,
      deps: [],
      params: [
        { name: "params", type: "URLSearchParams" },
        { name: "name", type: "string" },
        { name: "value", type: "unknown" },
      ],
      returnType: "void",
      renderBody: () => `  if (value !== undefined && value !== null) {
    params.set(name, JSON.stringify(value));
  }`,
    },
  ],
  [
    "serializeSimpleParam",
    {
      name: "serializeSimpleParam",
      exported: true,
      deps: ["isParamRecord", "stringifyParam"],
      params: [
        { name: "value", type: "unknown" },
        { name: "explode", type: "boolean", defaultValue: "false" },
      ],
      returnType: "string",
      renderBody: (tsMode) => `  if (Array.isArray(value)) {
    ${strArrayDecl("items", tsMode)}
    for (const item of value) {
      if (item !== undefined && item !== null) {
        items.push(stringifyParam(item));
      }
    }
    return items.join(",");
  }
  if (isParamRecord(value)) {
    ${strArrayDecl("parts", tsMode)}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        if (explode) {
          parts.push(\`\${k}=\${stringifyParam(v)}\`);
        } else {
          parts.push(k, stringifyParam(v));
        }
      }
    }
    return parts.join(",");
  }
  return stringifyParam(value);`,
    },
  ],
  [
    "serializeLabelParam",
    {
      name: "serializeLabelParam",
      exported: true,
      deps: ["isParamRecord", "stringifyParam"],
      params: [
        { name: "value", type: "unknown" },
        { name: "explode", type: "boolean", defaultValue: "false" },
      ],
      returnType: "string",
      renderBody: (tsMode) => `  if (Array.isArray(value)) {
    ${strArrayDecl("items", tsMode)}
    for (const item of value) {
      if (item !== undefined && item !== null) {
        items.push(stringifyParam(item));
      }
    }
    return items.length > 0 ? \`.\${items.join(explode ? "." : ",")}\` : ".";
  }
  if (isParamRecord(value)) {
    ${strArrayDecl("parts", tsMode)}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        if (explode) {
          parts.push(\`\${k}=\${stringifyParam(v)}\`);
        } else {
          parts.push(k, stringifyParam(v));
        }
      }
    }
    return parts.length > 0 ? \`.\${parts.join(explode ? "." : ",")}\` : ".";
  }
  return \`.\${stringifyParam(value)}\`;`,
    },
  ],
  [
    "serializeMatrixParam",
    {
      name: "serializeMatrixParam",
      exported: true,
      deps: ["isParamRecord", "stringifyParam"],
      params: [
        { name: "name", type: "string" },
        { name: "value", type: "unknown" },
        { name: "explode", type: "boolean", defaultValue: "false" },
      ],
      returnType: "string",
      renderBody: (tsMode) => `  if (Array.isArray(value)) {
    ${strArrayDecl("items", tsMode)}
    for (const item of value) {
      if (item !== undefined && item !== null) {
        items.push(stringifyParam(item));
      }
    }
    if (items.length === 0) {
      return \`;\${name}\`;
    }
    return explode
      ? items.map((item) => \`;\${name}=\${item}\`).join("")
      : \`;\${name}=\${items.join(",")}\`;
  }
  if (isParamRecord(value)) {
    ${strArrayDecl("parts", tsMode)}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        if (explode) {
          parts.push(\`;\${k}=\${stringifyParam(v)}\`);
        } else {
          parts.push(k, stringifyParam(v));
        }
      }
    }
    if (parts.length === 0) {
      return \`;\${name}\`;
    }
    return explode ? parts.join("") : \`;\${name}=\${parts.join(",")}\`;
  }
  const str = stringifyParam(value);
  return str === "" ? \`;\${name}\` : \`;\${name}=\${str}\`;`,
    },
  ],
]);

export function resolveUtilFunctionClosure(
  requested: ReadonlySet<string>,
  catalog: ReadonlyMap<string, OpenApiUtilFunctionSpec> = OPENAPI_UTIL_CATALOG,
): OpenApiUtilFunctionSpec[] {
  const ordered: OpenApiUtilFunctionSpec[] = [];
  const visited = new Set<string>();

  const visit = (fnName: string): void => {
    const entry = catalog.get(fnName);
    if (!entry || visited.has(fnName)) {
      return;
    }
    visited.add(fnName);
    for (const dep of [...entry.deps].sort()) {
      visit(dep);
    }
    ordered.push(entry);
  };

  for (const fnName of [...requested].sort()) {
    visit(fnName);
  }
  return ordered;
}

function formatUtilParam(param: OpenApiUtilParam, tsMode: boolean): string {
  if (!tsMode) {
    return param.defaultValue !== undefined
      ? `${param.name} = ${param.defaultValue}`
      : param.name;
  }
  return param.defaultValue !== undefined
    ? `${param.name} = ${param.defaultValue}`
    : `${param.name}: ${param.type}`;
}

function renderUtilFunction(
  spec: OpenApiUtilFunctionSpec,
  tsMode: boolean,
): string {
  const prefix = spec.exported ? "export " : "";
  const params = spec.params
    .map((param) => formatUtilParam(param, tsMode))
    .join(", ");
  const ret = tsMode ? `: ${spec.returnType}` : "";
  return `${prefix}function ${spec.name}(${params})${ret} {\n${spec.renderBody(tsMode)}\n}`;
}

function collectOperationUtilHelpers(
  op: OperationIr,
  target: Set<OpenApiUtilHelperId>,
): void {
  if (!op.builder) {
    return;
  }
  for (const p of op.builder.pathParams) {
    if (p.needsSerializer) {
      switch (p.style) {
        case "label":
          target.add("serializeLabelParam");
          break;
        case "matrix":
          target.add("serializeMatrixParam");
          break;
        default:
          target.add("serializeSimpleParam");
          break;
      }
    }
  }
  if (op.builder.customQueryFields !== undefined) {
    for (const q of op.builder.customQueryFields) {
      switch (q.style) {
        case "deepObject":
          target.add("appendDeepObjectQuery");
          break;
        case "pipeDelimited":
          target.add("appendPipeDelimitedQuery");
          break;
        case "spaceDelimited":
          target.add("appendSpaceDelimitedQuery");
          break;
        case "json":
          target.add("appendJsonQuery");
          break;
        default:
          target.add("appendFormQuery");
          break;
      }
    }
  }
  for (const h of op.builder.headers) {
    if (h.needsSerializer) {
      target.add("serializeSimpleParam");
    }
  }
}

export function collectBundleUtilHelpers(
  operations: readonly OperationIr[],
): Set<OpenApiUtilHelperId> {
  const used = new Set<OpenApiUtilHelperId>();
  for (const op of operations) {
    collectOperationUtilHelpers(op, used);
  }
  return used;
}

export function renderOpenApiUtilCode(
  used: ReadonlySet<OpenApiUtilHelperId>,
  options: {
    readonly header: string;
    readonly format: OpenApiOutputFormat;
  },
): string {
  const tsMode = options.format === "ts" || options.format === "tsx";
  const selected = resolveUtilFunctionClosure(used);
  const body = selected
    .map((spec) => renderUtilFunction(spec, tsMode))
    .join("\n\n");
  return `${options.header}\n${body}\n`;
}

export function renderOpenApiUtilDts(
  used: ReadonlySet<OpenApiUtilHelperId>,
  options: {
    readonly header: string;
  },
): string {
  const selected = resolveUtilFunctionClosure(used).filter(
    (spec) => spec.exported,
  );
  const decls = selected.map((spec) => {
    const params = spec.params
      .map((param) =>
        param.defaultValue !== undefined
          ? `${param.name}?: ${param.type}`
          : `${param.name}: ${param.type}`,
      )
      .join(", ");
    return `export declare function ${spec.name}(${params}): ${spec.returnType};`;
  });
  return `${options.header}\n${decls.join("\n")}\n`;
}
