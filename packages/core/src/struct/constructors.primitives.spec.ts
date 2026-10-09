import { describe, expect, test } from 'vitest'
import { encodeJson } from './codec/json'
import { encodeValue } from './encode'
import { StructError, struct } from './index'
import { parseStructTuple as parse } from './introspection'
import type { RuntimeStruct } from './types'

function encode(struct: unknown, value: unknown): unknown {
  return encodeValue(struct as RuntimeStruct, value)
}

describe('constructors.ts bigint and date primitives', () => {
  test('bigint accepts BigInt and string wire form, rejects number', () => {
    const [e1, v1] = parse(struct.bigint(), 42n)
    if (e1) {
      throw e1
    }
    expect(v1).toBe(42n)

    const [e2, v2] = parse(struct.bigint(), '42')
    if (e2) {
      throw e2
    }
    expect(v2).toBe(42n)

    const [e3, v3] = parse(struct.bigint(), '9007199254740993')
    if (e3) {
      throw e3
    }
    expect(v3).toBe(9007199254740993n)

    const [e4, v4] = parse(struct.bigint(), undefined)
    expect(e4).toBeInstanceOf(StructError)
    expect(v4).toBeUndefined()

    const [e5] = parse(struct.bigint(), 42)
    expect(e5).toBeInstanceOf(StructError)
    expect(e5?.message).toContain('Expected bigint')

    const [e6] = parse(struct.bigint(), 'abc')
    expect(e6).toBeInstanceOf(StructError)
    expect(e6?.message).toContain('Expected bigint')
  })

  test('bigint encodes back to string wire form', () => {
    expect(encode(struct.bigint(), 42n)).toBe('42')
    const [err, parsed] = parse(struct.bigint(), '9007199254740993')
    if (err) {
      throw err
    }
    expect(encode(struct.bigint(), parsed as bigint)).toBe('9007199254740993')
  })

  test('date accepts Date instance, ISO string, and epoch number', () => {
    const d = new Date('2026-05-12T10:00:00Z')
    const [e1, v1] = parse(struct.date(), d)
    if (e1) {
      throw e1
    }
    expect(v1).toBe(d)

    const [e2, v2] = parse(struct.date(), '2026-05-12T10:00:00Z')
    if (e2) {
      throw e2
    }
    expect((v2 as Date).getTime()).toBe(d.getTime())

    const [e3, v3] = parse(struct.date(), d.getTime())
    if (e3) {
      throw e3
    }
    expect((v3 as Date).getTime()).toBe(d.getTime())

    const [e4, value] = parse(struct.date(), undefined)
    expect(e4).toBeInstanceOf(StructError)
    expect(value).toBeUndefined()
  })

  test('date rejects invalid wire input with invalid_type code', () => {
    const [e1] = parse(struct.date(), new Date('not-a-date'))
    expect(e1).toBeInstanceOf(StructError)
    expect(e1?.message).toContain('Expected Date')
    expect(e1?.issues[0]?.code).toBe('invalid_type')

    const [e2] = parse(struct.date(), 'not-a-date')
    expect(e2).toBeInstanceOf(StructError)
    expect(e2?.message).toContain('Expected Date')
    expect(e2?.issues[0]?.code).toBe('invalid_type')

    const [e3] = parse(struct.date(), true)
    expect(e3).toBeInstanceOf(StructError)
    expect(e3?.message).toContain('Expected Date')
  })

  test('date encodes back to ISO string', () => {
    const d = new Date('2026-05-12T10:00:00Z')
    expect(encode(struct.date(), d)).toBe('2026-05-12T10:00:00.000Z')
    const [err, parsed] = parse(struct.date(), '2026-05-12T10:00:00Z')
    if (err) {
      throw err
    }
    expect(encode(struct.date(), parsed as Date)).toBe('2026-05-12T10:00:00.000Z')
  })
})

