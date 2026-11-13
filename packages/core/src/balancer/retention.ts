/** Per-strategy endpoint history floor, independent of candidate-list churn. */
const MAX_ENDPOINT_STATES = 256;

/**
 * Touches LRU order; evicts the lowest-priority state first, with oldest-first ties.
 *
 * History holds at least 256 endpoints and grows to `members`, so a list larger
 * than the floor never evicts its own endpoints.
 */
export function rememberEndpoint<T>(
  states: Map<string, T>,
  endpoint: string,
  state: T,
  evictionPriority: (state: T) => number,
  members: number,
): void {
  states.delete(endpoint);
  if (states.size >= Math.max(MAX_ENDPOINT_STATES, members)) {
    let oldest = endpoint;
    let priority = Infinity;
    for (const [key, value] of states) {
      const rank = evictionPriority(value);
      if (rank < priority) {
        oldest = key;
        priority = rank;
        if (rank === 0) break;
      }
    }
    states.delete(oldest);
  }
  states.set(endpoint, state);
}
