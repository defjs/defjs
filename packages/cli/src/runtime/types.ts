/**
 * Severity level attached to a CLI diagnostic.
 *
 * @group cli
 */
export type CliDiagnosticSeverity = "warning" | "error";

/**
 * Structured diagnostic emitted during CLI parsing, lowering, or generation.
 *
 * @group cli
 */
export interface CliDiagnostic {
  /** Machine-readable diagnostic code. */
  readonly code: string;
  /** Diagnostic severity. */
  readonly severity: CliDiagnosticSeverity;
  /** Human-readable explanation. */
  readonly message: string;
  /** Optional operation identifier or JSON pointer location. */
  readonly location?: string;
}

/**
 * Output streams injected into {@link runCli}.
 *
 * @group cli
 */
export interface CliIo {
  /** Receives standard CLI output such as help text and summaries. */
  readonly stdout: (text: string) => void;
  /** Receives warnings and error messages. */
  readonly stderr: (text: string) => void;
  /** Working directory override. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Optional custom `fetch` passed to OpenAPI URL loading. */
  readonly fetch?: (url: string) => Promise<Response>;
}