describe('constructors.ts intersection', () => {
  test('intersection rejects empty struct list at runtime', () => {
    expect(() => (struct.intersection as unknown as (...structs: unknown[]) => unknown)()).toThrow(
      new TypeError('intersection requires at least one struct'),
    )
  })

  test('intersection of one struct is the struct itself', () => {
    const named = struct.object({ name: struct.string() })

    expect(parse(struct.intersection(named), { name: 'x' })).toEqual([null, { name: 'x' }])
  })

  test('intersection merges two object structs field-wise', () => {
    const named = struct.object({ name: struct.string() })
    const aged = struct.object({ age: struct.number() })
    const person = struct.intersection(named, aged)

    const [okErr, okVal] = parse(person, { name: 'x', age: 30 })
    if (okErr) {
      throw okErr
    }
    expect(okVal).toEqual({ name: 'x', age: 30 })

    const [badErr] = parse(person, { name: 'x', age: 'bad' })
    expect(badErr).toBeInstanceOf(StructError)
  })

  test('nested object intersections flatten into one merge', () => {
    const person = struct.intersection(
      struct.intersection(struct.object({ name: struct.string() }), struct.object({ age: struct.number() })),
      struct.object({ active: struct.boolean() }),
    )

    const [okErr, okVal] = parse(person, { active: true, age: 30, name: 'x' })
    if (okErr) {
      throw okErr
    }
    expect(okVal).toEqual({ active: true, age: 30, name: 'x' })
  })

  test('intersection merges three object structs field-wise', () => {
    const person = struct.intersection(
      struct.object({ name: struct.string() }),
      struct.object({ age: struct.number() }),
      struct.object({ active: struct.boolean() }),
    )

    const [okErr, okVal] = parse(person, { active: true, age: 30, name: 'x' })
    if (okErr) {
      throw okErr
    }
    expect(okVal).toEqual({ active: true, age: 30, name: 'x' })

    const [badErr] = parse(person, { active: true, age: 30, name: false })
    expect(badErr).toBeInstanceOf(StructError)
  })

  test('intersection emits every wire key when one logical key has several aliases', () => {
    const schema = struct.intersection(struct.object({ a: struct.string().alias('x') }), struct.object({ a: struct.string().alias('y') }))
    expect(parse(schema, { a: 'v' })).toEqual([null, { a: 'v' }])
    expect(encodeJson(schema, { a: 'v' })).toEqual({ x: 'v', y: 'v' })
    expect(parse(schema, { x: 'v', y: 'v' }, { aliases: true })).toEqual([null, { a: 'v' }])
    expect(parse(schema, { x: 'L', y: 'R' }, { aliases: true })[0]?.issues[0]).toMatchObject({
      code: 'invalid_intersection',
      path: ['a'],
      received: 'R',
    })
    expect(parse(schema, { x: 'v' }, { aliases: true })[0]?.issues[0]?.code).toBe('missing_key')

    const nested = struct.intersection(
      struct.object({ profile: struct.object({ name: struct.string().alias('full_name') }) }),
      struct.object({ profile: struct.object({ name: struct.string().alias('display_name') }) }),
    )
    expect(parse(nested, { profile: { name: 'Ada' } })).toEqual([null, { profile: { name: 'Ada' } }])
    expect(encodeJson(nested, { profile: { name: 'Ada' } })).toEqual({ profile: { display_name: 'Ada', full_name: 'Ada' } })
  })

  test('intersection encodes each matching union branch under its own wire key', () => {
    const schema = struct.intersection(
      struct.object({ a: struct.string().alias('x') }),
      struct.or(struct.object({ a: struct.string().alias('y') }), struct.number()),
    )
    expect(parse(schema, { a: 'v' })).toEqual([null, { a: 'v' }])
    expect(encodeJson(schema, { a: 'v' })).toEqual({ x: 'v', y: 'v' })

    const discriminated = struct.intersection(
      struct.object({ a: struct.string().alias('x') }),
      struct.discriminatedUnion('kind', [
        struct.object({ a: struct.string().alias('y'), kind: struct.literal('left') }),
        struct.object({ a: struct.string().alias('x'), kind: struct.literal('right') }),
      ]),
    )
    expect(parse(discriminated, { a: 'v', kind: 'left' })).toEqual([null, { a: 'v', kind: 'left' }])
    expect(encodeJson(discriminated, { a: 'v', kind: 'left' })).toEqual({ kind: 'left', x: 'v', y: 'v' })
    expect(parse(discriminated, { a: 'v', kind: 'right' })).toEqual([null, { a: 'v', kind: 'right' }])
    expect(encodeJson(discriminated, { a: 'v', kind: 'right' })).toEqual({ kind: 'right', x: 'v' })
    expect(encodeJson(discriminated, { a: 'v' })).toEqual({ a: 'v', x: 'v' })
  })

  test('an absent optional key is not a conflict when its aliases differ', () => {
    const schema = struct.intersection(
      struct.object({ a: struct.string().alias('x').optional() }),
      struct.object({ a: struct.string().alias('y').optional() }),
    )
    expect(parse(schema, {})).toEqual([null, {}])
    expect(encodeJson(schema, {})).toEqual({})
    expect(parse(schema, { x: 'v', y: 'v' }, { aliases: true })).toEqual([null, { a: 'v' }])
    expect(encodeJson(schema, { a: 'v' })).toEqual({ x: 'v', y: 'v' })
  })

  test('two aliases on one logical key are a successful union branch', () => {
    const aliased = struct.intersection(struct.object({ a: struct.string().alias('x') }), struct.object({ a: struct.string().alias('y') }))
    expect(parse(struct.or(aliased, struct.number()), { a: 'v' })).toEqual([null, { a: 'v' }])
  })

  test('nullable aliased intersections still parse and encode null', () => {
    const schema = struct.intersection(
      struct.object({ a: struct.string().alias('x') }).nullable(),
      struct.object({ b: struct.string().alias('y') }).nullable(),
    )
    expect(parse(schema, null)).toEqual([null, null])
    expect(encodeJson(schema, null)).toBeNull()
  })

  test('a non-object intersection member does not invent a wire key for an object key', () => {
    const schema = struct.intersection(struct.string(), struct.object({ a: struct.string().alias('x') }))
    expect(encodeJson(schema, { a: 'v' })).toEqual({ a: 'v', x: 'v' })
  })

  test('intersection merges the same logical key when every reachable object uses the same wire key', () => {
    const schema = struct.intersection(
      struct.object({ a: struct.string().alias('wire'), name: struct.string() }),
      struct.or(struct.object({ a: struct.string().alias('wire') }), struct.number()),
    )

    expect(parse(schema, { a: 'same', name: 'Ada' })).toEqual([null, { a: 'same', name: 'Ada' }])
    expect(encodeJson(schema, { a: 'same', name: 'Ada' })).toEqual({ name: 'Ada', wire: 'same' })
    expect(parse(schema, { a: 'only' })).toEqual([
      expect.objectContaining({ issues: [expect.objectContaining({ path: ['name'] })] }),
      undefined,
    ])

    const shape: { self?: ReturnType<typeof struct.object> } = {}
    const node = struct.object({
      name: struct.string().alias('name_wire'),
      get self() {
        return shape.self as ReturnType<typeof struct.object>
      },
    })
    shape.self = node
    expect(() => struct.intersection(node, struct.object({ name: struct.string().alias('name_wire') }))).not.toThrow()

    expect(() =>
      struct.intersection(
        struct.tuple([struct.object({ a: struct.string().alias('x') }), struct.object({ a: struct.string().alias('y') })]),
        struct.tuple([struct.object({ a: struct.string().alias('x') }), struct.object({ b: struct.string() })]),
      ),
    ).not.toThrow()
  })

  test('intersection emits both wire keys for array, record, and tuple aliases of one logical key', () => {
    const both = { display_name: 'Ada', full_name: 'Ada' }
    const rows = struct.intersection(
      struct.object({ rows: struct.array(struct.object({ name: struct.string().alias('full_name') })) }),
      struct.object({ rows: struct.array(struct.object({ name: struct.string().alias('display_name') })) }),
    )
    expect(parse(rows, { rows: [{ name: 'Ada' }] })).toEqual([null, { rows: [{ name: 'Ada' }] }])
    expect(encodeJson(rows, { rows: [{ name: 'Ada' }] })).toEqual({ rows: [both] })

    const record = struct.intersection(
      struct.record(struct.object({ name: struct.string().alias('full_name') })),
      struct.record(struct.object({ name: struct.string().alias('display_name') })),
    )
    expect(parse(record, { ada: { name: 'Ada' } })).toEqual([null, { ada: { name: 'Ada' } }])
    expect(encodeJson(record, { ada: { name: 'Ada' } })).toEqual({ ada: both })

    const tuple = struct.intersection(
      struct.tuple([struct.object({ name: struct.string().alias('full_name') })]),
      struct.tuple([struct.object({ name: struct.string().alias('display_name') })]),
    )
    expect(parse(tuple, [{ name: 'Ada' }])).toEqual([null, [{ name: 'Ada' }]])
    expect(encodeJson(tuple, [{ name: 'Ada' }])).toEqual([both])

    const agreed = struct.intersection(
      struct.array(struct.object({ name: struct.string().alias('full_name') })),
      struct.tuple([struct.object({ name: struct.string().alias('full_name') })]),
    )
    expect(encodeJson(agreed, [{ name: 'Ada' }, { name: 'Bea' }])).toEqual([{ full_name: 'Ada' }, { full_name: 'Bea', name: 'Bea' }])
  })

  test('intersection rejects when either side fails', () => {
    const combined = struct.intersection(struct.object({ name: struct.string() }), struct.object({ age: struct.number() }))

    const [okErr, okVal] = parse(combined, { age: 7, name: 'Miao' })
    if (okErr) {
      throw okErr
    }
    expect(okVal).toEqual({ age: 7, name: 'Miao' })

    const [leftErr] = parse(combined, { age: 7, name: false })
    expect(leftErr).toBeInstanceOf(StructError)
    expect(leftErr?.message).toContain('Expected string')

    const [rightErr] = parse(combined, { age: 'bad', name: 'Miao' })
    expect(rightErr).toBeInstanceOf(StructError)
    expect(rightErr?.message).toContain('Expected number')
  })
})
