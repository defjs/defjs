import { expect, test } from 'vitest'
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle, type AnyStruct, type Struct } from '../../src'
import { parseEndpointInput } from '../../src/internal/endpoint_input'
import { encodeOutbound } from '../../src/internal/outbound_request'
import { encodeJson } from '../../src/struct/codec/json'
import { guideMembers, readOwnGuide } from '../../src/struct/guide'
import type { RuntimeStruct } from '../../src/struct/types'
import { mergeIntersectionValues } from '../../src/struct/utils'
import { serializeOutgoingWebSocketMessage } from '../../src/web_socket/codec'

const A = struct.object({ name: struct.string().alias('a_name') })
const B = struct.object({ name: struct.string().alias('b_name') })
const value = { name: 'N' }
const plain = (input: unknown): unknown => JSON.parse(JSON.stringify(input))

async function equivalent(schema: AnyStruct, input: unknown): Promise<void> {
  const parsed = await parseEndpointInput(schema, input as never)
  expect(plain(encodeOutbound(parsed))).toEqual(plain(encodeJson(schema, parsed)))
}

function tagMembers(node: object): readonly RuntimeStruct[] {
  const tag = readOwnGuide(node)
  expect(tag).toBeDefined()
  return guideMembers(tag as RuntimeStruct)
}

test('split parents keep the other group only as a literal extra', async () => {
  const schema = struct.intersection(
    struct.object({ profile: struct.object({ firstName: struct.string().alias('first_name') }).alias('p1') }),
    struct.object({ profile: struct.object({ lastName: struct.string().alias('last_name') }).alias('p2') }),
  )
  const parsed = await parseEndpointInput(schema, { profile: { firstName: 'Ada', lastName: 'Lovelace' } })
  expect(plain(encodeJson(schema, parsed))).toEqual({ p1: { first_name: 'Ada' }, p2: { last_name: 'Lovelace' } })
  expect(plain(encodeOutbound(parsed))).toEqual({
    p1: { first_name: 'Ada', lastName: 'Lovelace' },
    p2: { firstName: 'Ada', last_name: 'Lovelace' },
  })
})

test('direct record and object intersection encodes every declared wire key', () =>
  equivalent(struct.intersection(struct.record(struct.string()), struct.object({ name: struct.string().alias('display_name') })), {
    extra: 'E',
    name: 'N',
  }))

test('a record selected by a union stays in the merged tag and on the wire', async () => {
  const record = struct.record(struct.string())
  const object = struct.object({ name: struct.string().alias('display_name') })
  const schema = struct.intersection(struct.or(record, struct.literal('other')), object)
  const parsed = await parseEndpointInput(schema, { extra: 'E', name: 'N' })
  const members = tagMembers(parsed)
  expect(members).toContain(record)
  expect(members).toContain(object)
  await equivalent(schema, { extra: 'E', name: 'N' })
})

test('a record inside an array item stays in that item tag', async () => {
  const record = struct.record(struct.string())
  const object = struct.object({ name: struct.string().alias('display_name') })
  const schema = struct.intersection(struct.array(record), struct.array(object))
  const parsed = (await parseEndpointInput(schema, [{ name: 'N' }])) as unknown[]
  expect(Object.getOwnPropertySymbols(parsed)).toEqual([])
  const members = tagMembers(parsed[0] as object)
  expect(members).toContain(record)
  expect(members).toContain(object)
  await equivalent(schema, [{ name: 'N' }])
})

test('a record inside a tuple item stays in that item tag', async () => {
  const record = struct.record(struct.string())
  const object = struct.object({ name: struct.string().alias('display_name') })
  const schema = struct.intersection(struct.tuple([record]), struct.tuple([object]))
  const parsed = (await parseEndpointInput(schema, [{ name: 'N' }])) as unknown[]
  const members = tagMembers(parsed[0] as object)
  expect(members).toContain(record)
  expect(members).toContain(object)
  await equivalent(schema, [{ name: 'N' }])
})

test('a record nested under a shared object descendant stays in the merged tag', async () => {
  const record = struct.record(struct.string())
  const object = struct.object({ name: struct.string().alias('display_name') })
  const schema = struct.intersection(
    struct.object({ rows: struct.object({ one: record }) }),
    struct.object({ rows: struct.object({ one: object }) }),
  )
  const parsed = await parseEndpointInput(schema, { rows: { one: { name: 'N' } } })
  const one = (parsed as { rows: { one: object } }).rows.one
  const members = tagMembers(one)
  expect(members).toContain(record)
  expect(members).toContain(object)
  await equivalent(schema, { rows: { one: { name: 'N' } } })
})

