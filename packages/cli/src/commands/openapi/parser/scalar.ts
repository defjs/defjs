import { existsSync } from "node:fs";
import { basename, extname, resolve } from "pathe";
import { dereference, load, upgrade, validate } from "@scalar/openapi-parser";
import type { Filesystem } from "@scalar/openapi-parser";
import { fetchUrls } from "@scalar/openapi-parser/plugins/fetch-urls";
import { readFiles } from "@scalar/openapi-parser/plugins/read-files";
import { loadModuleDefaultExport } from "../../../config/loader.ts";
import {
  CliError,
  errorMessage,
  isRecord,
  requireRecord,
} from "../../../runtime/diagnostics.ts";
import type { CliDiagnostic } from "../../../runtime/types.ts";
import type { OpenApiDocumentObject, OpenApiInput } from "../types.ts";

export interface SchemaRefMeta {
  readonly key: string;
  readonly name: string;
}

interface ParsedOpenApiDocument {
  readonly document: { [key: string]: unknown };
  readonly refMeta: WeakMap<object, SchemaRefMeta>;
  readonly version: string;
}

const MODULE_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);
const SPEC_FILE_EXTENSIONS = new Set([
  ".yaml",
  ".yml",
  ".json",
  ".ts",
  ".mts",
  ".js",
  ".mjs",
]);

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function formatErrorLocation(
  path: string | readonly string[] | undefined,
): string | undefined {
  if (typeof path === "string" && path !== "") {
    return path;
  }
  if (Array.isArray(path) && path.length > 0) {
    return path.join(".");
  }
  return undefined;
}

export function toDiagnostics(
  errors: readonly {
    path?: string | string[];
    message: string;
    code?: string;
  }[],
  fallbackCode: string,
): CliDiagnostic[] {
  return errors.map((err) => {
    const location = formatErrorLocation(err.path);
    return {
      code: typeof err.code === "string" ? err.code : fallbackCode,
      severity: "error",
      message: err.message,
      ...(location !== undefined ? { location } : {}),
    };
  });
}

