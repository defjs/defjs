import { Readable } from 'node:stream'
import { expectTypeOf } from 'vitest'
import { defineEventStream, defineRequest, defineWebSocket, struct, type BuilderInput, type WebSocketExecuteOptions } from '../../src'
import { STRUCT } from '../../src/struct/symbols'

const Profile = struct.object({
  displayName: struct.string().alias('display_name'),
  birthday: struct.date(),
})
const RequestInput = struct.object({
  id: struct.number().alias('user_id'),
  profile: Profile,
})

type ParsedRequest = BuilderInput<typeof RequestInput>
expectTypeOf<ParsedRequest['id']>().toEqualTypeOf<number>()
expectTypeOf<ParsedRequest>().toMatchTypeOf<{ id: number; profile: { displayName: string } }>()
expectTypeOf<BuilderInput<typeof Profile>>().toMatchTypeOf<{ displayName: string }>()

const postUser = defineRequest({
  builder: (input) => {
    expectTypeOf(input).toMatchTypeOf<ParsedRequest>()
    return { body: { ...input.profile, role: 'admin' }, path: { user_id: input.id } }
  },
  input: RequestInput,
  method: 'POST',
  path: '/users/:user_id',
})
void postUser

// @ts-expect-error A tagged object with a nested profile is not a flat path record.
defineRequest({ builder: (input) => ({ path: input }), input: RequestInput, method: 'GET', path: '/users/:user_id' })

// @ts-expect-error The anonymous path record must use the exact template key.
defineRequest({ builder: (input) => ({ path: { id: input.id } }), input: RequestInput, method: 'GET', path: '/users/:user_id' })

// @ts-expect-error GET bodies are forbidden when the method is a literal.
defineRequest({ builder: () => ({ body: { ok: true } }), method: 'GET', path: '/users' })

const dynamicMethod: string = 'GET'
defineRequest({ builder: () => ({ body: { ok: true } }), method: dynamicMethod, path: '/users' })

defineWebSocket({
  // @ts-expect-error WebSocket builders do not accept headers.
  builder: () => ({ headers: { authorization: 'x' } }),
  incoming: struct.unknown(),
  maxIncomingQueueSize: 1,
  path: '/ws',
})

defineWebSocket({
  // @ts-expect-error WebSocket builders do not accept bodies.
  builder: () => ({ body: 'x' }),
  incoming: struct.unknown(),
  maxIncomingQueueSize: 1,
  path: '/ws',
})

const Union = struct.or(struct.object({ kind: struct.literal('a'), value: struct.string() }), struct.number())
const Both = struct.intersection(struct.object({ left: struct.string() }), struct.object({ right: struct.number() }))
const OptionalChild = Profile.optional()
const NullableChild = Profile.nullable()
const unionObject: BuilderInput<typeof Union> = { kind: 'a', value: 'x', [STRUCT]: struct.unknown() }
const unionNumber: BuilderInput<typeof Union> = 1
const bothValue: BuilderInput<typeof Both> = { left: 'x', right: 1, [STRUCT]: struct.unknown() }
const optionalValue: BuilderInput<typeof OptionalChild> = undefined
const nullableValue: BuilderInput<typeof NullableChild> = null
void unionObject
void unionNumber
void bothValue
void optionalValue
void nullableValue

const stream = defineEventStream({
  builder: (input) => ({ query: { id: input.id } }),
  events: { message: struct.string() },
  input: struct.object({ id: struct.number() }),
  maxBufferSize: 1,
  maxQueueSize: 1,
  path: '/events',
})
void stream

const socket = defineWebSocket({
  builder: (input) => ({ path: { room: input.room } }),
  incoming: struct.unknown(),
  input: struct.object({ room: struct.string() }),
  maxIncomingQueueSize: 1,
  path: '/ws/:room',
})
void socket

const typedHeartbeat: WebSocketExecuteOptions<unknown, { type: 'ping' }> = {
  heartbeat: {
    intervalMs: 10,
    message: () => ({ type: 'ping' }),
  },
}
void typedHeartbeat

// @ts-expect-error An async builder is not a synchronous request shape.
defineRequest({ builder: async () => ({ body: {} }), method: 'POST', path: '/async' })

export type Cases = true

