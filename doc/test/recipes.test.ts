import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function executeRecipe(name: string, observations: string): Promise<void> {
  const code = await Bun.file(new URL(`../examples/recipes/${name}.ts`, import.meta.url)).text()

  // Run the example file that the recipe page includes and observe the responses produced by its mock.
  const source = code
    .replace("'@defjs/core'", JSON.stringify(new URL('../../packages/core/src/index.ts', import.meta.url).href))
    .replace(/\bwithHTTPHandle\b/, 'withHTTPHandle as installHTTPHandle')
  const observed = `
const statuses: number[] = []
function withHTTPHandle(handle: Parameters<typeof installHTTPHandle>[0]) {
  return installHTTPHandle(async (input, init) => {
    const response = await handle(input, init)
    statuses.push(response.status)
    return response
  })
}
${source}
export { statuses }
${observations}
`
  const directory = await mkdtemp(join(tmpdir(), 'defjs-recipe-'))
  const filename = join(directory, 'recipe.ts')
  await Bun.write(filename, observed)
  const result = await import(filename).finally(() => rm(directory, { recursive: true, force: true }))
  if (name === 'etag-revalidate') {
    expect(result.statuses).toEqual([200, 304])
    expect(result.product.name).toBe('Flask')
  } else if (name === 'graphql-http-envelope') {
    expect(result.viewer.login).toBe('ada')
    expect(result.statuses).toEqual([200, 200, 200, 200])
    expect(result.graphQlErrors).toEqual(['viewer unavailable', 'viewer unavailable'])
    expect(result.nullableError.message).toBe('viewer unavailable')
    expect(result.nullableError.code).toBeUndefined()
  } else {
    expect(result.statuses).toEqual([401, 200])
    expect(result.credential.accessToken).toBe('v2')
    expect(result.error).toBeNull()
    expect(result.invoice.total).toBe(42)
  }
}

test('ETag recipe reuses the cached product after a real 304', async () => {
  await executeRecipe('etag-revalidate', 'export { product }')
})

test('Bearer recipe refreshes the credential after a real 401', async () => {
  await executeRecipe('refresh-bearer-once', 'export { credential, error, invoice }')
})

test('GraphQL recipe unwraps data: null with errors as an application error', async () => {
  await executeRecipe(
    'graphql-http-envelope',
    `const nullableError = await loadViewer(createClient(
      withEndpoint('https://api.example.test'),
      withHTTPHandle(async () => Response.json({ data: null, errors: [{ message: 'viewer unavailable' }] })),
    )).catch((error: unknown) => error)
    export { viewer, graphQlErrors, nullableError }`,
  )
})
