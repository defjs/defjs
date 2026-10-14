import { describe, expect, test, vi } from 'vitest'
import { failure, issue, parkedFailure } from './errors'

const errorsModule = import('./errors')
import type { ErrorMap } from './index'
import { struct } from './index'
import { parseStructTuple as parse, parseStructValue } from './introspection'
import { parseValue } from './parse'
import { createPrimitiveStruct } from './runtime'
import { OMIT } from './symbols'
import type { ParseResult, Path, RuntimeStruct, StructIssue, StructLike } from './types'
import { success } from './utils'

function runtime(value: unknown): RuntimeStruct {
  return value as RuntimeStruct
}

function firstIssue(result: ParseResult<unknown>): StructIssue {
  const first = result[0]?.issues[0]
  if (!first) {
    throw new Error('expected a parse failure')
  }
  return first
}

const ISO = '2026-01-01T00:00:00.000Z'

// The tag getter throws if a message reads the value. A reported message names the kind and does not.
// Spies on `issue` check that a quiet miss builds no message at all.
class Hostile {
  get [Symbol.toStringTag](): string {
    throw new Error('a message was built for a quiet candidate')
  }
}

describe('parse failure paths', () => {
  test('reports the full path of a failure inside arrays of intersections', () => {
    const Row = struct.intersection(struct.object({ id: struct.number() }), struct.object({ tags: struct.array(struct.string()) }))
    const Table = struct.object({ rows: struct.array(Row) })
    const input = {
      rows: [
        { id: 1, tags: ['a'] },
        { id: 2, tags: ['b', 3] },
      ],
    }
    const expected = {
      code: 'invalid_type',
      expected: 'string',
      message: 'Expected string at rows[1].tags[1], received number',
      path: ['rows', 1, 'tags', 1],
      received: 3,
    }

    const result = parse(Table, input)
    expect(result[1]).toBeUndefined()
    expect(result[0]?.issues).toEqual([expected])
    expect(() => parseStructValue(Table, input, { tagObjects: true })).toThrow('Expected string at rows[1].tags[1], received number')
  })

  test('reports intersection conflicts under the element that produced them', () => {
    const maybeDate = struct.or(struct.date(), struct.string())
    const Flat = struct.intersection(struct.object({ n: maybeDate }), struct.object({ n: struct.string() }))
    const Nested = struct.intersection(
      struct.object({ nested: struct.object({ n: maybeDate }) }),
      struct.object({ nested: struct.object({ n: struct.string() }) }),
    )
    const Lists = struct.intersection(struct.array(maybeDate), struct.array(struct.string()))
    const conflict = (path: Path, at: string): unknown => ({
      code: 'invalid_intersection',
      expected: 'compatible intersection value',
      message: `Expected compatible intersection value at ${at}, received string`,
      path,
      received: ISO,
    })

    // 'hello' is not a date, so both sides agree; the ISO string becomes a Date on one side only.
    expect(parse(struct.object({ events: struct.array(Flat) }), { events: [{ n: 'hello' }, { n: ISO }] })[0]?.issues).toEqual([
      conflict(['events', 1, 'n'], 'events[1].n'),
    ])
    expect(
      parse(struct.object({ events: struct.array(Nested) }), { events: [{ nested: { n: 'hello' } }, { nested: { n: ISO } }] })[0]?.issues,
    ).toEqual([conflict(['events', 1, 'nested', 'n'], 'events[1].nested.n')])
    expect(parse(struct.array(Lists), [['hello'], [ISO]])[0]?.issues).toEqual([conflict([1, 0], '[1][0]')])
    expect(parse(struct.array(Lists), [['hello'], ['plain']])).toEqual([null, [['hello'], ['plain']]])
  })

  test('keeps numbers as numbers and reports logical keys for wire aliases', () => {
    const Schema = struct.object({
      rows: struct.array(struct.record(struct.tuple([struct.string(), struct.object({ userName: struct.string().alias('user_name') })]))),
    })
    const failing = { rows: [{}, { cell: ['x', { user_name: 7 }] }] }
    const missing = { rows: [{ cell: ['x', {}] }] }

    expect(firstIssue(parse(Schema, { rows: [{}, { cell: ['x', { userName: 7 }] }] })).path).toEqual(['rows', 1, 'cell', 1, 'userName'])
    expect(firstIssue(parse(Schema, failing, { aliases: true })).path).toEqual(['rows', 1, 'cell', 1, 'userName'])
    expect(firstIssue(parse(Schema, missing, { aliases: true }))).toEqual({
      code: 'missing_key',
      expected: 'string',
      message: 'Expected string at rows[0].cell[1].userName, received undefined',
      path: ['rows', 0, 'cell', 1, 'userName'],
      received: undefined,
    })
  })

  test('reports a failure at the bottom of a deeply nested array', () => {
    let schema: StructLike = struct.number()
    let input: unknown = 'leaf'
    for (let depth = 0; depth < 40; depth += 1) {
      schema = struct.array(schema)
      input = [input]
    }

    expect(firstIssue(parse(schema, input)).path).toEqual(new Array<number>(40).fill(0))
  })

  test('reports discriminated union failures at their position in the document', () => {
    const Event = struct.discriminatedUnion('type', [
      struct.object({ type: struct.literal('a'), payload: struct.array(struct.object({ id: struct.number() })) }),
      struct.object({ type: struct.literal('b'), meta: struct.record(struct.number()) }),
    ])
    const Log = struct.object({ events: struct.array(Event) })
    const good = [
      { type: 'a', payload: [{ id: 1 }] },
      { type: 'b', meta: { x: 1 } },
    ]

    expect(firstIssue(parse(Log, { events: [...good, { type: 'a', payload: [{ id: 1 }, { id: 'x' }] }] }))).toMatchObject({
      code: 'invalid_type',
      path: ['events', 2, 'payload', 1, 'id'],
      received: 'x',
    })
    expect(firstIssue(parse(Log, { events: [...good, { type: 'b', meta: { x: 1, y: 'no' } }] })).path).toEqual(['events', 2, 'meta', 'y'])
    expect(firstIssue(parse(Log, { events: [...good, { type: 'c' }] }))).toMatchObject({
      code: 'invalid_union',
      path: ['events', 2, 'type'],
      received: 'c',
    })
    expect(firstIssue(parse(Log, { events: [...good, {}] }))).toMatchObject({ code: 'missing_key', path: ['events', 2, 'type'] })
    expect(firstIssue(parse(Log, { events: [...good, 7] }))).toMatchObject({
      code: 'invalid_type',
      expected: 'object',
      path: ['events', 2],
    })
    expect(parse(Log, { events: good })[0]).toBeNull()
  })

  test('issue paths belong to their issue and never change afterwards', () => {
    const Schema = struct.object({ list: struct.array(struct.object({ id: struct.number() })) })
    const [first] = parse(Schema, { list: [{ id: 1 }, { id: 'x' }] })
    const firstPath = first?.issues[0]?.path
    const [second] = parse(Schema, { list: [{ id: 'y' }] })

    expect(firstPath).toEqual(['list', 1, 'id'])
    expect(second?.issues[0]?.path).toEqual(['list', 0, 'id'])
    expect(second?.issues[0]?.path).not.toBe(firstPath)
  })
})