const User = struct.object({ id: struct.string().alias('user_id') })
const Modified = User.optional().nullable().nullish().optional().alias('user')
const Record = struct.record(Modified).optional().nullable()
const Tuple = struct.tuple([Modified]).nullable().optional()

defineRequest({
  input: Record,
  method: 'GET',
  path: '/users/:user_id',
  builder: (input) => ({ path: input?.['selected'] ?? { user_id: 'fallback' } }),
})
defineRequest({
  input: Tuple,
  method: 'GET',
  path: '/users/:user_id',
  builder: (input) => ({ path: input?.[0] ?? { user_id: 'fallback' } }),
})
expectTypeOf<BuilderInput<typeof Modified>>().toEqualTypeOf<BuilderInput<typeof User> | null | undefined>()

const Nested = struct.record(struct.object({ id: struct.string(), profile: User }))
defineRequest({
  input: Nested,
  method: 'GET',
  path: '/users/:id',
  // @ts-expect-error A tagged record value with nested fields cannot use the anonymous path branch.
  builder: (input) => ({ path: input['selected'] }),
})
defineRequest({
  input: struct.tuple([struct.object({ id: struct.string().optional() })]),
  method: 'GET',
  path: '/users/:id',
  // @ts-expect-error Optional tuple object fields cannot satisfy a flat scalar path.
  builder: (input) => ({ path: input[0] }),
})
defineRequest({
  input: Record,
  method: 'GET',
  path: '/users/:user_id',
  // @ts-expect-error Missing narrowing leaves nullish record values unsuitable for path.
  builder: (input) => ({ path: input?.['selected'] }),
})
defineRequest({
  input: Tuple,
  method: 'GET',
  path: '/users/:user_id',
  // @ts-expect-error An anonymous path still requires the exact wire key.
  builder: (input) => ({ path: { userId: input?.[0]?.id ?? 'fallback' } }),
})
defineRequest({
  input: Modified,
  method: 'HEAD',
  path: '/users',
  // @ts-expect-error Modifier preservation must not relax the HEAD body prohibition.
  builder: (input) => ({ body: input }),
})
defineWebSocket({
  input: Tuple,
  incoming: struct.string(),
  maxIncomingQueueSize: 1,
  path: '/ws',
  // @ts-expect-error Contextual builder returns still prohibit WebSocket headers.
  builder: () => ({ headers: {} }),
})

class Payload {
  value = 7
}
interface UserDto {
  name: string
}
type UserAlias = { name: string }
declare const dto: UserDto
declare const aliasBody: UserAlias
declare const parsedBody: ParsedRequest

// @ts-expect-error A Node Readable is not JSON data.
defineRequest({ builder: () => ({ body: Readable.from(['x']) }), method: 'POST', path: '/users' })

// @ts-expect-error An async generator is not JSON data.
defineRequest({ builder: () => ({ body: (async function* () {})() }), method: 'POST', path: '/users' })

// @ts-expect-error A Map is not JSON data.
defineRequest({ builder: () => ({ body: new Map() }), method: 'POST', path: '/users' })

// @ts-expect-error A Set is not JSON data.
defineRequest({ builder: () => ({ body: new Set() }), method: 'POST', path: '/users' })

// @ts-expect-error A class instance is not JSON data.
defineRequest({ builder: () => ({ body: new Payload() }), method: 'POST', path: '/users' })

// @ts-expect-error A function is not JSON data.
defineRequest({ builder: () => ({ body: () => 1 }), method: 'POST', path: '/users' })

// @ts-expect-error An interface value is not JSON data.
defineRequest({ builder: () => ({ body: dto }), method: 'POST', path: '/users' })

defineEventStream({
  // @ts-expect-error A Map is not JSON data.
  builder: () => ({ body: new Map() }),
  events: { message: struct.string() },
  maxBufferSize: 1,
  maxQueueSize: 1,
  method: 'POST',
  path: '/events',
})

defineRequest({ builder: () => ({ body: parsedBody }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: { name: 'Ada' } }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: aliasBody }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: { ...dto } }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: new Uint8Array(1) }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: new Blob([]) }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: new ReadableStream<Uint8Array>() }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: new Date() }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: 1n }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: null }), method: 'POST', path: '/users' })
defineRequest({ builder: () => ({ body: ['a'] }), method: 'POST', path: '/users' })
