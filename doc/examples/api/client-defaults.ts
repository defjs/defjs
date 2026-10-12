// #region example
import { createClient, defineRequest, struct, withEndpoint, withHeaders, withTimeout } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withHeaders({ 'X-Client': 'web', Accept: 'application/json' }),
  withTimeout(5_000),
)

const search = defineRequest({
  method: 'GET',
  path: '/search',
  input: struct.object({ q: struct.string() }),
  // This request's Accept replaces the client default; X-Client is still sent.
  builder: (input) => ({ query: input, headers: { Accept: 'text/plain' } }),
  output: struct.string(),
})

// The execute timeout replaces the 5 s client default for this call only.
await client.execute(search({ q: 'defjs' }), { timeout: 30_000 })
// #endregion