describe('union candidates that fail deep inside', () => {
  const Bag = struct.or(
    struct.object({ items: struct.array(struct.object({ id: struct.number() })) }),
    struct.object({ items: struct.array(struct.object({ id: struct.string() })) }),
  )
  const Doc = struct.object({ first: Bag, second: struct.string() })
  const label = (item: StructIssue): string => `${item.code}@${item.path.join('.')}:${item.expected}:${JSON.stringify(item.received)}`

  test('later siblings keep their own path after an earlier candidate failed deeper down', () => {
    const input = { first: { items: [{ id: 'a' }] }, second: 1 }

    expect(firstIssue(parse(Doc, input))).toEqual({
      code: 'invalid_type',
      expected: 'string',
      message: 'Expected string at second, received number',
      path: ['second'],
      received: 1,
    })

    const events: string[] = []
    const retained: Path[] = []
    const errorMap: ErrorMap = (item) => {
      events.push(label(item))
      retained.push(item.path)
      return undefined
    }
    expect(firstIssue(parse(Doc, input, { errorMap })).path).toEqual(['second'])
    expect(events).toEqual(['invalid_type@first.items.0.id:number:"a"', 'invalid_type@second:string:1'])
    expect(retained).toEqual([['first', 'items', 0, 'id'], ['second']])
  })

  test('array elements after a deep candidate failure keep their own index', () => {
    const Bags = struct.array(Bag)
    const good = { items: [{ id: 'a' }] }

    expect(parse(Bags, [good, good])).toEqual([null, [good, good]])
    expect(firstIssue(parse(Bags, [good, good, 7])).path).toEqual([2])
    expect(firstIssue(parse(Bags, [good, { items: [{ id: true }] }])).path).toEqual([1])
  })

  test('a union where every candidate fails deep reports at the union itself', () => {
    const input = { first: { items: [{ id: 'fine' }, { id: true }] }, second: 'ok' }
    const events: string[] = []
    const retained: Path[] = []
    const errorMap: ErrorMap = (item) => {
      events.push(label(item))
      retained.push(item.path)
      return undefined
    }

    const plain = firstIssue(parse(Doc, input))
    expect(plain).toEqual({
      code: 'invalid_union',
      expected: 'object | object',
      message: 'Expected object | object at first, received object',
      path: ['first'],
      received: input.first,
    })
    expect(firstIssue(parse(Doc, input, { errorMap }))).toEqual(plain)
    expect(events).toEqual([
      'invalid_type@first.items.0.id:number:"fine"',
      'invalid_type@first.items.1.id:string:true',
      'invalid_union@first:object | object:{"items":[{"id":"fine"},{"id":true}]}',
    ])
    expect(retained).toEqual([['first', 'items', 0, 'id'], ['first', 'items', 1, 'id'], ['first']])
  })

  test('nested unions restore the path for each candidate and for the parent', () => {
    const Inner = struct.or(struct.object({ n: struct.number() }), struct.object({ n: struct.string() }))
    const Outer = struct.or(
      struct.object({ deep: struct.array(struct.object({ inner: Inner })) }),
      struct.object({ deep: struct.array(struct.unknown()) }),
    )
    const Root = struct.object({ rows: struct.array(Outer), tail: struct.number() })
    const events: string[] = []
    const errorMap: ErrorMap = (item) => {
      events.push(label(item))
      return undefined
    }

    // The first outer candidate fails inside the inner union; the second outer candidate accepts everything.
    const [error, value] = parse(Root, { rows: [{ deep: [{ inner: { n: true } }] }], tail: 'x' }, { errorMap })
    expect(value).toBeUndefined()
    expect(error?.issues).toHaveLength(1)
    expect(events).toEqual([
      'invalid_type@rows.0.deep.0.inner.n:number:true',
      'invalid_type@rows.0.deep.0.inner.n:string:true',
      'invalid_union@rows.0.deep.0.inner:object | object:{"n":true}',
      'invalid_type@tail:number:"x"',
    ])
    expect(error?.issues[0]?.path).toEqual(['tail'])
  })
})

