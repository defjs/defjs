import { expect, test } from 'vitest'
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '../../src'
import { parseEndpointInput } from '../../src/internal/endpoint_input'
import { materializeOutboundRequest } from '../../src/internal/outbound_request'
import { encodeJson } from '../../src/struct/codec/json'
import { DEFINITION, STRUCT } from '../../src/struct/symbols'

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const Left = struct.object({ firstName: struct.string().alias('first_name') })
const Right = struct.object({ lastName: struct.string().alias('last_name') })
const logical = { firstName: 'Ada', lastName: 'Lovelace' }
const wire = { first_name: 'Ada', last_name: 'Lovelace' }

function notAStruct(value: unknown): void {
  expect(value).toBeDefined()
  expect(Object.hasOwn(value as object, DEFINITION)).toBe(false)
}

test('public parse and direct encode merge nested array members', () => {
  const rows = struct.intersection(struct.array(Left), struct.array(Right))
  expect(plain(struct.parse(rows, [wire], { aliases: true }))).toEqual([null, [logical]])
  expect(plain(encodeJson(rows, [logical]))).toEqual([wire])
})

test('shared object field preserves its agreed parent alias', async () => {
  const schema = struct.intersection(
    struct.object({ profile: Left.alias('wire_profile') }),
    struct.object({ profile: Right.alias('wire_profile') }),
  )
  const input = { profile: logical }
  expect(plain(encodeJson(schema, input))).toEqual({ wire_profile: wire })
  const parsed = await parseEndpointInput(schema, input)
  notAStruct((parsed as { [key: symbol]: unknown })[Object.getOwnPropertySymbols(parsed).find(() => true) as symbol])
  const actual = JSON.parse(String(materializeOutboundRequest({ body: parsed }, 'http').body))
  expect(actual).toEqual({ wire_profile: wire })
})

test.each(['http', 'sse', 'webSocket'] as const)('extracted merged child retains both aliases for %s query', async (transport) => {
  const schema = struct.intersection(struct.object({ profile: Left }), struct.object({ profile: Right }))
  const parsed = await parseEndpointInput(schema, { profile: logical })
  const profile = (parsed as { profile: { firstName: string; lastName: string } }).profile
  const actual = materializeOutboundRequest({ query: profile }, transport).query
  expect(plain(actual)).toEqual(wire)
})

test('root array intersection tags merged items', async () => {
  const schema = struct.intersection(struct.array(Left), struct.array(Right))
  const parsed = await parseEndpointInput(schema, [logical])
  const actual = JSON.parse(String(materializeOutboundRequest({ body: parsed }, 'http').body))
  expect(actual).toEqual([wire])
})

test('shared array field keeps both member aliases at the HTTP boundary', async () => {
  const schema = struct.intersection(struct.object({ rows: struct.array(Left) }), struct.object({ rows: struct.array(Right) }))
  const endpoint = defineRequest({
    builder: (input) => ({ body: input }),
    input: schema,
    method: 'POST',
    path: '/rows',
  })
  let actual: unknown
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async (request) => {
      actual = await new Request(request).json()
      return new Response(null, { status: 204 })
    }),
  )
  const [fault] = await client.execute(endpoint({ rows: [logical] }))
  expect(fault).toBeNull()
  expect(actual).toEqual({ rows: [wire] })
})

test('shared record field keeps both member aliases', async () => {
  const schema = struct.intersection(struct.object({ rows: struct.record(Left) }), struct.object({ rows: struct.record(Right) }))
  const parsed = await parseEndpointInput(schema, { rows: { one: logical } })
  const actual = JSON.parse(String(materializeOutboundRequest({ body: parsed }, 'http').body))
  expect(actual).toEqual({ rows: { one: wire } })
})

test('shared tuple field keeps both member aliases', async () => {
  const schema = struct.intersection(struct.object({ rows: struct.tuple([Left]) }), struct.object({ rows: struct.tuple([Right]) }))
  const parsed = await parseEndpointInput(schema, { rows: [logical] })
  const actual = JSON.parse(String(materializeOutboundRequest({ body: parsed }, 'http').body))
  expect(actual).toEqual({ rows: [wire] })
})

