import { expect, test } from 'vitest'
import { createClient, defineEventStream, defineRequest, struct, withEndpoint, withHTTPHandle, withSSEHandle } from '../../src'
import { encodeJson } from '../../src/struct/codec/json'
import { encodeValue } from '../../src/struct/encode'
import { encodeStructValue } from '../../src/struct/introspection'
import { parseEndpointInput } from '../../src/internal/endpoint_input'
import { encodeOutbound } from '../../src/internal/outbound_request'
import { DEFINITION, STRUCT } from '../../src/struct/symbols'
import type { RuntimeStruct } from '../../src/struct/types'
import { serializeOutgoingWebSocketMessage, transformWebSocketMessage } from '../../src/web_socket/codec'

const Person = struct.intersection(
  struct.object({ firstName: struct.string().alias('first_name') }),
  struct.or(struct.object({ lastName: struct.string().alias('last_name') }), struct.number()),
)
const wire = { first_name: 'Ada', last_name: 'Lovelace' }
const logical = { firstName: 'Ada', lastName: 'Lovelace' }

const SharedWire = struct.intersection(
  struct.object({
    firstName: struct.string().alias('first_name'),
    left: struct.string().alias('shared'),
  }),
  struct.or(
    struct.object({
      lastName: struct.string().alias('last_name'),
      right: struct.string().alias('shared'),
    }),
    struct.number(),
  ),
)

const Loose = struct.intersection(struct.unknown(), struct.object({ name: struct.string().alias('full_name') }))

test('struct.parse merges every structured member of a mixed intersection', () => {
  const [aliasedFault, aliased] = struct.parse(Person, wire, { aliases: true })
  expect(aliasedFault).toBeNull()
  expect(aliased).toEqual(logical)
  expect(Object.getPrototypeOf(aliased)).toBeNull()

  const [logicalFault, parsed] = struct.parse(Person, logical)
  expect(logicalFault).toBeNull()
  expect(parsed).toEqual(logical)
  expect(Object.getPrototypeOf(parsed)).toBeNull()
})

test('struct.parse does not merge raw unknown wire keys into an aliased object', () => {
  expect(struct.parse(Loose, { extra: true, full_name: 'Miao' }, { aliases: true })).toEqual([null, { name: 'Miao' }])
  expect(
    struct.parse(struct.intersection(struct.unknown(), struct.object({ name: struct.string() })), { extra: true, name: 'Miao' }),
  ).toEqual([null, { name: 'Miao' }])
  expect(struct.parse(struct.intersection(struct.unknown(), struct.string()), 'x', { aliases: true })).toEqual([null, 'x'])
  expect(struct.parse(struct.intersection(struct.unknown(), struct.string()), 'x')).toEqual([null, 'x'])
})

test('unknown and any are intersection identities and an all-identity intersection returns the input', () => {
  const input = { extra: 1 }
  const identities = struct.intersection(struct.unknown(), struct.any())
  expect(struct.parse(identities, input)).toEqual([null, input])
  expect(struct.parse(identities, input)[1]).toBe(input)
  expect(struct.parse(identities, input, { aliases: true })[1]).toBe(input)
  expect(encodeStructValue(identities, input)).toBe(input)

  const nested = struct.intersection(struct.intersection(struct.unknown(), struct.any()), struct.object({ name: struct.string() }))
  expect(struct.parse(nested, { extra: true, name: 'Miao' })).toEqual([null, { name: 'Miao' }])
  expect(
    struct.parse(
      struct.intersection(
        struct.intersection(struct.unknown(), struct.object({ name: struct.string() })),
        struct.object({ age: struct.number() }),
      ),
      {
        age: 1,
        extra: true,
        name: 'Miao',
      },
    ),
  ).toEqual([null, { age: 1, name: 'Miao' }])
})

test('struct encode merges every structured member of a mixed intersection', () => {
  expect(encodeStructValue(Person, logical)).toEqual(logical)
  expect(Object.getPrototypeOf(encodeStructValue(Person, logical))).toBeNull()
  expect(encodeJson(Person, logical)).toEqual(wire)
  expect(Object.getPrototypeOf(encodeJson(Person, logical))).toBeNull()
  expect(() => encodeJson(SharedWire, { firstName: 'Ada', lastName: 'Lovelace', left: 'L', right: 'R' })).toThrow(
    new TypeError('invalid intersection encode at shared'),
  )
  expect(encodeJson(SharedWire, { firstName: 'Ada', lastName: 'Lovelace', left: 'same', right: 'same' })).toEqual({
    first_name: 'Ada',
    last_name: 'Lovelace',
    shared: 'same',
  })
})

