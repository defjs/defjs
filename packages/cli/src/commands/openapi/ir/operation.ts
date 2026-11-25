import {
  createUniqueNamer,
  toCamelCase,
  toKebabCase,
  toPascalCase,
} from "../../../codegen/naming.ts";
import { isRecord } from "../../../runtime/diagnostics.ts";
import type { CliDiagnostic } from "../../../runtime/types.ts";
import { OPENAPI_UTIL_CATALOG } from "../emitter/util_helpers.ts";
import type { SchemaRegistry } from "./schema.ts";
import type {
  BuilderPlanIr,
  HeaderParamPlanIr,
  HttpOperationIr,
  LoweringOptions,
  ObjectFieldIr,
  OperationIr,
  PathParamPlanIr,
  PathParamStyle,
  QueryFieldPlanIr,
  QueryParamStyle,
  SchemaNode,
  SchemaRefNode,
  SseEventIr,
  SseOperationIr,
} from "./types.ts";

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query",
] as const;

const EMPTY_STATUS_CODES = new Set(["204", "205"]);

interface RawParam {
  readonly inLocation: string;
  readonly name: string;
  readonly required: boolean;
  readonly schema: unknown;
  readonly isJsonContent: boolean;
  readonly contentMediaType?: string;
  readonly description?: string;
  readonly style?: string;
  readonly explode?: boolean;
}

