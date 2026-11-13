// Import this file before any vi.useFakeTimers() call so the real timer is captured.
const realSetTimeout = globalThis.setTimeout;

export function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    realSetTimeout(resolve, 0);
  });
}