export function resolveSchemaRefMeta(ref: string): SchemaRefMeta | undefined {
  const hashIndex = ref.indexOf("#");
  if (hashIndex !== -1) {
    const pointer = ref.slice(hashIndex + 1);
    const segments = pointer.split("/").filter((part) => part !== "");
    const last = segments.at(-1);
    if (last !== undefined) {
      return {
        key: ref,
        name: decodeURIComponent(
          last.replaceAll("~1", "/").replaceAll("~0", "~"),
        ),
      };
    }
  }
  const cleanPath = ref.replace(/[?#].*$/, "");
  const base = basename(cleanPath);
  if (base === "") {
    return undefined;
  }
  const dotIndex = base.lastIndexOf(".");
  return {
    key: ref,
    name: dotIndex > 0 ? base.slice(0, dotIndex) : base,
  };
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function setRefMetaIfAbsent(
  refMeta: WeakMap<object, SchemaRefMeta>,
  target: unknown,
  meta: SchemaRefMeta,
): void {
  if (isRecord(target) && !refMeta.has(target)) {
    refMeta.set(target, meta);
  }
}

function registerParameterSchema(
  refMeta: WeakMap<object, SchemaRefMeta>,
  target: unknown,
  meta: SchemaRefMeta,
): void {
  if (!isRecord(target)) {
    return;
  }
  const schema = target["schema"];
  if (isRecord(schema) && !("$ref" in schema) && !refMeta.has(schema)) {
    refMeta.set(schema, meta);
  }
}

export function recordDereferencedRefMeta(
  refMeta: WeakMap<object, SchemaRefMeta>,
  data: {
    readonly ref: string;
    readonly resolved?: unknown;
    readonly schema?: unknown;
  },
): void {
  const meta = resolveSchemaRefMeta(data.ref);
  if (meta === undefined) {
    return;
  }
  setRefMetaIfAbsent(refMeta, data.resolved, meta);
  setRefMetaIfAbsent(refMeta, data.schema, meta);
  registerParameterSchema(refMeta, data.resolved, meta);
  registerParameterSchema(refMeta, data.schema, meta);
}

function registerSchemaEntries(
  container: unknown,
  prefix: string,
  refMeta: WeakMap<object, SchemaRefMeta>,
): void {
  if (!isRecord(container)) {
    return;
  }
  for (const [key, value] of Object.entries(container)) {
    if (isRecord(value) && !refMeta.has(value)) {
      refMeta.set(value, {
        key: `${prefix}/${escapePointerSegment(key)}`,
        name: key,
      });
    }
  }
}

function registerParameterEntries(
  container: unknown,
  prefix: string,
  refMeta: WeakMap<object, SchemaRefMeta>,
): void {
  if (!isRecord(container)) {
    return;
  }
  for (const [key, value] of Object.entries(container)) {
    registerParameterSchema(refMeta, value, {
      key: `${prefix}/${escapePointerSegment(key)}`,
      name: key,
    });
  }
}

function registerNamedSchemas(
  doc: { [key: string]: unknown },
  refMeta: WeakMap<object, SchemaRefMeta>,
): void {
  const components = doc["components"];
  if (isRecord(components)) {
    registerSchemaEntries(
      components["schemas"],
      "#/components/schemas",
      refMeta,
    );
    registerParameterEntries(
      components["parameters"],
      "#/components/parameters",
      refMeta,
    );
  }
  registerSchemaEntries(doc["definitions"], "#/definitions", refMeta);
  registerParameterEntries(doc["parameters"], "#/parameters", refMeta);
}

async function resolveInputValue(
  input: OpenApiInput,
  cwd: string,
): Promise<string | OpenApiDocumentObject> {
  const value = typeof input === "function" ? await input() : input;
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new CliError("OpenAPI input must not be empty", 1);
  }
  if (isHttpUrl(trimmed)) {
    return trimmed;
  }
  if (!value.includes("\n") && !value.includes("\r")) {
    const ext = extname(trimmed).toLowerCase();
    const absPath = resolve(cwd, trimmed);
    if (SPEC_FILE_EXTENSIONS.has(ext) && !existsSync(absPath)) {
      throw new CliError(`OpenAPI input file not found: ${absPath}`, 1);
    }
    if (MODULE_EXTENSIONS.has(ext)) {
      const exported = await loadModuleDefaultExport(absPath);
      if (typeof exported === "string" || isRecord(exported)) {
        return exported;
      }
      throw new CliError(
        `OpenAPI module ${absPath} must default-export a document object or YAML/JSON string`,
        1,
      );
    }
    if (existsSync(absPath)) {
      return absPath;
    }
  }
  return value;
}

export async function loadOpenApiDocument(options: {
  readonly input: OpenApiInput;
  readonly cwd: string;
  readonly fetch?: (url: string) => Promise<Response>;
}): Promise<ParsedOpenApiDocument> {
  const resolved = await resolveInputValue(options.input, options.cwd);
  // `@scalar/openapi-parser`'s `upgrade()` mutates object inputs in place; clone
  // caller-owned objects (and cached module exports) before handing them to Scalar.
  const source =
    typeof resolved === "string" ? resolved : structuredClone(resolved);
  const plugins = [
    readFiles(),
    fetchUrls(options.fetch ? { fetch: options.fetch } : undefined),
  ];

  let loadResult: {
    filesystem: Filesystem;
    specification: { [key: string]: unknown } | null;
    errors?: { path?: string | string[]; message: string; code?: string }[];
  };
  try {
    loadResult = await load(source, { plugins });
  } catch (error) {
    throw new CliError(
      `Failed to load OpenAPI input: ${errorMessage(error)}`,
      1,
      [],
      { cause: error },
    );
  }

  if (loadResult.errors && loadResult.errors.length > 0) {
    const diagnostics = toDiagnostics(loadResult.errors, "CLI_OPENAPI_LOAD");
    throw new CliError(
      diagnostics.map((d) => d.message).join("; "),
      1,
      diagnostics,
    );
  }

  const validation = await validate(loadResult.filesystem);
  if (!validation.valid) {
    const diagnostics = toDiagnostics(validation.errors, "CLI_OPENAPI_INVALID");
    const summary = diagnostics.map((d) => d.message).join("; ");
    throw new CliError(
      `Invalid OpenAPI specification: ${summary}`,
      1,
      diagnostics,
    );
  }

  const refMeta = new WeakMap<object, SchemaRefMeta>();
  const dereferenceTarget =
    loadResult.filesystem.length === 1
      ? requireRecord(
          upgrade(loadResult.filesystem).specification,
          "Failed to upgrade OpenAPI specification",
        )
      : loadResult.filesystem;

  if (!Array.isArray(dereferenceTarget)) {
    registerNamedSchemas(dereferenceTarget, refMeta);
  }

  const dereferenced = dereference(dereferenceTarget, {
    onDereference: (data) => {
      recordDereferencedRefMeta(refMeta, data);
    },
  });

  const docCandidate = requireRecord(
    dereferenced.schema,
    "Dereferenced OpenAPI schema is not an object",
  );

  registerNamedSchemas(docCandidate, refMeta);

  return {
    document: docCandidate,
    refMeta,
    version: validation.version,
  };
}