test('struct encode does not merge raw unknown keys into an aliased object', () => {
  expect(encodeStructValue(Loose, { extra: true, name: 'Miao' })).toEqual({ name: 'Miao' })
  expect(encodeJson(Loose, { extra: true, name: 'Miao' })).toEqual({ full_name: 'Miao' })
  expect(encodeStructValue(struct.intersection(struct.unknown(), struct.string()), 'x')).toBe('x')
  expect(encodeStructValue(struct.intersection(struct.unknown(), struct.any()), { extra: 1 })).toEqual({ extra: 1 })
})

test.each([200, 403] as const)('HTTP %s preserves every mixed-intersection member', async (status) => {
  const endpoint = defineRequest({ method: 'GET', path: '/person', output: Person, error: Person })
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async () => Response.json(wire, { status })),
  )
  const [fault, person] = await client.execute(endpoint())

  expect(fault?.code ?? null).toBe(status === 200 ? null : 'HTTP_STATUS')
  const data = fault?.code === 'HTTP_STATUS' ? fault.data : person
  expect(data).toEqual(logical)
  expect(Object.getPrototypeOf(data)).toBeNull()
})

test('SSE event data preserves every mixed-intersection member', async () => {
  const endpoint = defineEventStream({
    events: { person: Person },
    maxBufferSize: 1024,
    maxQueueSize: 4,
    path: '/person',
  })
  const client = createClient(
    withEndpoint('https://example.test'),
    withSSEHandle(async () => {
      const body = `event: person\ndata: ${JSON.stringify(wire)}\n\n`
      return new Response(body, { headers: { 'content-type': 'text/event-stream' }, status: 200 })
    }),
  )
  const [fault, stream] = await client.execute(endpoint())

  expect(fault).toBeNull()
  if (!stream) {
    throw new Error('Expected stream')
  }
  const events = []
  for await (const event of stream) {
    events.push(event)
  }
  expect(events).toEqual([{ data: logical, event: 'person', id: undefined }])
})

test('WebSocket codecs preserve every mixed-intersection member', async () => {
  await expect(transformWebSocketMessage(Person, JSON.stringify(wire))).resolves.toEqual(logical)
  expect(JSON.parse(serializeOutgoingWebSocketMessage(Person, logical))).toEqual(wire)
  expect(() => serializeOutgoingWebSocketMessage(SharedWire, { firstName: 'Ada', lastName: 'Lovelace', left: 'L', right: 'R' })).toThrow(
    new TypeError('invalid intersection encode at shared'),
  )
})

test('equal shared primitives merge and conflicting ones fail at that path', () => {
  const Same = struct.intersection(struct.object({ id: struct.string(), name: struct.string() }), struct.object({ id: struct.string() }))
  expect(struct.parse(Same, { id: 'same', name: 'Ada' })).toEqual([null, { id: 'same', name: 'Ada' }])
  expect(Object.getPrototypeOf(struct.parse(Same, { id: 'same', name: 'Ada' })[1])).toBeNull()

  let reads = 0
  const [fastError] = struct.parse(struct.intersection(struct.object({ id: struct.string() }), struct.object({ id: struct.string() })), {
    get id() {
      reads += 1
      return reads === 1 ? 'L' : 'R'
    },
  })
  expect(fastError?.issues).toEqual([
    expect.objectContaining({
      code: 'invalid_intersection',
      expected: 'compatible intersection value',
      path: ['id'],
      received: 'R',
    }),
  ])
  expect(fastError?.format()['id']).toEqual({ _errors: ['Expected compatible intersection value at id, received "R"'] })
  expect(fastError?.flatten()).toEqual({
    fieldErrors: { id: ['Expected compatible intersection value at id, received "R"'] },
    formErrors: [],
  })
  expect(fastError?.prettify()).toContain('× id: Expected compatible intersection value at id, received "R"')
})