describe('every kind of failure', () => {
  const Shape = struct.discriminatedUnion('t', [
    struct.object({ t: struct.literal('a'), n: struct.number() }),
    struct.object({ t: struct.literal('b') }),
  ])
  const Tagged = struct.discriminatedUnion('type', [
    struct.object({ type: struct.literal('text').alias('kind'), body: struct.string() }),
    struct.object({ type: struct.literal('image').alias('t'), url: struct.string() }),
  ])
  const maybeDate = struct.or(struct.date(), struct.string())
  const found = (code: StructIssue['code'], expected: string, at: string, path: Path, received: unknown, shown: string): StructIssue => ({
    code,
    expected,
    message: `Expected ${expected} at ${at}, received ${shown}`,
    path,
    received,
  })
  const cases: { name: string; field: StructLike; value?: unknown; aliases?: true; issue: StructIssue }[] = [
    { name: 'a wrong string', field: struct.string(), value: 1, issue: found('invalid_type', 'string', 'x', ['x'], 1, 'number') },
    { name: 'a wrong number', field: struct.number(), value: 'a', issue: found('invalid_type', 'number', 'x', ['x'], 'a', 'string') },
    { name: 'a wrong boolean', field: struct.boolean(), value: 'a', issue: found('invalid_type', 'boolean', 'x', ['x'], 'a', 'string') },
    { name: 'a missing key', field: struct.string(), issue: found('missing_key', 'string', 'x', ['x'], undefined, 'undefined') },
    { name: 'a null', field: struct.string(), value: null, issue: found('invalid_type', 'string', 'x', ['x'], null, 'null') },
    {
      name: 'a wrong enum member',
      field: struct.enum(['a', 'b']),
      value: 'c',
      issue: found('invalid_enum', '"a" | "b"', 'x', ['x'], 'c', 'string'),
    },
    { name: 'a wrong literal', field: struct.literal('a'), value: 'b', issue: found('invalid_literal', '"a"', 'x', ['x'], 'b', 'string') },
    {
      name: 'a non-array',
      field: struct.array(struct.string()),
      value: 'no',
      issue: found('invalid_type', 'array', 'x', ['x'], 'no', 'string'),
    },
    { name: 'a non-object', field: struct.object({}), value: 5, issue: found('invalid_type', 'object', 'x', ['x'], 5, 'number') },
    {
      name: 'a non-record',
      field: struct.record(struct.string()),
      value: 5,
      issue: found('invalid_type', 'record', 'x', ['x'], 5, 'number'),
    },
    {
      name: 'a short tuple',
      field: struct.tuple([struct.string(), struct.number()]),
      value: ['a'],
      issue: found('invalid_type', 'tuple of length 2', 'x', ['x'], ['a'], 'array'),
    },
    {
      name: 'no matching union member',
      field: struct.or(struct.string(), struct.number()),
      value: true,
      issue: found('invalid_union', 'string | number', 'x', ['x'], true, 'boolean'),
    },
    {
      name: 'a non-object for a discriminated union',
      field: Shape,
      value: 5,
      issue: found('invalid_type', 'object', 'x', ['x'], 5, 'number'),
    },
    {
      name: 'a missing discriminator',
      field: Shape,
      value: {},
      issue: found('missing_key', '"a" | "b"', 'x.t', ['x', 't'], undefined, 'undefined'),
    },
    {
      name: 'an unknown discriminator',
      field: Shape,
      value: { t: 'z' },
      issue: found('invalid_union', '"a" | "b"', 'x.t', ['x', 't'], 'z', 'string'),
    },
    {
      name: 'a missing wire discriminator',
      field: Tagged,
      value: {},
      aliases: true,
      issue: found('missing_key', '"text" | "image"', 'x.type', ['x', 'type'], undefined, 'undefined'),
    },
    {
      name: 'an undefined wire discriminator',
      field: Tagged,
      value: { kind: undefined },
      aliases: true,
      issue: found('missing_key', '"text" | "image"', 'x.type', ['x', 'type'], undefined, 'undefined'),
    },
    {
      name: 'an unknown wire discriminator',
      field: Tagged,
      value: { kind: 'zzz' },
      aliases: true,
      issue: found('invalid_union', '"text" | "image"', 'x.type', ['x', 'type'], 'zzz', 'string'),
    },
    {
      name: 'a discriminator under the wire key of another option',
      field: Tagged,
      value: { kind: 'image', url: 'u' },
      aliases: true,
      issue: found('invalid_union', '"text" | "image"', 'x.type', ['x', 'type'], 'image', 'string'),
    },
    {
      name: 'a decode hook that rejects a date',
      field: struct.date(),
      value: 'nope',
      issue: found('invalid_type', 'Date', 'x', ['x'], 'nope', 'string'),
    },
    {
      name: 'a decode hook that rejects a bigint',
      field: struct.bigint(),
      value: 'abc',
      issue: found('invalid_type', 'bigint', 'x', ['x'], 'abc', 'string'),
    },
    {
      name: 'the first failing option of a plain intersection',
      field: struct.intersection(struct.string(), struct.number()),
      value: 'x',
      issue: found('invalid_type', 'number', 'x', ['x'], 'x', 'string'),
    },
    {
      name: 'a non-object for an object intersection',
      field: struct.intersection(struct.object({ a: struct.string() }), struct.object({ b: struct.string() })),
      value: 5,
      issue: found('invalid_type', 'object', 'x', ['x'], 5, 'number'),
    },
    {
      name: 'a conflict between object sides',
      field: struct.intersection(struct.object({ n: maybeDate }), struct.object({ n: struct.string() })),
      value: { n: ISO },
      issue: found('invalid_intersection', 'compatible intersection value', 'x.n', ['x', 'n'], ISO, 'string'),
    },
    {
      name: 'a conflict between plain sides',
      field: struct.intersection(struct.array(maybeDate), struct.array(struct.string())),
      value: [ISO],
      issue: found('invalid_intersection', 'compatible intersection value', 'x[0]', ['x', 0], ISO, 'string'),
    },
  ]

  test.each(cases)('reports $name with its full issue, plain and as a discarded union candidate', ({ field, issue: expected, ...rest }) => {
    const input = 'value' in rest ? { x: rest.value } : {}
    const options = { aliases: rest.aliases === true }
    const Plain = struct.object({ x: field })
    expect(firstIssue(parse(Plain, input, options))).toEqual(expected)

    // The candidate's issue is parked, discarded and its path array reused for the next candidate; errorMap keeps the issue.
    const seen: StructIssue[] = []
    const errorMap: ErrorMap = (item) => {
      seen.push(item)
      return undefined
    }
    const [error] = parse(struct.or(Plain, struct.literal('never')), input, { ...options, errorMap })
    expect(error?.issues.map((item) => item.code)).toEqual(['invalid_union'])
    // The candidate fails on its last issue; after it come the literal candidate's issue and the union's own.
    expect(seen.at(-3)).toEqual(expected)
    expect(seen.at(-2)?.code).toBe('invalid_literal')
    expect(seen.at(-1)?.code).toBe('invalid_union')
  })
})