interface ConvertedPath {
  readonly path: string;
  readonly params: readonly {
    readonly rawName: string;
    readonly templateName: string;
  }[];
  readonly unsupportedTemplate: boolean;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function convertPathTemplate(rawPath: string): ConvertedPath {
  if (rawPath === "/" || rawPath === "") {
    return { path: "/", params: [], unsupportedTemplate: false };
  }
  const paramNamer = createUniqueNamer();
  const params: { rawName: string; templateName: string }[] = [];
  let unsupportedTemplate = false;
  const segments = rawPath.split("/");
  const convertedSegments = segments.map((segment) => {
    if (segment === "") {
      return "";
    }
    if (segment.includes(":")) {
      unsupportedTemplate = true;
    }
    const exactMatch = /^\{([^{}]+)\}$/.exec(segment);
    if (exactMatch && exactMatch[1] !== undefined) {
      const rawName = exactMatch[1];
      const templateName = paramNamer(toCamelCase(rawName, "param"));
      params.push({ rawName, templateName });
      return `:${templateName}`;
    }
    if (/\{[^{}]+\}/.test(segment)) {
      unsupportedTemplate = true;
      return segment.replace(/\{([^{}]+)\}/g, (_, rawName: string) => {
        const templateName = paramNamer(toCamelCase(rawName, "param"));
        params.push({ rawName, templateName });
        return `:${templateName}`;
      });
    }
    return segment;
  });

  return {
    path: convertedSegments.join("/"),
    params,
    unsupportedTemplate,
  };
}

function extractParamSchema(item: { [key: string]: unknown }): {
  readonly schema: unknown;
  readonly isJsonContent: boolean;
  readonly contentMediaType?: string;
} {
  if ("schema" in item && item["schema"] !== undefined) {
    return { schema: item["schema"], isJsonContent: false };
  }
  const content = item["content"];
  if (isRecord(content)) {
    const jsonEntry = pickJsonMediaEntry(content);
    if (jsonEntry !== undefined) {
      return {
        schema: jsonEntry.media["schema"] ?? {},
        isJsonContent: true,
        contentMediaType: jsonEntry.mediaType,
      };
    }
    for (const [mediaType, entry] of Object.entries(content)) {
      if (isRecord(entry) && "schema" in entry) {
        return {
          schema: entry["schema"],
          isJsonContent: false,
          contentMediaType: mediaType,
        };
      }
    }
    for (const [mediaType, entry] of Object.entries(content)) {
      if (isRecord(entry)) {
        return {
          schema: undefined,
          isJsonContent: false,
          contentMediaType: mediaType,
        };
      }
    }
  }
  if (typeof item["type"] === "string") {
    return { schema: item, isJsonContent: false };
  }
  return { schema: undefined, isJsonContent: false };
}

function resolveSwaggerCollectionFormat(item: {
  [key: string]: unknown;
}): { readonly style: QueryParamStyle; readonly explode: boolean } | undefined {
  if (item["in"] !== "query" || item["type"] !== "array") {
    return undefined;
  }
  switch (item["collectionFormat"]) {
    case "ssv":
      return { style: "spaceDelimited", explode: false };
    case "pipes":
      return { style: "pipeDelimited", explode: false };
    case "multi":
      return { style: "form", explode: true };
    default:
      return { style: "form", explode: false };
  }
}

function mergeParameters(pathParams: unknown, opParams: unknown): RawParam[] {
  const merged = new Map<string, RawParam>();
  const addList = (list: unknown) => {
    if (!Array.isArray(list)) {
      return;
    }
    for (const item of list) {
      if (!isRecord(item)) {
        continue;
      }
      const inLoc = readString(item["in"]);
      const name = readString(item["name"]);
      if (inLoc === undefined || name === undefined) {
        continue;
      }
      const explicitStyle = readString(item["style"]);
      const explicitExplode =
        typeof item["explode"] === "boolean" ? item["explode"] : undefined;
      const swaggerFormat =
        explicitStyle === undefined && explicitExplode === undefined
          ? resolveSwaggerCollectionFormat(item)
          : undefined;
      const extracted = extractParamSchema(item);
      merged.set(`${inLoc}:${name}`, {
        inLocation: inLoc,
        name,
        required: item["required"] === true || inLoc === "path",
        schema: extracted.schema,
        isJsonContent: extracted.isJsonContent,
        ...(extracted.contentMediaType !== undefined
          ? { contentMediaType: extracted.contentMediaType }
          : {}),
        description: readString(item["description"]),
        style: explicitStyle ?? swaggerFormat?.style,
        explode: explicitExplode ?? swaggerFormat?.explode,
      });
    }
  };
  addList(pathParams);
  addList(opParams);
  return [...merged.values()];
}

function normalizeQueryStyle(style: string | undefined): QueryParamStyle {
  switch (style) {
    case "deepObject":
      return "deepObject";
    case "pipeDelimited":
      return "pipeDelimited";
    case "spaceDelimited":
      return "spaceDelimited";
    default:
      return "form";
  }
}

function normalizePathStyle(style: string | undefined): PathParamStyle {
  switch (style) {
    case "label":
      return "label";
    case "matrix":
      return "matrix";
    default:
      return "simple";
  }
}

function unwrapNullableAndRef(
  node: SchemaNode,
  registry: SchemaRegistry,
): { readonly node: SchemaNode; readonly nullable: boolean } {
  let current = node;
  let nullable = false;
  for (;;) {
    if (current.kind === "nullable") {
      nullable = true;
      current = current.inner;
    } else if (current.kind === "ref") {
      current = registry.getSchemaById(current.id).schema;
    } else {
      return { node: current, nullable };
    }
  }
}

function isArrayShape(node: SchemaNode): boolean {
  return node.kind === "array" || node.kind === "tuple";
}

function isObjectShape(node: SchemaNode): boolean {
  return (
    node.kind === "object" ||
    node.kind === "record" ||
    node.kind === "intersection"
  );
}

function isCoreQueryScalar(
  node: SchemaNode,
  registry: SchemaRegistry,
): boolean {
  switch (node.kind) {
    case "primitive":
      return (
        node.primitive === "string" ||
        node.primitive === "number" ||
        node.primitive === "boolean" ||
        node.primitive === "date"
      );
    case "literal":
      return node.value !== null;
    case "enum":
      return true;
    case "or":
      return node.options.every((opt) => isCoreQueryScalar(opt, registry));
    case "ref":
      return isCoreQueryScalar(
        registry.getSchemaById(node.id).schema,
        registry,
      );
    default:
      return false;
  }
}

function isCoreFormExplodedQueryValue(
  node: SchemaNode,
  registry: SchemaRegistry,
): boolean {
  switch (node.kind) {
    case "array":
      return isCoreQueryScalar(node.item, registry);
    case "tuple":
      return node.items.every((item) => isCoreQueryScalar(item, registry));
    case "or":
      return node.options.every((opt) =>
        isCoreFormExplodedQueryValue(opt, registry),
      );
    case "ref":
      return isCoreFormExplodedQueryValue(
        registry.getSchemaById(node.id).schema,
        registry,
      );
    default:
      return isCoreQueryScalar(node, registry);
  }
}

function ensureOperationSchemaRef(
  node: SchemaNode,
  preferredName: string,
  registry: SchemaRegistry,
): SchemaRefNode {
  if (node.kind === "ref") {
    return node;
  }
  const decl = registry.registerSynthesizedSchema(node, preferredName);
  return { kind: "ref", id: decl.id, name: decl.name };
}

function buildInputField(
  propName: string,
  wireName: string,
  schema: SchemaNode,
  required: boolean,
  description?: string,
): ObjectFieldIr {
  const nullable = schema.kind === "nullable";
  return {
    propName,
    wireName,
    schema: nullable ? schema.inner : schema,
    required,
    nullable,
    description,
    constraints: [],
    lazyGetter: false,
  };
}

function deriveOperationName(
  method: string,
  rawPath: string,
  operationId: string | undefined,
): string {
  if (operationId !== undefined) {
    return toCamelCase(operationId, "operation");
  }
  const cleanPath = rawPath.replace(/\{([^{}]+)\}/g, "by_$1");
  return toCamelCase(`${method.toLowerCase()} ${cleanPath}`, "operation");
}

function isIncludedOperation(
  operationId: string | undefined,
  method: string,
  rawPath: string,
  options: LoweringOptions,
): boolean {
  const key = `${method.toUpperCase()} ${rawPath}`;
  if (options.include && options.include.length > 0) {
    const matches = options.include.some(
      (entry) =>
        entry === key || (operationId !== undefined && entry === operationId),
    );
    if (!matches) {
      return false;
    }
  }
  if (options.exclude && options.exclude.length > 0) {
    const excluded = options.exclude.some(
      (entry) =>
        entry === key || (operationId !== undefined && entry === operationId),
    );
    if (excluded) {
      return false;
    }
  }
  return true;
}

function pickJsonMediaEntry(content: {
  [key: string]: unknown;
}):
  | { readonly mediaType: string; readonly media: { [key: string]: unknown } }
  | undefined {
  const exact = content["application/json"];
  if (isRecord(exact)) {
    return { mediaType: "application/json", media: exact };
  }
  for (const [mediaType, entry] of Object.entries(content)) {
    if (
      (mediaType.toLowerCase().endsWith("+json") ||
        mediaType.toLowerCase().startsWith("application/json")) &&
      isRecord(entry)
    ) {
      return { mediaType, media: entry };
    }
  }
  return undefined;
}

function resolveRequestBodySchema(
  op: { [key: string]: unknown },
  swaggerFormParams: readonly RawParam[],
  swaggerBodyParam: RawParam | undefined,
  registry: SchemaRegistry,
): { readonly schema: SchemaNode; readonly required: boolean } | undefined {
  const requestBody = op["requestBody"];
  if (isRecord(requestBody)) {
    const required = requestBody["required"] === true;
    const content = requestBody["content"];
    if (!isRecord(content)) {
      return undefined;
    }
    const jsonEntry = pickJsonMediaEntry(content);
    if (jsonEntry !== undefined && "schema" in jsonEntry.media) {
      return {
        schema: registry.lowerSchema(jsonEntry.media["schema"], "json"),
        required,
      };
    }
    const multipart = content["multipart/form-data"];
    if (isRecord(multipart)) {
      const schemaRaw = isRecord(multipart["schema"])
        ? multipart["schema"]
        : {};
      const fields = registry.lowerObjectFields(
        schemaRaw,
        "formData",
        new Set(),
      );
      return {
        schema: { kind: "form", codec: "formData", fields },
        required,
      };
    }
    const urlencoded = content["application/x-www-form-urlencoded"];
    if (isRecord(urlencoded)) {
      const schemaRaw = isRecord(urlencoded["schema"])
        ? urlencoded["schema"]
        : {};
      const fields = registry.lowerObjectFields(schemaRaw, "json", new Set());
      return {
        schema: { kind: "form", codec: "urlencoded", fields },
        required,
      };
    }
    for (const [mediaType, entry] of Object.entries(content)) {
      if (!isRecord(entry)) {
        continue;
      }
      if (mediaType.startsWith("text/")) {
        return {
          schema: { kind: "primitive", primitive: "string" },
          required,
        };
      }
      if (mediaType === "application/octet-stream" || mediaType === "*/*") {
        return {
          schema: { kind: "primitive", primitive: "blob" },
          required,
        };
      }
    }
    return undefined;
  }

  if (swaggerBodyParam !== undefined) {
    return {
      schema: registry.lowerSchema(swaggerBodyParam.schema, "json"),
      required: swaggerBodyParam.required,
    };
  }

  if (swaggerFormParams.length > 0) {
    const fieldNamer = createUniqueNamer();
    const hasFile = swaggerFormParams.some(
      (p) =>
        isRecord(p.schema) &&
        (p.schema["format"] === "binary" || p.schema["type"] === "file"),
    );
    const fields = swaggerFormParams.map((p) => {
      const propName = fieldNamer(toCamelCase(p.name, "field"));
      const node = registry.lowerSchema(
        p.schema ?? { type: "string" },
        hasFile ? "formData" : "json",
      );
      return buildInputField(propName, p.name, node, p.required, p.description);
    });
    return {
      schema: {
        kind: "form",
        codec: hasFile ? "formData" : "urlencoded",
        fields,
      },
      required: swaggerFormParams.some((p) => p.required),
    };
  }

  return undefined;
}

function lowerResponseContent(
  responseObj: { [key: string]: unknown },
  registry: SchemaRegistry,
): SchemaNode | undefined {
  const content = responseObj["content"];
  if (isRecord(content)) {
    const jsonEntry = pickJsonMediaEntry(content);
    if (jsonEntry !== undefined && "schema" in jsonEntry.media) {
      return registry.lowerSchema(jsonEntry.media["schema"], "json");
    }
    for (const [mediaType, entry] of Object.entries(content)) {
      if (!isRecord(entry)) {
        continue;
      }
      if (mediaType.startsWith("text/") && mediaType !== "text/event-stream") {
        return { kind: "primitive", primitive: "string" };
      }
      if (
        mediaType === "application/octet-stream" ||
        mediaType.startsWith("image/")
      ) {
        return { kind: "primitive", primitive: "blob" };
      }
    }
    return undefined;
  }
  if ("schema" in responseObj) {
    return registry.lowerSchema(responseObj["schema"], "json");
  }
  return undefined;
}

interface RawSseEvent {
  readonly eventName: string;
  readonly schema: SchemaNode;
}

function extractSseEvents(
  itemSchemaRaw: unknown,
  registry: SchemaRegistry,
): RawSseEvent[] {
  const itemNode = registry.lowerSchema(itemSchemaRaw, "json");
  const extractSingleObjectEvent = (
    opt: SchemaNode,
  ): RawSseEvent | undefined => {
    const obj = registry.resolveNonRecursiveObject(opt);
    if (!obj) {
      return undefined;
    }
    const eventField = obj.fields.find(
      (f) => f.wireName === "event" || f.propName === "event",
    );
    const dataField = obj.fields.find(
      (f) => f.wireName === "data" || f.propName === "data",
    );
    if (
      eventField?.schema.kind === "literal" &&
      typeof eventField.schema.value === "string" &&
      dataField !== undefined
    ) {
      return {
        eventName: eventField.schema.value,
        schema: dataField.nullable
          ? { kind: "nullable", inner: dataField.schema }
          : dataField.schema,
      };
    }
    return undefined;
  };

  if (itemNode.kind === "or" || itemNode.kind === "discriminatedUnion") {
    const extracted = itemNode.options.map(extractSingleObjectEvent);
    if (extracted.every((item): item is RawSseEvent => item !== undefined)) {
      const byName = new Map<string, RawSseEvent>();
      for (const item of extracted) {
        if (!byName.has(item.eventName)) {
          byName.set(item.eventName, item);
        }
      }
      return [...byName.values()];
    }
  }

  const single = extractSingleObjectEvent(itemNode);
  if (single !== undefined) {
    return [single];
  }

  return [{ eventName: "message", schema: itemNode }];
}

function schemaKey(node: SchemaNode): string {
  return JSON.stringify(node);
}

function deduplicateSchemas(nodes: readonly SchemaNode[]): SchemaNode[] {
  const seen = new Set<string>();
  const unique: SchemaNode[] = [];
  for (const node of nodes) {
    const key = schemaKey(node);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(node);
    }
  }
  return unique;
}