test('a fresh array under an object intersection guide uses every member', async () => {
  const schema = struct.intersection(struct.object({ rows: struct.array(Left) }), struct.object({ rows: struct.array(Right) }))
  const parsed = await parseEndpointInput(schema, { rows: [] })
  const actual = JSON.parse(String(materializeOutboundRequest({ body: { ...parsed, rows: [logical] } }, 'http').body))
  expect(actual).toEqual({ rows: [wire] })
})

test('array and tuple aliases for one logical key encode under both wire keys', () => {
  const nameLeft = struct.object({ name: struct.string().alias('first') })
  const nameRight = struct.object({ name: struct.string().alias('second') })
  const schema = struct.intersection(struct.array(nameLeft), struct.tuple([nameRight]))
  expect(plain(struct.parse(schema, [{ name: 'Ada' }]))).toEqual([null, [{ name: 'Ada' }]])
  expect(plain(encodeJson(schema, [{ name: 'Ada' }]))).toEqual([{ first: 'Ada', second: 'Ada' }])
  expect(plain(struct.parse(schema, [{ first: 'Ada', second: 'Ada' }], { aliases: true }))).toEqual([null, [{ name: 'Ada' }]])

  const agreed = struct.intersection(struct.array(nameLeft), struct.tuple([nameLeft]))
  expect(plain(encodeJson(agreed, [{ name: 'Ada' }]))).toEqual([{ first: 'Ada' }])
  expect(struct.parse(agreed, [{ name: 'Ada' }])[0]).toBeNull()
})

test('record and object aliases for one logical key encode under both wire keys', () => {
  const nameLeft = struct.object({ name: struct.string().alias('first') })
  const nameRight = struct.object({ name: struct.string().alias('second') })
  const schema = struct.intersection(struct.record(nameLeft), struct.object({ row: nameRight }))
  expect(plain(struct.parse(schema, { row: { name: 'Ada' } }))).toEqual([null, { row: { name: 'Ada' } }])
  expect(plain(encodeJson(schema, { row: { name: 'Ada' } }))).toEqual({ row: { first: 'Ada', second: 'Ada' } })
  expect(plain(struct.parse(schema, { row: { first: 'Ada', second: 'Ada' } }, { aliases: true }))).toEqual([null, { row: { name: 'Ada' } }])
})

test('outbound encode writes both wire keys when a fresh object aliases one logical key two ways', async () => {
  const row = struct.intersection(
    struct.object({ name: struct.string().alias('first') }),
    struct.object({ name: struct.string().alias('second') }),
  )
  const endpoint = defineRequest({
    builder: (input) => ({ body: { ...input, row: { name: 'Ada' } } }),
    input: struct.object({ note: struct.string(), row: row.optional() }),
    method: 'POST',
    path: '/rows',
  })
  let actual: unknown
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async (request) => {
      actual = await new Request(request).json()
      return new Response(null, { status: 204 })
    }),
  )
  const [fault] = await client.execute(endpoint({ note: 'hi' }))
  expect(fault).toBeNull()
  expect(actual).toEqual({ note: 'hi', row: { first: 'Ada', second: 'Ada' } })
})

test('an array standing in for an object field keeps literal items', async () => {
  const schema = struct.intersection(struct.object({ note: struct.string() }), struct.object({ extra: struct.string() }))
  const parsed = await parseEndpointInput(schema, { extra: 'x', note: 'hi' })
  const actual = JSON.parse(String(materializeOutboundRequest({ body: { ...parsed, note: ['a'] } }, 'http').body))
  expect(actual).toEqual({ extra: 'x', note: ['a'] })
})

test('unknown and any field guides leave a fresh object literal', async () => {
  const schema = struct.intersection(struct.object({ note: struct.unknown() }), struct.object({ note: struct.any() }))
  const parsed = await parseEndpointInput(schema, { note: { kept: 1 } })
  const actual = JSON.parse(String(materializeOutboundRequest({ body: { ...parsed, note: { extra: 2, kept: 1 } } }, 'http').body))
  expect(actual).toEqual({ note: { extra: 2, kept: 1 } })
})

test('an unknown field passthrough keeps stored keys beside a record field', async () => {
  const schema = struct.intersection(struct.object({ rows: struct.record(Left) }), struct.object({ rows: struct.unknown() }))
  const parsed = await parseEndpointInput(schema, { rows: {} })
  const actual = JSON.parse(String(materializeOutboundRequest({ body: { ...parsed, rows: { one: logical } } }, 'http').body))
  expect(actual).toEqual({ rows: { one: { firstName: 'Ada', first_name: 'Ada', lastName: 'Lovelace' } } })
})