describe('parse re-entrancy', () => {
  test('errorMap can run whole parses while an outer parse is failing deep inside arrays', () => {
    const Inner = struct.object({ ok: struct.boolean() })
    const Outer = struct.object({ rows: struct.array(struct.object({ id: struct.number() })) })
    const nested: ParseResult<unknown>[] = []
    const errorMap: ErrorMap = () => {
      nested.push(parse(Inner, { ok: true }))
      nested.push(parse(Inner, { ok: 'no' }, { errorMap: () => 'inner message' }))
      nested.push(parse(Outer, { rows: [{ id: 1 }, { id: 'inner' }] }))
      return undefined
    }

    const result = parse(Outer, { rows: [{ id: 1 }, { id: 'x' }] }, { errorMap })

    expect(result[0]?.issues).toEqual([
      {
        code: 'invalid_type',
        expected: 'number',
        message: 'Expected number at rows[1].id, received string',
        path: ['rows', 1, 'id'],
        received: 'x',
      },
    ])
    expect(nested[0]).toEqual([null, { ok: true }])
    expect(firstIssue(nested[1] as ParseResult<unknown>)).toMatchObject({ message: 'inner message', path: ['ok'], received: 'no' })
    expect(firstIssue(nested[2] as ParseResult<unknown>)).toMatchObject({
      message: 'Expected number at rows[1].id, received string',
      path: ['rows', 1, 'id'],
    })
  })

  test('errorMap runs for discarded union candidates and re-enters without disturbing the outcome', () => {
    const Schema = struct.object({ value: struct.or(struct.object({ n: struct.number() }), struct.object({ s: struct.string() })) })
    const seen: string[] = []
    let running = false
    const errorMap: ErrorMap = (item) => {
      seen.push(`${item.code}@${item.path.join('.')}`)
      if (!running) {
        running = true
        try {
          expect(parse(Schema, { value: { n: 1 } })).toEqual([null, { value: { n: 1 } }])
          expect(firstIssue(parse(Schema, { value: 1 })).code).toBe('invalid_union')
        } finally {
          running = false
        }
      }
      return undefined
    }

    const [error] = parse(Schema, { value: { s: 1 } }, { errorMap })
    expect(error?.issues).toHaveLength(1)
    expect(error?.issues[0]).toMatchObject({ code: 'invalid_union', path: ['value'] })
    expect(seen).toEqual(['missing_key@value.n', 'invalid_type@value.s', 'invalid_union@value'])

    const [ok, value] = parse(Schema, { value: { n: 2 } }, { errorMap })
    expect(ok).toBeNull()
    expect(value).toEqual({ value: { n: 2 } })
  })

  test('a getter that parses while union candidates are probed cannot change the union outcome', () => {
    const Union = struct.object({ value: struct.or(struct.object({ count: struct.number() }), struct.object({ count: struct.string() })) })
    const nestedPaths: Path[] = []
    const build = (answer: unknown): { value: { count: unknown } } => ({
      value: {
        get count() {
          const [error] = parse(struct.object({ inner: struct.array(struct.number()) }), { inner: [1, 'bad'] })
          nestedPaths.push(error?.issues[0]?.path ?? [])
          return answer
        },
      },
    })

    expect(parse(Union, build('text'))).toEqual([null, { value: { count: 'text' } }])
    const [error] = parse(Union, build(false))
    expect(error?.issues).toHaveLength(1)
    expect(error?.issues[0]).toMatchObject({ code: 'invalid_union', path: ['value'] })
    expect(nestedPaths).toEqual([
      ['inner', 1],
      ['inner', 1],
      ['inner', 1],
      ['inner', 1],
    ])
  })

  test('a struct can parse itself from inside a getter of its own input', () => {
    const Node = struct.object({ id: struct.number(), children: struct.array(struct.object({ id: struct.number() })) })
    const input = {
      id: 1,
      get children() {
        const [inner] = parse(Node, { id: 'x', children: [] })
        expect(inner?.issues[0]?.path).toEqual(['id'])
        return [{ id: 2 }, { id: 'y' }]
      },
    }

    expect(firstIssue(parse(Node, input))).toMatchObject({ path: ['children', 1, 'id'], received: 'y' })
  })

  test('a decode hook can build its failure first and still report it after re-entering parse', () => {
    const nested: ParseResult<unknown>[] = []
    const Checked = createPrimitiveStruct<string, string>({
      decode: (value, path) => {
        const own = value === 'bad' ? failure(issue(path, 'custom', 'good value', value)) : undefined
        nested.push(parse(struct.object({ n: struct.number() }), { n: 'nested' }))
        nested.push(parse(struct.string(), 'fine'))
        return own ?? success(value.toUpperCase())
      },
      expected: 'string',
      is: (value): value is string => typeof value === 'string',
      kind: 'string',
    })
    const Schema = struct.object({ names: struct.array(Checked) })

    expect(parse(Schema, { names: ['a', 'b'] })).toEqual([null, { names: ['A', 'B'] }])
    expect(firstIssue(parse(Schema, { names: ['a', 'bad', 'never'] }))).toEqual({
      code: 'custom',
      expected: 'good value',
      message: 'Expected good value at names[1], received string',
      path: ['names', 1],
      received: 'bad',
    })
    // Two hook calls per parse of the valid input and two for the failing one, two nested parses each.
    expect(nested).toHaveLength(8)
    expect(firstIssue(nested[0] as ParseResult<unknown>).path).toEqual(['n'])
  })

  test('an exception from errorMap, a getter, or a hook leaves nothing behind for the next parse', () => {
    const Schema = struct.object({ list: struct.array(struct.number()) })
    const Exploding = createPrimitiveStruct<string, string>({
      decode: () => {
        throw new Error('hook exploded')
      },
      expected: 'string',
      is: (value): value is string => typeof value === 'string',
      kind: 'string',
    })
    const after = (): void => {
      expect(parse(Schema, { list: [1, 2] })).toEqual([null, { list: [1, 2] }])
      expect(firstIssue(parse(Schema, { list: [1, 'y'] })).path).toEqual(['list', 1])
    }

    expect(() =>
      parse(
        Schema,
        { list: ['x'] },
        {
          errorMap: () => {
            throw new Error('errorMap exploded')
          },
        },
      ),
    ).toThrow('errorMap exploded')
    after()

    expect(() =>
      parse(Schema, {
        get list(): number[] {
          throw new Error('getter exploded')
        },
      }),
    ).toThrow('getter exploded')
    after()

    expect(() => parse(struct.array(Exploding), ['a'])).toThrow('hook exploded')
    after()
  })
})