function combineSchemas(
  nodes: readonly SchemaNode[],
  registry: SchemaRegistry,
): SchemaNode | undefined {
  const unique = deduplicateSchemas(nodes);
  if (unique.length === 0) {
    return undefined;
  }
  if (unique.length === 1 && unique[0] !== undefined) {
    return unique[0];
  }

  const tagCandidates = ["code", "type", "kind", "error"];
  for (const tag of tagCandidates) {
    const seenTags = new Set<string | number | boolean | null>();
    let valid = true;
    for (const opt of unique) {
      const obj = registry.resolveNonRecursiveObject(opt);
      const tagField = obj?.fields.find((f) => f.wireName === tag);
      if (
        !tagField ||
        !tagField.required ||
        tagField.nullable ||
        tagField.schema.kind !== "literal" ||
        seenTags.has(tagField.schema.value)
      ) {
        valid = false;
        break;
      }
      seenTags.add(tagField.schema.value);
    }
    if (valid) {
      return { kind: "discriminatedUnion", tag, options: unique };
    }
  }

  return { kind: "or", options: unique };
}

function is2xxStatus(status: string): boolean {
  return /^2\d\d$/.test(status) || status.toUpperCase() === "2XX";
}

function isErrorStatus(status: string): boolean {
  return (
    /^[45]\d\d$/.test(status) ||
    status.toUpperCase() === "4XX" ||
    status.toUpperCase() === "5XX" ||
    status === "default"
  );
}