test('a nested object intersection guide contributes every object side', async () => {
  const inner = struct.intersection(Left, Right)
  const schema = struct.intersection(
    struct.object({ profile: inner }),
    struct.object({ profile: struct.object({ title: struct.string().alias('title_name') }) }),
  )
  const parsed = await parseEndpointInput(schema, { profile: { ...logical, title: 'Countess' } })
  const actual = JSON.parse(
    String(materializeOutboundRequest({ body: { ...parsed, profile: { ...logical, title: 'Countess' } } }, 'http').body),
  )
  expect(actual).toEqual({ profile: { first_name: 'Ada', last_name: 'Lovelace', title_name: 'Countess' } })
})

test('a mixed intersection field does not rename a fresh sibling object', async () => {
  const mixed = struct.intersection(struct.object({ firstName: struct.string().alias('first_name') }), struct.number())
  const schema = struct.intersection(
    struct.object({ box: mixed.optional() }),
    struct.object({ box: struct.object({ title: struct.string().alias('title_name') }).optional() }),
  )
  const parsed = await parseEndpointInput(schema, {})
  const actual = JSON.parse(
    String(materializeOutboundRequest({ body: { ...parsed, box: { firstName: 'Ada', title: 'Countess' } } }, 'http').body),
  )
  expect(actual).toEqual({ box: { firstName: 'Ada', title_name: 'Countess' } })
})

test('union and discriminated guides inside an intersection pick the matching branch', async () => {
  const Cat = struct.object({ kind: struct.literal('cat'), name: struct.string().alias('cat_name') })
  const Dog = struct.object({ kind: struct.literal('dog'), name: struct.string().alias('dog_name') })
  const unionSchema = struct.intersection(
    struct.object({ pet: struct.or(Cat, struct.number()) }),
    struct.object({ pet: struct.object({ title: struct.string().alias('title_name') }) }),
  )
  const parsed = await parseEndpointInput(unionSchema, { pet: { kind: 'cat', name: 'N', title: 'T' } })
  const fresh = { kind: 'cat', name: 'N', title: 'T' }
  expect(JSON.parse(String(materializeOutboundRequest({ body: { ...parsed, pet: fresh } }, 'http').body))).toEqual({
    pet: { cat_name: 'N', kind: 'cat', title_name: 'T' },
  })
  expect(JSON.parse(String(materializeOutboundRequest({ body: { ...parsed, pet: true } }, 'http').body))).toEqual({
    pet: true,
  })

  const discriminated = struct.intersection(
    struct.object({ pet: struct.discriminatedUnion('kind', [Cat, Dog]) }),
    struct.object({ pet: struct.object({ title: struct.string().alias('title_name') }) }),
  )
  const tagged = await parseEndpointInput(discriminated, { pet: { kind: 'dog', name: 'M', title: 'T' } })
  expect(
    JSON.parse(String(materializeOutboundRequest({ body: { ...tagged, pet: { kind: 'dog', name: 'M', title: 'T' } } }, 'http').body)),
  ).toEqual({
    pet: { dog_name: 'M', kind: 'dog', title_name: 'T' },
  })
  expect(JSON.parse(String(materializeOutboundRequest({ body: { ...tagged, pet: true } }, 'http').body))).toEqual({
    pet: true,
  })
})

test('object then record tags both containers and emits every wire key', async () => {
  const schema = struct.intersection(struct.object({ name: struct.string().alias('display_name') }), struct.record(struct.string()))
  const input = { extra: 'kept', name: 'Ada' }
  const parsed = await parseEndpointInput(schema, input)
  const tag = (parsed as { [key: symbol]: object })[Object.getOwnPropertySymbols(parsed).find(() => true) as symbol]
  expect(Object.hasOwn(tag as object, DEFINITION)).toBe(false)
  expect(JSON.parse(String(materializeOutboundRequest({ body: parsed }, 'http').body))).toEqual(plain(encodeJson(schema, input)))
})

