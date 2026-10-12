// #region example
import { createClient, withEndpoint, withSSEReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEReconnect({
    attempts: 3,
    delayMs: 1_000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.5,
    shouldReconnect({ lastEventId, method }) {
      // A POST is replayed only when the server can resume it from Last-Event-ID.
      return method === 'GET' || lastEventId !== ''
    },
  }),
)
// #endregion
