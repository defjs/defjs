/**
 * Reports a failure the runtime contained, as the HTML `reportError` hook does
 * for an unhandled exception. Where the runtime has no hook the failure stays
 * contained.
 */
export function reportContainedError(error: unknown): void {
  const report = globalThis.reportError;
  if (typeof report !== "function") return;
  try {
    report(error);
  } catch {
    // Reporting must never replace the operation tuple.
  }
}