test('a lone record container is tagged and null is not', async () => {
  const record = struct.record(struct.string())
  const parsed = await parseEndpointInput(record, { name: 'N' })
  expect(tagMembers(parsed)).toEqual([record])

  const schema = struct.object({ note: struct.string(), rows: record.nullable() })
  const withNull = await parseEndpointInput(schema, { note: 'ok', rows: null })
  expect(withNull.rows).toBeNull()
  expect(tagMembers(withNull)).toEqual([schema])
})

const splitArray = struct.intersection(
  struct.object({ row: struct.array(A).alias('p1') }),
  struct.object({ row: struct.array(B).alias('p2') }),
)

test('wire groups do not leak the other array item alias', () => equivalent(splitArray, { row: [value] }))

test('wire groups do not leak the other union branch alias', () =>
  equivalent(
    struct.intersection(struct.object({ row: struct.or(A, struct.literal('other')).alias('p1') }), struct.object({ row: B.alias('p2') })),
    { row: value },
  ))

test('wire groups do not leak the other nested object alias', () =>
  equivalent(
    struct.intersection(
      struct.object({ row: struct.object({ child: A }).alias('p1') }),
      struct.object({ row: struct.object({ child: B }).alias('p2') }),
    ),
    { row: { child: value } },
  ))

test('repeated identical intersection members still encode both wire names', async () => {
  const left = struct.object({ row: A.alias('p1') })
  const right = struct.object({ row: B.alias('p2') })
  await equivalent(struct.intersection(left, right, left), { row: value })
})

test('a nullable record null parses and encodes inside an intersection', async () => {
  const schema = struct.intersection(
    struct.object({ rows: struct.record(struct.string()).nullable() }),
    struct.object({ note: struct.string() }),
  )
  expect(struct.parse(schema, { note: 'ok', rows: null })[0]).toBeNull()
  const parsed = await parseEndpointInput(schema, { note: 'ok', rows: null })
  expect(parsed.rows).toBeNull()
  expect(parsed.note).toBe('ok')
  await equivalent(schema, { note: 'ok', rows: null })
})

test('a separately parsed replacement keeps its own wire name in every group', async () => {
  const schema = struct.intersection(struct.object({ row: A.optional().alias('p1') }), struct.object({ row: B.optional().alias('p2') }))
  const root = await parseEndpointInput(schema, {})
  const own = await parseEndpointInput(struct.object({ name: struct.string().alias('own_name') }), value)
  expect(plain(encodeOutbound({ ...root, row: own }))).toEqual({ p1: { own_name: 'N' }, p2: { own_name: 'N' } })
})

test('optional nullish date and bigint leaves round-trip through both encoders', async () => {
  const schema = struct.intersection(
    struct.object({ count: struct.bigint().alias('total'), date: struct.date().alias('timestamp') }),
    struct.object({ row: A.nullish() }),
  )
  const dated = { count: 2n, date: new Date('2026-01-01T00:00:00Z'), row: null }
  await equivalent(schema, dated)
  await equivalent(schema, { count: dated.count, date: dated.date })
})

test('a recursive getter intersection stays lazy and preserves aliases', async () => {
  let reads = 0
  const tree: ReturnType<typeof struct.intersection<readonly [Struct, Struct]>> = struct.intersection(
    struct.object({
      name: struct.string().alias('wire_name'),
      get children(): ReturnType<typeof struct.array> {
        reads += 1
        return struct.array(tree)
      },
    }),
    struct.object({ enabled: struct.boolean() }),
  )
  expect(reads).toBe(0)
  await equivalent(tree, { children: [{ children: [], enabled: false, name: 'child' }], enabled: true, name: 'root' })
  expect(reads).toBe(1)
})

test('unequal values on one wire key still fail encoding', () => {
  const schema = struct.intersection(
    struct.object({ left: struct.string().alias('key') }),
    struct.object({ right: struct.string().alias('key') }),
  )
  expect(() => encodeJson(schema, { left: 'L', right: 'R' })).toThrow(/invalid intersection encode/)
})

test('an HTTP split array matches the WebSocket encode.ts body', async () => {
  let body: unknown
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async (request, init) => {
      body = await new Request(request, init).json()
      return new Response(null, { status: 204 })
    }),
  )
  const endpoint = defineRequest({ builder: (input) => ({ body: input }), input: splitArray, method: 'POST', path: '/' })
  const [fault] = await client.execute(endpoint({ row: [value] }))
  expect(fault).toBeNull()
  expect(body).toEqual(JSON.parse(serializeOutgoingWebSocketMessage(splitArray, { row: [value] })))
})

