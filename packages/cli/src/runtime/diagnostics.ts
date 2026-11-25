import type { CliDiagnostic } from "./types.ts";

/** Error thrown for CLI usage or execution failures with an explicit exit code. */
export class CliError extends Error {
  readonly exitCode: 1 | 2;
  readonly diagnostics: readonly CliDiagnostic[];

  constructor(
    message: string,
    exitCode: 1 | 2,
    diagnostics: readonly CliDiagnostic[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.diagnostics = diagnostics;
  }
}

export function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(
  value: unknown,
  message: string,
): { [key: string]: unknown } {
  if (!isRecord(value)) {
    throw new CliError(message, 1);
  }
  return value;
}

export function isUnknownFunction(
  value: unknown,
): value is (...args: readonly unknown[]) => unknown {
  return typeof value === "function";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function formatDiagnostic(diagnostic: CliDiagnostic): string {
  const prefix = diagnostic.severity === "error" ? "error" : "warning";
  const loc = diagnostic.location ? ` (${diagnostic.location})` : "";
  return `${prefix} [${diagnostic.code}]${loc}: ${diagnostic.message}`;
}
