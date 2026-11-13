/** Elapsed-time clock; Date is only a fallback for platforms without Performance. */
export function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
