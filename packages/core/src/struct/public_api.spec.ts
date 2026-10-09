import { beforeAll, expect, test } from 'vitest'

// Load the barrel outside the per-test timeout. A dynamic import inside the test
// counts cold transform time against that budget.
let core: object

beforeAll(async () => {
  core = await import('../index')
})

test('STRUCT is not a public runtime value', () => {
  expect(Object.hasOwn(core, 'STRUCT')).toBe(false)
})
