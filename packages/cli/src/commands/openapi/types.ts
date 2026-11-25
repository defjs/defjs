import type { CliDiagnostic } from "../../runtime/types.ts";

/**
 * Supported output module formats for generated Defjs definitions.
 *
 * - `"ts"`: TypeScript ESM files (`.ts`)
 * - `"tsx"`: TypeScript JSX ESM files (`.tsx`)
 * - `"js"`: JavaScript ESM files (`.js`) with companion `.d.ts` declarations
 * - `"mjs"`: ES module files (`.mjs`) with companion `.d.mts` declarations
 *
 * @group cli
 */
export type OpenApiOutputFormat = "ts" | "tsx" | "js" | "mjs";

/**
 * File synchronization strategy for OpenAPI code generation.
 *
 * - `"sync"`: Updates managed files and deletes stale managed files removed from the spec
 * - `"scaffold"`: Writes only missing files and preserves existing files untouched
 *
 * @group cli
 */
export type OpenApiGenerationMode = "sync" | "scaffold";

/**
 * Strategy for emitting `error` structs on HTTP operations.
 *
 * - `"none"`: Omits `error` structs so non-2xx proxy or gateway payloads (such as HTML 502s) do not fail decoding
 * - `"union"`: Synthesizes a union or discriminated union from documented non-2xx JSON responses
 *
 * @group cli
 */
export type OpenApiErrorStrategy = "none" | "union";

/**
 * Strategy when an operation declares both body-bearing 2xx responses (such as 200 JSON)
 * and empty 2xx responses (such as 204 No Content).
 *
 * - `"omit"`: Emits a diagnostic warning and omits `output` from the operation
 * - `"split"`: Emits the primary operation with `output` and a companion `<name>NoContent` operation without `output`
 *
 * @group cli
 */
export type OpenApiMixed2xxStrategy = "omit" | "split";

/**
 * Plain OpenAPI document object, such as an imported JSON or TypeScript specification module.
 *
 * @group cli
 */
export type OpenApiDocumentObject = { readonly [key: string]: unknown };

/**
 * Accepted OpenAPI source for {@link OpenApiTargetConfig}.
 *
 * Supports a local YAML/JSON/TS/JS file path, an `http(s):` URL, inline YAML/JSON text,
 * an imported OpenAPI object, or a zero-argument loader function.
 *
 * @group cli
 */
export type OpenApiInput =
  | string
  | OpenApiDocumentObject
  | (() =>
      string | OpenApiDocumentObject | Promise<string | OpenApiDocumentObject>);

/**
 * Output directory and formatting options for a generated Defjs API target.
 *
 * @group cli
 */
export interface OpenApiOutputConfig {
  /** Target directory where `index`, `request/`, and `schema/` files are written. */
  readonly dir: string;
  /** Emitted file format. Defaults to `"ts"`. */
  readonly format?: OpenApiOutputFormat;
  /** Module specifier used when importing Defjs runtime primitives. Defaults to `"@defjs/core"`. */
  readonly coreImport?: string;
}

/**
 * Single OpenAPI generation target configured in `defjs.config.ts` or passed to {@link generateOpenApi}.
 *
 * @group cli
 */
export interface OpenApiTargetConfig {
  /** OpenAPI source path, URL, inline specification string, imported object, or loader function. */
  readonly input: OpenApiInput;
  /** Destination directory and output module format. */
  readonly output: OpenApiOutputConfig;
  /** File management mode. Defaults to `"sync"`. */
  readonly mode?: OpenApiGenerationMode;
  /** Non-2xx response `error` struct generation strategy. Defaults to `"none"`. */
  readonly errorStrategy?: OpenApiErrorStrategy;
  /** Mixed body + empty 2xx response handling strategy. Defaults to `"omit"`. */
  readonly mixed2xxStrategy?: OpenApiMixed2xxStrategy;
  /** Optional allowlist of operationIds or `"METHOD /path"` keys to generate. */
  readonly include?: readonly string[];
  /** Optional blocklist of operationIds or `"METHOD /path"` keys to omit. */
  readonly exclude?: readonly string[];
}

/**
 * Programmatic options passed to {@link generateOpenApi}.
 *
 * @group cli
 */
export interface GenerateOpenApiOptions {
  /** Single OpenAPI target configuration to execute. */
  readonly target: OpenApiTargetConfig;
  /** Working directory used to resolve relative paths. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** When `true`, compares expected files against disk without writing or deleting. */
  readonly check?: boolean;
  /** Optional custom `fetch` implementation used for `http(s):` OpenAPI URLs. */
  readonly fetch?: (url: string) => Promise<Response>;
}

/**
 * Summary returned by {@link generateOpenApi}.
 *
 * @group cli
 */
export interface OpenApiGenerateResult {
  /** Output directory path. */
  readonly outDir: string;
  /** File paths created or updated (relative to `outDir`). */
  readonly written: readonly string[];
  /** Existing file paths preserved untouched in `"scaffold"` mode (relative to `outDir`). */
  readonly skipped: readonly string[];
  /** Stale managed file paths removed in `"sync"` mode (relative to `outDir`). */
  readonly deleted: readonly string[];
  /** Up-to-date file paths that did not need changes (relative to `outDir`). */
  readonly unchanged: readonly string[];
  /** Out-of-sync file paths detected when `check` is `true` (relative to `outDir`). */
  readonly drifted: readonly string[];
  /** Diagnostics produced during parsing, lowering, or emission. */
  readonly diagnostics: readonly CliDiagnostic[];
  /** Number of operations emitted in this target. */
  readonly operationCount: number;
  /** Number of named schemas emitted in this target. */
  readonly schemaCount: number;
}
