import { describe, expect, test, vi } from 'vitest'
import { encodeValue } from './encode'
import { struct } from './index'
import { encodeStructValue, parseStructTuple as parse } from './introspection'
import { matchesRuntimeValue } from './match'
import type { RuntimeStruct } from './types'

function encode(struct: unknown, value: unknown): unknown {
  return encodeValue(struct as RuntimeStruct, value)
}

describe('encode.ts', () => {
  test('encode is identity for primitives', () => {
    expect(encode(struct.string(), 'hello')).toBe('hello')
    expect(encode(struct.number(), 42)).toBe(42)
    expect(encode(struct.boolean(), true)).toBe(true)
  })

  test('encode follows getter-recursive object structs', () => {
    const tree = struct.object({
      id: struct.string(),
      get children(): ReturnType<typeof struct.array> {
        return struct.array(tree)
      },
    })

    expect(encode(tree, { id: 'root', children: [{ id: 'a', children: [] }] })).toEqual({
      children: [{ children: [], id: 'a' }],
      id: 'root',
    })
  })

  test('object encode and matching preserve resolved-shape own-key semantics', () => {
    const shape = {
      beta: struct.string(),
      2: struct.string(),
      alpha: struct.string(),
    }
    Object.defineProperty(shape, 'hidden', { configurable: true, enumerable: false, value: struct.number() })
    Object.defineProperty(shape, '__proto__', { configurable: true, enumerable: true, value: struct.boolean() })

    const schema = struct.object(shape)
    const value = { 2: 'two', alpha: 'a', beta: 'b', hidden: 1 }
    Object.defineProperty(value, '__proto__', { configurable: true, enumerable: true, value: true })
    const polluted = Object.getOwnPropertyDescriptor(Object.prototype, 'polluted')
    Object.defineProperty(Object.prototype, 'polluted', { configurable: true, enumerable: true, value: 'polluted', writable: true })

    try {
      const encoded = encode(schema, value) as Record<string, unknown>
      const duplicateAliases = struct.object({ first: struct.string().alias('same'), second: struct.string().alias('same') })
      const inheritedField = struct.object({ polluted: struct.string() })

      expect(Object.getPrototypeOf(encoded)).toBeNull()
      expect(Object.entries(encoded)).toEqual([
        ['2', 'two'],
        ['beta', 'b'],
        ['alpha', 'a'],
        ['hidden', 1],
        ['__proto__', true],
      ])
      expect(Object.getOwnPropertyDescriptor(encoded, '__proto__')).toMatchObject({ enumerable: true, value: true })
      expect(Object.hasOwn(encoded, 'polluted')).toBe(false)
      expect(encode(duplicateAliases, { first: 'first', second: 'second' })).toEqual({ first: 'first', second: 'second' })
      expect(matchesRuntimeValue(schema as unknown as RuntimeStruct, value)).toBe(true)
      expect(matchesRuntimeValue(inheritedField as unknown as RuntimeStruct, {})).toBe(false)
    } finally {
      if (polluted) {
        Object.defineProperty(Object.prototype, 'polluted', polluted)
      } else {
        delete (Object.prototype as { polluted?: unknown }).polluted
      }
    }
  })

  test('struct.or encodes via first matching option(date vs string)', () => {
    const s = struct.or(struct.date(), struct.string())
    expect(encode(s, new Date('2026-05-12T10:00:00Z'))).toBe('2026-05-12T10:00:00.000Z')
    expect(encode(s, 'hello')).toBe('hello')
  })

  test('struct.or encodes via first matching option(bigint vs number)', () => {
    const s = struct.or(struct.bigint(), struct.number())
    expect(encode(s, 42n)).toBe('42')
    expect(encode(s, 3.14)).toBe(3.14)
  })

  test('encodes nullable primitive null without calling primitive encoder', () => {
    expect(encodeStructValue(struct.date().null(), null)).toBeNull()
    expect(encodeStructValue(struct.bigint().null(), null)).toBeNull()
  })

  test('encodes optional primitive undefined without calling primitive encoder', () => {
    expect(encodeStructValue(struct.date().optional(), undefined)).toBeUndefined()
    expect(encodeStructValue(struct.bigint().optional(), undefined)).toBeUndefined()
  })

  test('struct.discriminatedUnion encodes via discriminator', () => {
    const s = struct.discriminatedUnion('type', [
      struct.object({ type: struct.literal('a'), payload: struct.date() }),
      struct.object({ type: struct.literal('b'), payload: struct.bigint() }),
    ])
    const aEncoded = encode(s, { type: 'a', payload: new Date('2026-05-12T10:00:00Z') }) as { type: string; payload: string }
    expect(aEncoded.payload).toBe('2026-05-12T10:00:00.000Z')

    const bEncoded = encode(s, { type: 'b', payload: 42n }) as { type: string; payload: string }
    expect(bEncoded.payload).toBe('42')
  })

  test('struct.intersection encodes both object sides', () => {
    const named = struct.object({ name: struct.string() })
    const dated = struct.object({ when: struct.date() })
    const s = struct.intersection(named, dated)
    const encoded = encode(s, { name: 'x', when: new Date('2026-05-12T10:00:00Z') }) as { name: string; when: string }
    expect(encoded.name).toBe('x')
    expect(encoded.when).toBe('2026-05-12T10:00:00.000Z')
  })

  test('struct.intersection encode keeps a non-object value', () => {
    const s = struct.intersection(struct.object({ name: struct.string() }), struct.object({ age: struct.number() }))
    expect(encode(s, 'not-an-object')).toBe('not-an-object')
  })

  test('struct.intersection encode of mixed sides keeps the last encoded value', () => {
    const s = struct.intersection(struct.unknown(), struct.object({ name: struct.string() }))
    expect(encode(s, { extra: true, name: 'x' })).toEqual({ name: 'x' })
  })

  test('struct.intersection encodes three object sides', () => {
    const s = struct.intersection(
      struct.object({ id: struct.string() }),
      struct.object({ name: struct.string() }),
      struct.object({ when: struct.date() }),
    )

    expect(encode(s, { id: 'u_1', name: 'Miao', when: new Date('2026-05-12T10:00:00Z') })).toEqual({
      id: 'u_1',
      name: 'Miao',
      when: '2026-05-12T10:00:00.000Z',
    })
  })

  test('struct.intersection encodes nested object intersections', () => {
    const account = struct.object({ id: struct.string() })
    const profile = struct.object({ name: struct.string() })
    const audit = struct.object({ when: struct.date() })
    const s = struct.intersection(struct.intersection(account, profile), audit)

    expect(encode(s, { id: 'u_1', name: 'Miao', when: new Date('2026-05-12T10:00:00Z') })).toEqual({
      id: 'u_1',
      name: 'Miao',
      when: '2026-05-12T10:00:00.000Z',
    })
  })

  test('round-trip wire form stable through or codec', () => {
    const s = struct.or(struct.date(), struct.string())
    const [err, val] = parse(s, '2026-05-12T10:00:00Z')
    if (err) {
      throw err
    }
    expect(encode(s, val)).toBe('2026-05-12T10:00:00.000Z')
  })

  test('round-trip wire form stable through discriminatedUnion codec', () => {
    const s = struct.discriminatedUnion('type', [struct.object({ type: struct.literal('a'), payload: struct.bigint() })])
    const [err, val] = parse(s, { type: 'a', payload: '42' })
    if (err) {
      throw err
    }
    const encoded = encode(s, val) as { type: string; payload: string }
    expect(encoded.payload).toBe('42')
  })

  test('struct.or encodes via blob, file, arrayBuffer, boolean, null branches', () => {
    const s = struct.or(struct.blob(), struct.file(), struct.arrayBuffer(), struct.boolean(), struct.null())
    expect(encode(s, new Blob(['x']))).toBeInstanceOf(Blob)
    expect(encode(s, new File([], 'x'))).toBeInstanceOf(File)
    expect(encode(s, new ArrayBuffer(1))).toBeInstanceOf(ArrayBuffer)
    expect(encode(s, true)).toBe(true)
    expect(encode(s, null)).toBeNull()
  })

  test('struct.or encodes via tuple, array, record, object branches', () => {
    const s = struct.or(
      struct.tuple([struct.string()]),
      struct.array(struct.string()),
      struct.record(struct.string()),
      struct.object({ name: struct.string() }),
    )
    expect(encode(s, ['a'])).toEqual(['a'])
    expect(encode(s, ['a', 'b'])).toEqual(['a', 'b'])
    expect(encode(s, { key: 'x' })).toEqual({ key: 'x' })
    expect(encode(s, { name: 'x' })).toEqual({ name: 'x' })
  })

  test('nested or discriminatedUnion and intersection encode via matchesDefinition', () => {
    const nestedOr = struct.or(struct.or(struct.date(), struct.string()), struct.number())
    expect(encode(nestedOr, new Date('2026-05-12T10:00:00Z'))).toBe('2026-05-12T10:00:00.000Z')
    expect(encode(nestedOr, 'hello')).toBe('hello')
    expect(encode(nestedOr, 42)).toBe(42)

    const nestedDisc = struct.or(
      struct.discriminatedUnion('type', [struct.object({ type: struct.literal('a'), payload: struct.bigint() })]),
      struct.string(),
    )
    expect(encode(nestedDisc, { type: 'a', payload: 42n })).toEqual({ type: 'a', payload: '42' })

    const nestedAny = struct.or(struct.any(), struct.number())
    expect(encode(nestedAny, 'anything')).toBe('anything')

    const nestedUnknown = struct.or(struct.unknown(), struct.number())
    expect(encode(nestedUnknown, 'unknown')).toBe('unknown')

    const nestedLiteral = struct.or(struct.literal('x'), struct.number())
    expect(encode(nestedLiteral, 'x')).toBe('x')

    const nestedInt = struct.or(
      struct.intersection(struct.object({ name: struct.string() }), struct.object({ when: struct.string() })),
      struct.number(),
    )
    expect(encode(nestedInt, { name: 'x', when: 'y' })).toEqual({
      name: 'x',
      when: 'y',
    })
  })

  test('keeps first matching union branch when encoded output is equivalent', () => {
    const Payload = struct.or(struct.string(), struct.string())

    expect(encodeStructValue(Payload, 'x')).toBe('x')
  })

  test('keeps first matching union branch when aliases differ but encoded output is equivalent', () => {
    const Payload = struct.or(struct.string().alias('text'), struct.string().alias('label'))

    expect(encodeStructValue(Payload, 'x')).toBe('x')
  })

  test('keeps first matching union branch when object output differs only by key order', () => {
    const Payload = struct.or(
      struct.object({ a: struct.string(), b: struct.string() }),
      struct.object({ b: struct.string(), a: struct.string() }),
    )

    expect(encodeStructValue(Payload, { a: 'x', b: 'y' })).toEqual({ a: 'x', b: 'y' })
  })

  test('union construct does not resolve getter object shapes', () => {
    let laterReads = 0
    const Payload = struct.or(
      struct.object({ name: struct.string() }),
      struct.object({
        get later() {
          laterReads += 1
          return struct.string()
        },
      }),
    )

    expect(laterReads).toBe(0)
    expect(encodeStructValue(Payload, { name: 'x' })).toEqual({ name: 'x' })
  })

  test('compares overlapping union object branches when nested fields are not identity-encoded', () => {
    const nested = struct.object({ value: struct.string() })
    const Payload = struct.or(struct.object({ nested }), struct.object({ nested }))

    expect(encodeStructValue(Payload, { nested: { value: 'x' } })).toEqual({ nested: { value: 'x' } })
  })

  test('compares overlapping union object branches when a field has a codec', () => {
    const Payload = struct.or(struct.object({ when: struct.date() }), struct.object({ when: struct.date() }))

    expect(encodeStructValue(Payload, { when: new Date('2026-05-12T10:00:00Z') })).toEqual({
      when: '2026-05-12T10:00:00.000Z',
    })
  })

  test('compares overlapping union object branches when field kinds differ', () => {
    const Payload = struct.or(struct.object({ value: struct.any() }), struct.object({ value: struct.string() }))

    expect(encodeStructValue(Payload, { value: 'x' })).toEqual({ value: 'x' })
  })

  test('compares overlapping union object branches when field sets differ', () => {
    const Payload = struct.or(
      struct.object({ value: struct.string() }),
      struct.object({ extra: struct.string().optional(), value: struct.string() }),
    )

    expect(encodeStructValue(Payload, { value: 'x' })).toEqual({ value: 'x' })
  })

  test('struct.or falls through when no option matches', () => {
    const s = struct.or(struct.number(), struct.string())
    expect(encode(s, true)).toBe(true)
  })

  test('struct.or returns an unmatched value when a branch is not identity-encoded', () => {
    // A date branch skips the uniform-identity fast path, so the shared miss still returns the input.
    const s = struct.or(struct.date(), struct.string())
    expect(encode(s, true)).toBe(true)
  })

  test('matchesRuntimeValue uses neutral runtime guards for date and bigint', () => {
    const dateStruct = struct.date() as unknown as RuntimeStruct
    const bigintStruct = struct.bigint() as unknown as RuntimeStruct

    expect(matchesRuntimeValue(dateStruct, new Date('2026-05-12T10:00:00Z'))).toBe(true)
    expect(matchesRuntimeValue(dateStruct, '2026-05-12T10:00:00Z')).toBe(false)
    expect(matchesRuntimeValue(bigintStruct, 42n)).toBe(true)
    expect(matchesRuntimeValue(bigintStruct, '42')).toBe(false)
  })

  test('encode uses injected selectUnionOptions as the union branch source', () => {
    const union = struct.or(struct.date(), struct.string()) as unknown as RuntimeStruct
    const mockSelect = vi.fn(() => {
      throw new Error('selector-called')
    })

    expect(() => encodeValue(union, new Date('2026-05-12T10:00:00Z'), { selectUnionOptions: mockSelect })).toThrowError('selector-called')
  })

  test('struct.discriminatedUnion falls through when no match', () => {
    const s = struct.discriminatedUnion('type', [struct.object({ type: struct.literal('a'), payload: struct.string() })])
    expect(encode(s, 'not an object')).toBe('not an object')
    expect(encode(s, { type: 'b' })).toEqual({ type: 'b' })
  })

  test('struct.object encode skips missing keys and non-objects in union', () => {
    const s = struct.object({ name: struct.string(), age: struct.number().optional() })
    expect(encode(s, { name: 'x' })).toEqual({ name: 'x' })

    const union = struct.or(s, struct.number())
    expect(encode(union, 42)).toBe(42)
  })

  test('struct.record encode returns non-plain-object as-is', () => {
    const s = struct.record(struct.string())
    expect(encode(s, 42)).toBe(42)
    expect(encode(s, null)).toBeNull()
  })

  test('struct.object encode returns non-plain-object as-is', () => {
    const s = struct.object({ name: struct.string() })
    expect(encode(s, 42)).toBe(42)
    expect(encode(s, null)).toBeNull()
  })

  test('struct.enum in or falls through when value does not match', () => {
    const s = struct.or(struct.enum(['a', 'b']), struct.number())
    expect(encode(s, 'c')).toBe('c')
  })
})