test('nested objects and equal-length arrays merge element-wise', () => {
  const Nested = struct.intersection(
    struct.object({ profile: struct.object({ name: struct.string() }) }),
    struct.object({ profile: struct.object({ age: struct.number() }) }),
  )
  const [nestedError, nested] = struct.parse(Nested, { profile: { age: 1, name: 'Ada' } })
  expect(nestedError).toBeNull()
  expect(nested).toEqual({ profile: { age: 1, name: 'Ada' } })
  expect(Object.getPrototypeOf(nested?.profile)).toBeNull()

  const Rows = struct.intersection(
    struct.array(struct.object({ name: struct.string() })),
    struct.array(struct.object({ age: struct.number() })),
  )
  expect(struct.parse(Rows, [{ age: 1, name: 'Ada' }])).toEqual([null, [{ age: 1, name: 'Ada' }]])

  const [elementError] = struct.parse(struct.intersection(struct.array(struct.date()), struct.array(struct.string())), [
    '2020-01-01T00:00:00.000Z',
  ])
  expect(elementError?.issues[0]).toMatchObject({
    code: 'invalid_intersection',
    path: [0],
    received: '2020-01-01T00:00:00.000Z',
  })

  const [rootError] = struct.parse(struct.intersection(struct.date(), struct.string()), '2020-01-01T00:00:00.000Z')
  expect(rootError?.issues[0]).toMatchObject({ code: 'invalid_intersection', path: [], received: '2020-01-01T00:00:00.000Z' })
  expect(rootError?.flatten().formErrors).toEqual(['Expected compatible intersection value at <root>, received "2020-01-01T00:00:00.000Z"'])
  expect(rootError?.format()._errors).toEqual(['Expected compatible intersection value at <root>, received "2020-01-01T00:00:00.000Z"'])

  const [dateError, date] = struct.parse(struct.intersection(struct.date(), struct.date()), '2020-01-01T00:00:00.000Z')
  expect(dateError).toBeNull()
  expect(date).toBeInstanceOf(Date)
  expect((date as Date).toISOString()).toBe('2020-01-01T00:00:00.000Z')
})

test('array length mismatch and unequal dates are intersection conflicts', () => {
  const objects = struct.intersection(struct.object({ value: struct.string() }), struct.object({ value: struct.string() }))
  let calls = 0
  expect(() =>
    encodeValue(
      objects as unknown as RuntimeStruct,
      { value: 'x' },
      {
        encodeObject() {
          calls += 1
          return calls === 1 ? ['a'] : ['a', 'b']
        },
      },
    ),
  ).toThrow(new TypeError('invalid intersection encode at <root>'))
  expect(calls).toBe(2)

  let reads = 0
  const [error] = struct.parse(struct.intersection(struct.object({ when: struct.date() }), struct.object({ when: struct.date() })), {
    get when() {
      reads += 1
      return reads === 1 ? '2020-01-01T00:00:00.000Z' : '2021-01-01T00:00:00.000Z'
    },
  })
  expect(error?.issues[0]?.code).toBe('invalid_intersection')
  expect(error?.issues[0]?.path).toEqual(['when'])
  expect(error?.issues[0]?.received).toBeInstanceOf(Date)
})

test('a conflicting intersection inside a union stays a quiet candidate failure', () => {
  let reads = 0
  const [objectError, objectValue] = struct.parse(
    struct.or(
      struct.intersection(struct.object({ id: struct.string() }), struct.object({ id: struct.string() })),
      struct.literal('fallback'),
    ),
    {
      get id() {
        reads += 1
        return reads === 1 ? 'L' : 'R'
      },
    },
  )
  expect(objectValue).toBeUndefined()
  expect(objectError?.issues[0]?.code).toBe('invalid_union')
  expect(reads).toBe(2)

  const [rootError, rootValue] = struct.parse(
    struct.or(struct.intersection(struct.date(), struct.string()), struct.literal('fallback')),
    '2020-01-01T00:00:00.000Z',
  )
  expect(rootValue).toBeUndefined()
  expect(rootError?.issues[0]?.code).toBe('invalid_union')
})

test('tagged outbound encode deep-merges nested objects and reports wire conflicts as REQ_BUILD_FAILED', async () => {
  const Nested = struct.intersection(
    struct.object({ profile: struct.object({ name: struct.string().alias('full_name') }) }),
    struct.object({ profile: struct.object({ age: struct.number().alias('years') }) }),
  )
  let sent: unknown
  const nestedEndpoint = defineRequest({
    builder: (input) => ({ body: input }),
    input: Nested,
    method: 'POST',
    path: '/nested',
  })
  const nestedClient = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async (request) => {
      sent = await new Request(request).json()
      return new Response(null, { status: 204 })
    }),
  )
  const [nestedFault] = await nestedClient.execute(nestedEndpoint({ profile: { age: 1, name: 'Ada' } }))
  expect(nestedFault).toBeNull()
  expect(sent).toEqual({ profile: { full_name: 'Ada', years: 1 } })

  const Shared = struct.intersection(
    struct.object({ left: struct.string().alias('shared') }),
    struct.object({ right: struct.string().alias('shared') }),
  )
  const endpoint = defineRequest({
    builder: (input) => ({ body: input.body }),
    input: struct.object({ body: Shared }),
    method: 'POST',
    path: '/pair',
  })
  let equalSent: unknown
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async (request) => {
      equalSent = await new Request(request).json()
      return new Response(null, { status: 204 })
    }),
  )
  const [equalFault] = await client.execute(endpoint({ body: { left: 'same', right: 'same' } }))
  expect(equalFault).toBeNull()
  expect(equalSent).toEqual({ shared: 'same' })

  const [fault] = await client.execute(endpoint({ body: { left: 'L', right: 'R' } }))
  expect(fault?.code).toBe('REQ_BUILD_FAILED')
  expect(fault?.cause).toBeInstanceOf(TypeError)
  if (!(fault?.cause instanceof TypeError)) {
    throw new Error('expected intersection encode TypeError')
  }
  expect(fault.cause.message).toBe('invalid intersection encode at shared')
})

