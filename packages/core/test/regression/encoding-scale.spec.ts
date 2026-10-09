import { expect, test } from 'vitest'
import { struct } from '../../src'
import { parseEndpointInput } from '../../src/internal/endpoint_input'
import { encodeOutbound } from '../../src/internal/outbound_request'
import { STRUCT } from '../../src/struct/symbols'

// Three parse+encode passes of 100_000 nodes have exceeded vitest's 5s default once under full-suite load.
test.each([10_000, 100_000])(
  'tags and encodes %s object nodes without touching public parse output',
  async (size) => {
    const Item = struct.object({ id: struct.number().alias('item_id'), count: struct.bigint() })
    const Schema = struct.array(Item)
    const input = Array.from({ length: size }, (_, id) => ({ id, count: BigInt(id) }))
    const samples: { parseMs: number; encodeMs: number }[] = []
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now()
      const parsed = await parseEndpointInput(Schema, input)
      const parsedAt = performance.now()
      const encoded = encodeOutbound(parsed)
      const encodedAt = performance.now()
      expect(parsed.filter((item) => Object.hasOwn(item, STRUCT))).toHaveLength(size)
      expect(encoded).toEqual(input.map(({ id }) => ({ item_id: id, count: String(id) })))
      samples.push({ parseMs: parsedAt - start, encodeMs: encodedAt - parsedAt })
    }
    const [fault, publicParsed] = struct.parse(Schema, input)
    expect(fault).toBeNull()
    expect(publicParsed?.some((item) => Object.hasOwn(item, STRUCT))).toBe(false)
    console.log('ROUND5_SCALE', size, JSON.stringify(samples))
  },
  30_000,
)