describe('parse outputs and quiet candidates', () => {
  test('keeps falsy and optional outputs that share nothing with a failure marker', () => {
    const Row = struct.tuple([
      struct.number(),
      struct.string(),
      struct.boolean(),
      struct.null(),
      struct.string().optional(),
      struct.unknown(),
    ])
    const [rowError, row] = parse(Row, [0, '', false, null, undefined, 0])
    expect(rowError).toBeNull()
    expect(row).toStrictEqual([0, '', false, null, undefined, 0])

    const [listError, list] = parse(struct.array(struct.string().optional()), ['a', undefined, 'b'])
    expect(listError).toBeNull()
    expect(list).toStrictEqual(['a', undefined, 'b'])

    const Bag = struct.object({
      zero: struct.number(),
      empty: struct.string(),
      off: struct.boolean(),
      nothing: struct.string().null(),
      skipped: struct.string().optional(),
    })
    const [bagError, bag] = parse(Bag, { zero: 0, empty: '', off: false, nothing: null, skipped: undefined })
    expect(bagError).toBeNull()
    expect(Object.keys(bag ?? {})).toEqual(['zero', 'empty', 'off', 'nothing'])
    expect(bag).toEqual({ zero: 0, empty: '', off: false, nothing: null })

    const [recordError, record] = parse(struct.record(struct.unknown().null()), { a: 0, b: '', c: false, d: null })
    expect(recordError).toBeNull()
    expect(record).toEqual({ a: 0, b: '', c: false, d: null })
  })

  test('passes arbitrary values through any and unknown untouched', () => {
    const token = Symbol('token')
    const fn = (): string => 'x'
    const when = new Date(0)
    const Bag = struct.object({ a: struct.any(), b: struct.unknown(), c: struct.any(), d: struct.unknown(), e: struct.any() })
    const [error, value] = parse(Bag, { a: token, b: fn, c: 10n, d: when, e: NaN })

    expect(error).toBeNull()
    expect(value?.a).toBe(token)
    expect(value?.b).toBe(fn)
    expect(value?.c).toBe(10n)
    expect(value?.d).toBe(when)
    expect(Object.is(value?.e, NaN)).toBe(true)
  })

  test('builds fresh null-prototype containers at every level in declaration order', () => {
    const Schema = struct.object({
      z: struct.array(struct.object({ b: struct.number(), a: struct.number() })),
      y: struct.record(struct.object({ k: struct.string() })),
      x: struct.tuple([struct.object({ m: struct.string() }), struct.number()]),
    })
    const input = { x: [{ m: 'm' }, 1], y: { r: { k: 'k' } }, z: [{ a: 1, b: 2 }] }
    const [error, value] = parse(Schema, input)

    expect(error).toBeNull()
    expect(Object.keys(value ?? {})).toEqual(['z', 'y', 'x'])
    const out = value as unknown as {
      x: { [key: string]: unknown }[]
      y: { [key: string]: { [key: string]: unknown } }
      z: { [key: string]: unknown }[]
    }
    const row = out.z[0] as { [key: string]: unknown }
    expect(Object.keys(row)).toEqual(['b', 'a'])
    for (const node of [out, row, out.y, out.y['r'], out.x[0]]) {
      expect(Object.getPrototypeOf(node)).toBeNull()
    }
    expect(out.z).not.toBe(input.z)
    expect(out.x).not.toBe(input.x)
    expect(row).not.toBe(input.z[0])
    expect(out.y['r']).not.toBe(input.y.r)
  })

  test('candidates that fail without an errorMap never build an issue message', async () => {
    const hostile = new Hostile()
    const Shallow = struct.or(struct.string(), struct.unknown())
    const Deep = struct.object({
      box: struct.or(struct.object({ items: struct.array(struct.object({ v: struct.string() })) }), struct.unknown()),
    })
    const deepInput = { box: { items: [{ v: hostile }] } }

    const spy = vi.spyOn(await errorsModule, 'issue')
    expect(parse(Shallow, hostile)[1]).toBe(hostile)
    expect(parse(Deep, deepInput)[0]).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    const [reported] = parse(struct.string(), hostile)
    expect(reported?.issues[0]?.message).toBe('Expected string at <root>, received object')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  const hostile = new Hostile()
  const Shape = struct.discriminatedUnion('t', [struct.object({ t: struct.literal('a') }), struct.object({ t: struct.literal('b') })])
  const Sides = struct.intersection(struct.object({ a: struct.string() }), struct.object({ b: struct.string() }))
  const quietCandidates: [string, StructLike, unknown][] = [
    ['string', struct.string(), hostile],
    ['number', struct.number(), hostile],
    ['boolean', struct.boolean(), hostile],
    ['enum', struct.enum(['a', 'b']), hostile],
    ['literal', struct.literal('a'), hostile],
    ['array', struct.array(struct.string()), hostile],
    ['tuple', struct.tuple([struct.string()]), hostile],
    ['record', struct.record(struct.string()), hostile],
    ['object', struct.object({ a: struct.string() }), hostile],
    ['object field', struct.object({ a: struct.string() }), { a: hostile }],
    ['union', struct.or(struct.string(), struct.number()), hostile],
    ['discriminated union', Shape, hostile],
    ['discriminated union value', Shape, { t: hostile }],
    ['date', struct.date(), hostile],
    ['bigint', struct.bigint(), hostile],
    ['intersection', struct.intersection(struct.string(), struct.number()), hostile],
    ['object intersection', Sides, hostile],
    ['object intersection field', Sides, { a: hostile, b: 'b' }],
  ]

  // Only the catch-all accepts the value, so the candidate in front of it has to fail quietly first.
  test.each(quietCandidates)('a %s candidate fails without building a message', async (_name, candidate, value) => {
    const spy = vi.spyOn(await errorsModule, 'issue')
    const [error, result] = parse(struct.or(candidate, struct.unknown()), value)
    expect(error).toBeNull()
    expect(result).toBe(value)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('errorMap sees every discarded candidate issue exactly once, in order, with a complete path', () => {
    const events: string[] = []
    const Schema = struct.object({
      rows: struct.array(
        struct.or(struct.object({ a: struct.number() }), struct.object({ b: struct.array(struct.string()) }), struct.unknown()),
      ),
    })
    const [error, value] = parse(
      Schema,
      { rows: [{ b: ['x', 1] }] },
      {
        errorMap: (item) => {
          events.push(`${item.code}@${item.path.join('.')}:${item.expected}`)
          return undefined
        },
      },
    )

    expect(error).toBeNull()
    expect(value).toEqual({ rows: [{ b: ['x', 1] }] })
    expect(events).toEqual(['missing_key@rows.0.a:number', 'invalid_type@rows.0.b.1:string'])
  })
})

describe('parseValue boundary', () => {
  test('forwards the mode, reports paths below the caller path, and leaves the caller path alone', () => {
    const callerPath: Path = ['caller']
    const optional = runtime(struct.string().optional())

    expect(parseValue(optional, undefined, callerPath, 'field')).toEqual({ ok: true, value: OMIT })
    expect(parseValue(optional, undefined, callerPath, 'value')).toEqual({ ok: true, value: undefined })
    expect(parseValue(runtime(struct.string()), undefined, [], 'field')).toEqual({
      ok: false,
      issue: {
        code: 'missing_key',
        expected: 'string',
        message: 'Expected string at <root>, received undefined',
        path: [],
        received: undefined,
      },
    })
    expect(parseValue(runtime(struct.object({ a: struct.array(struct.string()) })), { a: ['x', 2] }, callerPath, 'value')).toEqual({
      ok: false,
      issue: {
        code: 'invalid_type',
        expected: 'string',
        message: 'Expected string at caller.a[1], received number',
        path: ['caller', 'a', 1],
        received: 2,
      },
    })
    expect(callerPath).toEqual(['caller'])
  })
})

describe('the parked failure', () => {
  test('is empty after every parse: failed, succeeded after discarded candidates, or threw', () => {
    const Schema = struct.object({ value: struct.or(struct.object({ a: struct.number() }), struct.object({ b: struct.string() })) })
    // With an errorMap the discarded candidates report, so their issues pass through the slot.
    const errorMap: ErrorMap = () => undefined
    expect(parkedFailure()).toBeUndefined()

    expect(parse(Schema, { value: { b: 'x' } }, { errorMap })[0]).toBeNull()
    expect(parkedFailure()).toBeUndefined()

    expect(parse(Schema, { value: 1 }, { errorMap })[0]).not.toBeNull()
    expect(parkedFailure()).toBeUndefined()

    expect(parse(Schema, { value: 1 })[0]).not.toBeNull()
    expect(parkedFailure()).toBeUndefined()

    const explode: ErrorMap = () => {
      throw new Error('errorMap exploded')
    }
    expect(() => parse(Schema, { value: 1 }, { errorMap: explode })).toThrow('errorMap exploded')
    expect(parkedFailure()).toBeUndefined()

    expect(parseValue(runtime(Schema), { value: 1 }, [], 'value').ok).toBe(false)
    expect(parkedFailure()).toBeUndefined()
  })
})

describe('structs built by another copy of the package', () => {
  // A bundler can leave two copies of the package in one application. Structs are recognised by registered symbols, so
  // a struct from one copy is accepted by the other and its decode hooks run inside the parser that is parsing.
  async function otherCopy(): Promise<{ struct: typeof struct }> {
    vi.resetModules()
    const copy = await import('./index')
    expect(copy.struct).not.toBe(struct)
    return copy
  }

  test('decode hooks accept and reject exactly like the hooks of this copy', async () => {
    const other = await otherCopy()

    expect(parse(other.struct.date(), ISO)).toEqual([null, new Date(ISO)])
    expect(parse(other.struct.bigint(), '12')).toEqual([null, 12n])
    expect(parse(other.struct.bigint(), 7n)).toEqual([null, 7n])

    const rejected: [StructLike, StructLike, unknown][] = [
      [other.struct.date(), struct.date(), 'not a date'],
      [other.struct.bigint(), struct.bigint(), 'x1'],
    ]
    for (const [foreign, own, input] of rejected) {
      const [error, value] = parse(foreign, input)
      expect(value).toBeUndefined()
      expect(error?.issues).toHaveLength(1)
      expect(error?.issues).toEqual(parse(own, input)[0]?.issues)
    }

    // The parsing copy's error map applies to conversion failures raised by the other copy's decode hooks.
    const seen: string[] = []
    const errorMap: ErrorMap = (item) => {
      seen.push(item.message)
      return 'redacted'
    }
    const mappedCases: [StructLike, string, string][] = [
      [other.struct.bigint(), 'x1', 'bigint'],
      [other.struct.date(), 'not a date', 'Date'],
    ]
    for (const [foreign, input, expected] of mappedCases) {
      seen.length = 0
      const [mapped, mappedValue] = parse(foreign, input, { errorMap })
      expect(mappedValue).toBeUndefined()
      expect(seen).toEqual([`Expected ${expected} at <root>, received string`])
      expect(seen[0]).not.toContain(input)
      expect(mapped?.issues[0]?.message).toBe('redacted')
      expect(mapped?.issues[0]?.received).toBe(input)
      expect(String(mapped)).not.toContain(input)
    }
  })

  test('failures keep their place in the document and a union moves on to its next candidate', async () => {
    const other = await otherCopy()
    const Doc = struct.object({ events: struct.array(struct.object({ at: other.struct.date(), id: other.struct.bigint() })) })

    expect(
      firstIssue(
        parse(Doc, {
          events: [
            { at: ISO, id: '1' },
            { at: 'never', id: '2' },
          ],
        }),
      ),
    ).toMatchObject({
      code: 'invalid_type',
      expected: 'Date',
      path: ['events', 1, 'at'],
      received: 'never',
    })
    expect(firstIssue(parse(Doc, { events: [{ at: ISO, id: 'one' }] })).path).toEqual(['events', 0, 'id'])

    const Either = struct.or(other.struct.date(), struct.string())
    expect(parse(Either, 'plain')).toEqual([null, 'plain'])
    expect(parse(Either, ISO)).toEqual([null, new Date(ISO)])

    // The parser of the other copy runs a struct of this one the same way.
    expect(firstIssue(other.struct.parse(struct.array(struct.date()), [ISO, 'never']))).toMatchObject({ path: [1], received: 'never' })
  })
})