test('record intersections tag every record container and emit each wire key', async () => {
  const Rows = struct.intersection(struct.record(struct.string()), struct.record(struct.string()))
  const rows = await parseEndpointInput(Rows, { name: 'Ada' })
  expect(Object.fromEntries(Object.entries(rows as { [key: string]: unknown }))).toEqual({ name: 'Ada' })
  const rowsTag = (rows as { [STRUCT]?: object })[STRUCT]
  expect(rowsTag).toBeDefined()
  expect(Object.hasOwn(rowsTag as object, DEFINITION)).toBe(false)
  expect(JSON.parse(JSON.stringify(encodeOutbound(rows)))).toEqual(encodeJson(Rows, { name: 'Ada' }))

  const Mixed = struct.intersection(struct.record(struct.string()), struct.object({ name: struct.string().alias('display_name') }))
  const mixed = await parseEndpointInput(Mixed, { extra: 'kept', name: 'Ada' })
  expect(Object.fromEntries(Object.entries(mixed as { [key: string]: unknown }))).toEqual({ extra: 'kept', name: 'Ada' })
  const mixedTag = (mixed as { [STRUCT]?: object })[STRUCT]
  expect(mixedTag).toBeDefined()
  expect(Object.hasOwn(mixedTag as object, DEFINITION)).toBe(false)
  expect(JSON.parse(JSON.stringify(encodeOutbound(mixed)))).toEqual(encodeJson(Mixed, { extra: 'kept', name: 'Ada' }))
})

test('tagged object intersections keep a guide set for equal shared fields and an absent optional', async () => {
  const SharedId = struct.intersection(
    struct.object({ id: struct.string() }),
    struct.object({ id: struct.string(), name: struct.string() }),
  )
  const shared = await parseEndpointInput(SharedId, { id: '1', name: 'Ada' })
  expect(Object.fromEntries(Object.entries(shared as { [key: string]: unknown }))).toEqual({ id: '1', name: 'Ada' })
  const sharedTag = (shared as { [STRUCT]?: object })[STRUCT]
  expect(sharedTag).toBeDefined()
  expect(Object.hasOwn(sharedTag as object, DEFINITION)).toBe(false)

  const MixedField = struct.intersection(
    struct.object({ profile: struct.object({ name: struct.string() }).optional() }),
    struct.object({ profile: struct.string().optional() }),
  )
  const mixed = await parseEndpointInput(MixedField, {})
  expect(Object.fromEntries(Object.entries(mixed as { [key: string]: unknown }))).toEqual({})
  const mixedTag = (mixed as { [STRUCT]?: object })[STRUCT]
  expect(mixedTag).toBeDefined()
  expect(Object.hasOwn(mixedTag as object, DEFINITION)).toBe(false)
})

test('object-side encode skips an explicit undefined alias and an omitted logical key', () => {
  const Aliased = struct.intersection(
    struct.object({ first: struct.string().alias('wire') }),
    struct.object({ second: struct.string().optional().alias('other') }),
  )
  expect(encodeJson(Aliased, { first: 'first', second: undefined })).toEqual({ wire: 'first' })

  const Logical = struct.intersection(struct.object({ id: struct.string() }), struct.object({ note: struct.string().optional() }))
  const encoded = encodeStructValue(Logical, { id: '1' })
  expect(encoded).toEqual({ id: '1' })
  expect(Object.getPrototypeOf(encoded)).toBeNull()
})

test('tagged date intersections keep the equal date and do not attach an object tag', async () => {
  const Both = struct.intersection(struct.date(), struct.date())
  const value = await parseEndpointInput(Both, '2020-01-01T00:00:00.000Z')
  expect(value).toBeInstanceOf(Date)
  expect((value as Date).toISOString()).toBe('2020-01-01T00:00:00.000Z')
  expect((value as { [STRUCT]?: unknown })[STRUCT]).toBeUndefined()
})
