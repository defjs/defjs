/** Per-strategy endpoint history ceiling, independent of candidate-list churn. */
const MAX_ENDPOINT_STATES = 256;

/** Touches LRU order; evicts the lowest-priority state first, with oldest-first ties. */
export function rememberEndpoint<T>(
  states: Map<string, T>,
  endpoint: string,
  state: T,
  evictionPriority: (state: T) => number,
): void {
  states.delete(endpoint);
  if (states.size >= MAX_ENDPOINT_STATES) {
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