test('a valid nullable record reaches the HTTP handle', async () => {
  let calls = 0
  const nullableRecord = struct.intersection(
    struct.object({ rows: struct.record(struct.string()).nullable() }),
    struct.object({ note: struct.string() }),
  )
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async () => {
      calls += 1
      return new Response(null, { status: 204 })
    }),
  )
  const endpoint = defineRequest({ builder: (input) => ({ body: input }), input: nullableRecord, method: 'POST', path: '/' })
  const [fault] = await client.execute(endpoint({ note: 'ok', rows: null }))
  expect(fault).toBeNull()
  expect(calls).toBe(1)
})

test('a record of any keeps its declared key beside an aliased object field', async () => {
  const schema = struct.intersection(struct.record(struct.any()), struct.object({ name: struct.string().alias('display_name') }))
  await equivalent(schema, { name: 'N' })
})

test('a record of unknown keeps its declared key beside an aliased object field', async () => {
  const schema = struct.intersection(struct.record(struct.unknown()), struct.object({ name: struct.string().alias('display_name') }))
  await equivalent(schema, { name: 'N' })
})

test('an any object field is its own wire group beside an aliased field', async () => {
  const schema = struct.intersection(struct.object({ name: struct.any() }), struct.object({ name: struct.string().alias('display_name') }))
  await equivalent(schema, { name: 'N' })
})

test('an unknown object field is its own wire group beside an aliased field', async () => {
  const schema = struct.intersection(
    struct.object({ name: struct.unknown() }),
    struct.object({ name: struct.string().alias('display_name') }),
  )
  await equivalent(schema, { name: 'N' })
})

test('a record of any passthrough stays beside a nested aliased object on the same wire', async () => {
  const schema = struct.intersection(
    struct.record(struct.any()),
    struct.object({ profile: struct.object({ name: struct.string().alias('display_name') }) }),
  )
  await equivalent(schema, { profile: { name: 'N' } })
})

test('a record of unknown passthrough stays beside a nested aliased object on the same wire', async () => {
  const schema = struct.intersection(
    struct.record(struct.unknown()),
    struct.object({ profile: struct.object({ name: struct.string().alias('display_name') }) }),
  )
  await equivalent(schema, { profile: { name: 'N' } })
})

test('an any object field passthrough stays beside a nested aliased object on the same wire', async () => {
  const schema = struct.intersection(
    struct.object({ profile: struct.any() }),
    struct.object({ profile: struct.object({ name: struct.string().alias('display_name') }) }),
  )
  await equivalent(schema, { profile: { name: 'N' } })
})

test('an any array item stays beside an aliased array item', async () => {
  const profile = struct.object({ name: struct.string().alias('display_name') })
  const schema = struct.object({
    rows: struct.intersection(struct.array(struct.any()), struct.array(profile)),
  })
  await equivalent(schema, { rows: [{ name: 'N' }] })
})

test('an unknown array item stays beside an aliased array item', async () => {
  const profile = struct.object({ name: struct.string().alias('display_name') })
  const schema = struct.object({
    rows: struct.intersection(struct.array(struct.unknown()), struct.array(profile)),
  })
  await equivalent(schema, { rows: [{ name: 'N' }] })
})

test('an aliased any field passes the stored object through on its own wire', async () => {
  const schema = struct.intersection(
    struct.object({ item: struct.any().alias('w_any') }),
    struct.object({ item: struct.object({ name: struct.string().alias('display_name') }) }),
  )
  await equivalent(schema, { item: { name: 'N' } })
})

test('an anonymous record child keeps the sibling object tag', async () => {
  const profile = struct.object({ name: struct.string().alias('display_name') })
  const schema = struct.intersection(struct.record(struct.any()), struct.object({ profile }))
  const parsed = await parseEndpointInput(schema, { profile: { name: 'N' } })
  expect(tagMembers((parsed as { profile: object }).profile)).toEqual([profile])
})

test('merging two untagged objects does not invent a parse tag', () => {
  const merged = mergeIntersectionValues({ left: 1, shared: { n: 1 } }, { right: 2, shared: { extra: true, n: 1 } }, true, 0)
  expect(merged.ok).toBe(true)
  if (!merged.ok) {
    return
  }
  expect(readOwnGuide(merged.value as object)).toBeUndefined()
  expect(readOwnGuide((merged.value as { shared: object }).shared)).toBeUndefined()
  expect(plain(merged.value)).toEqual({ left: 1, shared: { extra: true, n: 1 }, right: 2 })
})
