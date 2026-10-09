import { describe, expect, test } from 'vitest'
import { struct } from '../struct'
import { STRUCT } from '../struct/symbols'
import { parseEndpointInput } from './endpoint_input'

describe('endpoint input helpers', () => {
  test('should parse endpoint input and keep raw input when struct is omitted', async () => {
    const input = {
      id: '1',
    }
    const User = struct.object({
      id: struct.number(),
    })

    expect(await parseEndpointInput(undefined, input)).toBe(input)
    const parsed = await parseEndpointInput(User, { id: 1 })
    expect(parsed.id).toBe(1)
    expect(Object.keys(parsed)).toEqual(['id'])
    expect((parsed as { [STRUCT]?: unknown })[STRUCT]).toBe(User)
  })
})