test('repeating one object struct keeps that struct as the tag', async () => {
  const Person = struct.object({ name: struct.string().alias('display_name') })
  const schema = struct.intersection(Person, Person)
  const parsed = await parseEndpointInput(schema, { name: 'Ada' })
  expect((parsed as { [STRUCT]?: unknown })[STRUCT]).toBe(Person)
  expect(JSON.parse(String(materializeOutboundRequest({ body: parsed }, 'http').body))).toEqual({ display_name: 'Ada' })
})

test('an array under two object field guides stays literal', async () => {
  const schema = struct.intersection(
    struct.object({ note: struct.object({ title: struct.string() }) }),
    struct.object({ note: struct.object({ extra: struct.number() }) }),
  )
  const parsed = await parseEndpointInput(struct.object({ item: schema }), { item: { note: { extra: 1, title: 't' } } })
  const actual = JSON.parse(String(materializeOutboundRequest({ body: { ...parsed, item: { note: ['a'] } } }, 'http').body))
  expect(actual).toEqual({ item: { note: ['a'] } })
})

test('an unmatched discriminated guide leaves the fresh object literal', async () => {
  const Cat = struct.object({ kind: struct.literal('cat'), name: struct.string().alias('cat_name') })
  const Dog = struct.object({ kind: struct.literal('dog'), name: struct.string().alias('dog_name') })
  const schema = struct.intersection(
    struct.object({ pet: struct.discriminatedUnion('kind', [Cat]).optional() }),
    struct.object({ pet: struct.discriminatedUnion('kind', [Dog]).optional() }),
  )
  const parsed = await parseEndpointInput(struct.object({ row: schema }), { row: {} })
  const actual = JSON.parse(
    String(materializeOutboundRequest({ body: { ...parsed, row: { pet: { kind: 'bird', name: 'N' } } } }, 'http').body),
  )
  expect(actual).toEqual({ row: { pet: { kind: 'bird', name: 'N' } } })
})

test('a non-array member does not supply positional guides', async () => {
  const Item = struct.object({ name: struct.string().alias('n') })
  const schema = struct.intersection(
    struct.object({ rows: struct.array(Item).optional() }),
    struct.object({ rows: struct.object({ name: struct.string().alias('display_name') }).optional() }),
  )
  const parsed = await parseEndpointInput(struct.object({ payload: schema }), { payload: {} })
  const actual = JSON.parse(
    String(materializeOutboundRequest({ body: { ...parsed, payload: { rows: [{ extra: 1, name: 'Ada' }] } } }, 'http').body),
  )
  expect(actual).toEqual({ payload: { rows: [{ extra: 1, n: 'Ada' }] } })
})

test('a string item beside an object item keeps the object aliases', async () => {
  const Item = struct.object({ name: struct.string().alias('n') })
  const schema = struct.intersection(
    struct.object({ rows: struct.array(struct.string()).optional() }),
    struct.object({ rows: struct.array(Item).optional() }),
  )
  const parsed = await parseEndpointInput(struct.object({ payload: schema }), { payload: {} })
  const actual = JSON.parse(
    String(materializeOutboundRequest({ body: { ...parsed, payload: { rows: [{ extra: 1, name: 'Ada' }] } } }, 'http').body),
  )
  expect(actual).toEqual({ payload: { rows: [{ extra: 1, n: 'Ada' }] } })
})

test('tagged intersection parse reports a conflicting shared field', async () => {
  let reads = 0
  const schema = struct.intersection(struct.object({ id: struct.string() }), struct.object({ id: struct.string() }))
  await expect(
    parseEndpointInput(schema, {
      get id() {
        reads += 1
        return reads === 1 ? 'L' : 'R'
      },
    }),
  ).rejects.toMatchObject({
    issues: [expect.objectContaining({ code: 'invalid_intersection', path: ['id'], received: 'R' })],
  })
  await expect(parseEndpointInput(schema, { id: 'L' })).resolves.toBeTruthy()
  expect(reads).toBeGreaterThan(0)
})

test('getter-recursive intersection constructs and parses', () => {
  const category = struct.intersection(
    struct.object({
      id: struct.string(),
      get children(): ReturnType<typeof struct.array> {
        return struct.array(category)
      },
    }),
    struct.object({ enabled: struct.boolean() }),
  )
  const input = { children: [], enabled: true, id: 'root' }
  expect(plain(struct.parse(category, input))).toEqual([null, input])
  expect(encodeJson(category, input)).toEqual(input)
})