function collectPathOperations(pathItem: {
  [key: string]: unknown;
}): { readonly method: string; readonly op: { [key: string]: unknown } }[] {
  const result: {
    readonly method: string;
    readonly op: { [key: string]: unknown };
  }[] = [];
  for (const lowerMethod of HTTP_METHODS) {
    const op = pathItem[lowerMethod];
    if (isRecord(op)) {
      result.push({ method: lowerMethod.toUpperCase(), op });
    }
  }
  const additional = pathItem["additionalOperations"];
  if (isRecord(additional)) {
    for (const [rawMethod, op] of Object.entries(additional)) {
      const method = readString(rawMethod);
      if (method !== undefined && isRecord(op)) {
        result.push({ method, op });
      }
    }
  }
  return result;
}

export function lowerOperations(
  doc: { [key: string]: unknown },
  registry: SchemaRegistry,
  options: LoweringOptions,
): {
  readonly operations: readonly OperationIr[];
  readonly diagnostics: readonly CliDiagnostic[];
} {
  const diagnostics: CliDiagnostic[] = [];
  const webhooks = doc["webhooks"];
  if (isRecord(webhooks) && Object.keys(webhooks).length > 0) {
    diagnostics.push({
      code: "CLI_UNSUPPORTED_WEBHOOKS",
      severity: "warning",
      message:
        'OpenAPI "webhooks" are server-to-client callbacks and are omitted from client request definitions',
    });
  }

  const pathsObj = doc["paths"];
  if (!isRecord(pathsObj)) {
    return { operations: [], diagnostics };
  }

  const reservedOpNames = [
    "defineRequest",
    "defineEventStream",
    ...[...OPENAPI_UTIL_CATALOG.values()]
      .filter((spec) => spec.exported)
      .map((spec) => spec.name),
  ];
  const opNamerByGroup = new Map<string, (base: string) => string>();
  const getGroupNamer = (group: string) => {
    let namer = opNamerByGroup.get(group);
    if (!namer) {
      namer = createUniqueNamer(reservedOpNames);
      opNamerByGroup.set(group, namer);
    }
    return namer;
  };

  const operations: OperationIr[] = [];

  for (const [rawPath, pathItem] of Object.entries(pathsObj)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    const pathLevelParams = pathItem["parameters"];

    for (const { method, op } of collectPathOperations(pathItem)) {
      const operationId = readString(op["operationId"]);
      if (!isIncludedOperation(operationId, method, rawPath, options)) {
        continue;
      }

      const opLocation = `${method} ${rawPath}`;
      const tagsRaw = op["tags"];
      const firstTag =
        Array.isArray(tagsRaw) && typeof tagsRaw[0] === "string"
          ? tagsRaw[0]
          : "default";
      const group = toKebabCase(firstTag, "default");
      const namer = getGroupNamer(group);

      const baseOpName = deriveOperationName(method, rawPath, operationId);
      const opName = namer(baseOpName);
      if (opName !== baseOpName) {
        diagnostics.push({
          code: "CLI_DUPLICATE_OPERATION_NAME",
          severity: "warning",
          message: `Duplicate operation name "${baseOpName}" renamed to "${opName}"`,
          location: opLocation,
        });
      }

      const converted = convertPathTemplate(rawPath);
      if (converted.unsupportedTemplate) {
        diagnostics.push({
          code: "CLI_UNSUPPORTED_PATH_TEMPLATE",
          severity: "warning",
          message: `Path template "${rawPath}" contains non-standard segments`,
          location: opLocation,
        });
      }

      const mergedParams = mergeParameters(pathLevelParams, op["parameters"]);
      const pathRawParams = mergedParams.filter((p) => p.inLocation === "path");
      const queryParams = mergedParams.filter((p) => p.inLocation === "query");
      const queryStringParams = mergedParams.filter(
        (p) => p.inLocation === "querystring",
      );
      const headerParams = mergedParams.filter(
        (p) => p.inLocation === "header",
      );
      const cookieParams = mergedParams.filter(
        (p) => p.inLocation === "cookie",
      );
      const swaggerBodyParam = mergedParams.find(
        (p) => p.inLocation === "body",
      );
      const swaggerFormParams = mergedParams.filter(
        (p) => p.inLocation === "formData",
      );

      for (const cookie of cookieParams) {
        diagnostics.push({
          code: "CLI_UNSUPPORTED_COOKIE_PARAM",
          severity: "warning",
          message: `Cookie parameter "${cookie.name}" is omitted; configure cookies or credentials on the client`,
          location: opLocation,
        });
      }

      let queryStringEntry:
        | {
            readonly schema: SchemaNode;
            readonly required: boolean;
            readonly description?: string;
          }
        | undefined;
      for (const qs of queryStringParams) {
        if (
          qs.contentMediaType?.toLowerCase() ===
            "application/x-www-form-urlencoded" &&
          qs.schema !== undefined &&
          queryParams.length === 0 &&
          queryStringEntry === undefined
        ) {
          queryStringEntry = {
            schema: registry.lowerSchema(qs.schema, "json"),
            required: qs.required,
            description: qs.description,
          };
        } else {
          diagnostics.push({
            code: "CLI_UNSUPPORTED_QUERYSTRING_PARAM",
            severity: "warning",
            message: `Querystring parameter "${qs.name}" with media type "${qs.contentMediaType ?? "unknown"}" is omitted; only "application/x-www-form-urlencoded" querystring parameters are supported`,
            location: opLocation,
          });
        }
      }

      // Request body
      const hasBodyInput =
        isRecord(op["requestBody"]) ||
        swaggerBodyParam !== undefined ||
        swaggerFormParams.length > 0;
      let bodyEntry:
        { readonly schema: SchemaNode; readonly required: boolean } | undefined;
      if (hasBodyInput && (method === "GET" || method === "HEAD")) {
        diagnostics.push({
          code: "CLI_GET_HEAD_BODY_IGNORED",
          severity: "warning",
          message: `${method} request body omitted because HTTP ${method} requests cannot carry a body`,
          location: opLocation,
        });
      } else {
        bodyEntry = resolveRequestBodySchema(
          op,
          swaggerFormParams,
          swaggerBodyParam,
          registry,
        );
      }

      // Path params
      const pathPlanParams: PathParamPlanIr[] = [];
      const pathEntries = converted.params.map((segment) => {
        const declared = pathRawParams.find((p) => p.name === segment.rawName);
        const schema = registry.lowerSchema(
          declared?.schema ?? { type: "string" },
          "json",
        );
        const isJsonContent = declared?.isJsonContent ?? false;
        const style = normalizePathStyle(declared?.style);
        const explode = declared?.explode ?? false;
        const { node: shapeNode } = unwrapNullableAndRef(schema, registry);
        const needsSerializer =
          !isJsonContent &&
          (style !== "simple" ||
            isArrayShape(shapeNode) ||
            isObjectShape(shapeNode));
        pathPlanParams.push({
          templateName: segment.templateName,
          rawName: segment.rawName,
          propName: segment.templateName,
          style,
          explode,
          needsSerializer,
          isJsonContent,
        });
        return buildInputField(
          segment.templateName,
          segment.templateName,
          schema,
          true,
          declared?.description,
        );
      });

      const RESERVED_TOP_INPUT = new Set(["query", "headers", "body", "path"]);
      const wrapPathParams = pathEntries.some((entry) =>
        RESERVED_TOP_INPUT.has(entry.propName),
      );

      // Query params
      const queryNamer = createUniqueNamer();
      const queryFields: ObjectFieldIr[] = [];
      const queryPlanFields: QueryFieldPlanIr[] = [];
      let needsCustomQuery = false;

      for (const q of queryParams) {
        const propName = queryNamer(toCamelCase(q.name, "param"));
        const node = registry.lowerSchema(
          q.schema ?? { type: "string" },
          "json",
        );
        const style: QueryParamStyle = q.isJsonContent
          ? "json"
          : normalizeQueryStyle(q.style);
        const explode = q.explode ?? style === "form";
        if (
          style !== "form" ||
          !explode ||
          !isCoreFormExplodedQueryValue(node, registry)
        ) {
          needsCustomQuery = true;
        }
        queryFields.push(
          buildInputField(propName, q.name, node, q.required, q.description),
        );
        queryPlanFields.push({
          propName,
          wireName: q.name,
          style,
          explode,
        });
      }
      const queryRequired = queryFields.some((f) => f.required);

      // Header params
      const headerNamer = createUniqueNamer();
      const headerFields: ObjectFieldIr[] = [];
      const headerPlanFields: HeaderParamPlanIr[] = [];
      for (const h of headerParams) {
        const propName = headerNamer(toCamelCase(h.name, "header"));
        const node = registry.lowerSchema(
          h.schema ?? { type: "string" },
          "json",
        );
        const entry = buildInputField(
          propName,
          h.name,
          node,
          h.required,
          h.description,
        );
        headerFields.push(entry);
        const { node: shapeNode, nullable: shapeNullable } =
          unwrapNullableAndRef(node, registry);
        const explode = h.explode ?? false;
        const needsSerializer =
          !h.isJsonContent &&
          (isArrayShape(shapeNode) || isObjectShape(shapeNode));
        headerPlanFields.push({
          wireName: entry.wireName,
          propName: entry.propName,
          required: entry.required,
          nullable: shapeNullable,
          explode,
          needsSerializer,
          isJsonContent: h.isJsonContent,
        });
      }
      const headersRequired = headerFields.some((f) => f.required);

      // Build top-level input struct
      const topFields: ObjectFieldIr[] = [];
      if (pathEntries.length > 0) {
        if (wrapPathParams) {
          topFields.push(
            buildInputField(
              "path",
              "path",
              { kind: "object", fields: pathEntries },
              true,
            ),
          );
        } else {
          topFields.push(...pathEntries);
        }
      }
      if (queryFields.length > 0) {
        topFields.push(
          buildInputField(
            "query",
            "query",
            { kind: "object", fields: queryFields },
            queryRequired,
          ),
        );
      } else if (queryStringEntry !== undefined) {
        topFields.push(
          buildInputField(
            "query",
            "query",
            queryStringEntry.schema,
            queryStringEntry.required,
            queryStringEntry.description,
          ),
        );
      }
      if (headerFields.length > 0) {
        topFields.push(
          buildInputField(
            "headers",
            "headers",
            { kind: "object", fields: headerFields },
            headersRequired,
          ),
        );
      }
      if (bodyEntry !== undefined) {
        topFields.push(
          buildInputField("body", "body", bodyEntry.schema, bodyEntry.required),
        );
      }

      const opPascal = toPascalCase(opName, "Operation");
      const inputOptional =
        topFields.length > 0 && topFields.every((field) => !field.required);
      let inputSchema: SchemaRefNode | undefined;
      if (topFields.length > 0) {
        const inputDecl = registry.registerSynthesizedSchema(
          { kind: "object", fields: topFields },
          `${opPascal}Input`,
          "input",
        );
        inputSchema = { kind: "ref", id: inputDecl.id, name: inputDecl.name };
      }

      const resolvedQueryRequired =
        queryFields.length > 0
          ? queryRequired
          : (queryStringEntry?.required ?? false);
      const hasQuery = queryFields.length > 0 || queryStringEntry !== undefined;
      const builder: BuilderPlanIr | undefined =
        topFields.length > 0
          ? {
              pathParams: pathPlanParams,
              ...(wrapPathParams ? { pathWrapperProp: "path" } : {}),
              hasQuery,
              queryRequired: resolvedQueryRequired,
              ...(needsCustomQuery
                ? { customQueryFields: queryPlanFields }
                : {}),
              headers: headerPlanFields,
              headersRequired,
              hasBody: bodyEntry !== undefined,
            }
          : undefined;

      // Responses
      const responsesRaw = isRecord(op["responses"]) ? op["responses"] : {};
      let sseEvents: SseEventIr[] | undefined;
      const bodyful2xx: { status: string; schema: SchemaNode }[] = [];
      const empty2xx: string[] = [];
      const errorSchemas: SchemaNode[] = [];

      for (const [status, responseRaw] of Object.entries(responsesRaw)) {
        if (!isRecord(responseRaw)) {
          continue;
        }
        if (is2xxStatus(status)) {
          const content = responseRaw["content"];
          if (isRecord(content) && isRecord(content["text/event-stream"])) {
            const sseMedia = content["text/event-stream"];
            const itemSchema =
              "itemSchema" in sseMedia
                ? sseMedia["itemSchema"]
                : sseMedia["schema"];
            sseEvents = extractSseEvents(
              itemSchema ?? { type: "string" },
              registry,
            ).map((ev) => ({
              eventName: ev.eventName,
              schema: ensureOperationSchemaRef(
                ev.schema,
                `${opPascal}${toPascalCase(ev.eventName, "Event")}Event`,
                registry,
              ),
            }));
            continue;
          }
          const bodySchema = lowerResponseContent(responseRaw, registry);
          if (bodySchema !== undefined && !EMPTY_STATUS_CODES.has(status)) {
            bodyful2xx.push({ status, schema: bodySchema });
          } else {
            empty2xx.push(status);
          }
        } else if (options.errorStrategy === "union" && isErrorStatus(status)) {
          const errSchema = lowerResponseContent(responseRaw, registry);
          if (errSchema !== undefined) {
            errorSchemas.push(errSchema);
          }
        }
      }

      const rawErrorSchema =
        options.errorStrategy === "union"
          ? combineSchemas(errorSchemas, registry)
          : undefined;
      const errorSchema =
        rawErrorSchema !== undefined
          ? ensureOperationSchemaRef(
              rawErrorSchema,
              `${opPascal}Error`,
              registry,
            )
          : undefined;
      const description =
        readString(op["summary"]) ?? readString(op["description"]);

      if (sseEvents !== undefined) {
        const sseOp: SseOperationIr = {
          kind: "sse",
          name: opName,
          group,
          method,
          path: converted.path,
          description,
          inputSchema,
          inputOptional,
          builder,
          events: sseEvents,
          errorSchema,
        };
        operations.push(sseOp);
        continue;
      }

      const combined2xx = combineSchemas(
        bodyful2xx.map((item) => item.schema),
        registry,
      );

      const isMixed2xx = bodyful2xx.length > 0 && empty2xx.length > 0;
      if (isMixed2xx) {
        const bodyStatuses = bodyful2xx.map((x) => x.status).join(", ");
        const emptyStatuses = empty2xx.join(", ");
        diagnostics.push({
          code: "CLI_MIXED_2XX_RESPONSE",
          severity: "warning",
          message: `Operation "${opName}" mixes body-bearing (${bodyStatuses}) and empty (${emptyStatuses}) 2xx responses; strategy "${options.mixed2xxStrategy}" applied`,
          location: opLocation,
        });

        if (options.mixed2xxStrategy === "omit") {
          const omittedOp: HttpOperationIr = {
            kind: "http",
            name: opName,
            group,
            method,
            path: converted.path,
            description,
            mixed2xxNote: `Omitted \`output\` because 2xx statuses mix body (${bodyStatuses}) and empty (${emptyStatuses}) responses.`,
            inputSchema,
            inputOptional,
            builder,
            outputSchema: undefined,
            errorSchema,
          };
          operations.push(omittedOp);
          continue;
        }
      }

      const outputSchema =
        combined2xx !== undefined
          ? ensureOperationSchemaRef(combined2xx, `${opPascal}Output`, registry)
          : undefined;
      const primaryOp: HttpOperationIr = {
        kind: "http",
        name: opName,
        group,
        method,
        path: converted.path,
        description,
        inputSchema,
        inputOptional,
        builder,
        outputSchema,
        errorSchema,
      };

      if (isMixed2xx) {
        const noContentName = namer(`${opName}NoContent`);
        const emptyOp: HttpOperationIr = {
          kind: "http",
          name: noContentName,
          group,
          method,
          path: converted.path,
          description: description
            ? `${description} (empty-body 2xx variant)`
            : "Empty-body 2xx variant",
          inputSchema,
          inputOptional,
          builder,
          outputSchema: undefined,
          errorSchema,
        };
        operations.push(primaryOp, emptyOp);
        continue;
      }

      operations.push(primaryOp);
    }
  }

  return { operations, diagnostics };
}

export function collectOperationRefIds(op: OperationIr): Set<string> {
  const refs = new Set<string>();
  if (op.inputSchema !== undefined) {
    refs.add(op.inputSchema.id);
  }
  if (op.errorSchema !== undefined) {
    refs.add(op.errorSchema.id);
  }
  if (op.kind === "http") {
    if (op.outputSchema !== undefined) {
      refs.add(op.outputSchema.id);
    }
  } else {
    for (const event of op.events) {
      refs.add(event.schema.id);
    }
  }
  return refs;
}
