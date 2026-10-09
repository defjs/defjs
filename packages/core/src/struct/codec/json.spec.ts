import { describe, expect, test } from 'vitest'
import { struct } from '../index'
import { decodeJson, encodeJson } from './json'

describe('codec/json.ts', () => {
  test('maps API JSON field names through alias()', () => {
    const user = struct.object({
      id: struct.number().alias('id'),
      name: struct.string().alias('user_name'),
    })

    expect(encodeJson(user, { id: 1, name: 'Miao' })).toEqual({
      id: 1,
      user_name: 'Miao',
    })
    expect(decodeJson(user, { id: 1, user_name: 'Miao' })).toEqual({
      id: 1,
      name: 'Miao',
    })
  })

  test('falls back to field names for fields without aliases', () => {
    const user = struct.object({
      page: struct.number(),
      pageSize: struct.number().alias('page_size'),
    })

    expect(encodeJson(user, { pageSize: 50, page: 1 })).toEqual({ page_size: 50, page: 1 })
    expect(decodeJson(user, { page_size: 50, page: 1 })).toEqual({ pageSize: 50, page: 1 })
  })

  test('stops alias decoding at the first invalid field', () => {
    const user = struct.object({
      id: struct.string().alias('user_id'),
      name: struct.string().alias('user_name'),
    })
    let laterReads = 0
    const input = Object.defineProperties(
      {},
      {
        user_id: { enumerable: true, value: 1 },
        user_name: {
          enumerable: true,
          get() {
            laterReads += 1
            throw new Error('later field must not be read')
          },
        },
      },
    )

    expect(() => decodeJson(user, input)).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ path: ['id'] })] }))
    expect(laterReads).toBe(0)
  })

  test('unknown JSON wire keys are ignored', () => {
    const query = struct.object({
      pageSize: struct.number().alias('page_size'),
    })

    expect(decodeJson(query, { page_size: 20, pageSize: 99 })).toEqual({ pageSize: 20 })
  })

  test('does not filter unaliased fields', () => {
    const query = struct.object({
      internal: struct.string(),
      pageSize: struct.number().alias('page_size'),
    })

    expect(decodeJson(query, { internal: 'kept', page_size: 20 })).toEqual({
      internal: 'kept',
      pageSize: 20,
    })
    expect(encodeJson(query, { internal: 'kept', pageSize: 20 })).toEqual({
      internal: 'kept',
      page_size: 20,
    })
  })

  test('recurses into nested JSON objects and arrays', () => {
    const profile = struct.object({
      name: struct.string().alias('full_name'),
      secret: struct.string().optional(),
    })
    const user = struct.object({
      internalOnly: struct.string().optional(),
      profile: profile.alias('profile'),
      team: struct.array(profile).alias('team'),
    })

    expect(
      encodeJson(user, {
        internalOnly: 'visible',
        profile: { name: 'Miao', secret: 'local' },
        team: [{ name: 'Core', secret: 'local-team' }],
      }),
    ).toEqual({
      internalOnly: 'visible',
      profile: { full_name: 'Miao', secret: 'local' },
      team: [{ full_name: 'Core', secret: 'local-team' }],
    })

    expect(
      decodeJson(user, {
        internalOnly: 'visible',
        profile: { full_name: 'Miao', secret: 'local' },
        team: [{ full_name: 'Core', secret: 'local-team' }],
      }),
    ).toEqual({
      internalOnly: 'visible',
      profile: { name: 'Miao', secret: 'local' },
      team: [{ name: 'Core', secret: 'local-team' }],
    })
  })

  test('recurses into top-level arrays of objects', () => {
    const profile = struct.object({
      name: struct.string().alias('full_name'),
      secret: struct.string().optional(),
    })
    const profiles = struct.array(profile)

    expect(encodeJson(profiles, [{ name: 'Miao', secret: 'local' }])).toEqual([{ full_name: 'Miao', secret: 'local' }])
    expect(decodeJson(profiles, [{ full_name: 'Miao', secret: 'local' }])).toEqual([{ name: 'Miao', secret: 'local' }])
  })

  test('decodes aliased union objects symmetrically', () => {
    const event = struct.or(
      struct.object({
        payload: struct.string().alias('body'),
        type: struct.literal('message').alias('kind'),
      }),
      struct.object({
        count: struct.number().alias('count'),
        type: struct.literal('count').alias('kind'),
      }),
    )

    expect(encodeJson(event, { payload: 'hello', type: 'message' })).toEqual({
      body: 'hello',
      kind: 'message',
    })
    expect(encodeJson(event, { count: 3, type: 'count' })).toEqual({
      count: 3,
      kind: 'count',
    })
    expect(decodeJson(event, { body: 'hello', kind: 'message' })).toEqual({
      payload: 'hello',
      type: 'message',
    })
    expect(decodeJson(event, { count: 3, kind: 'count' })).toEqual({
      count: 3,
      type: 'count',
    })
    expect(() => decodeJson(event, { count: 1, kind: 'message' })).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'invalid_union', path: [] })] }),
    )
  })

  test('selects aliased union branches by scalar field type without a discriminator', () => {
    const event = struct.or(
      struct.object({ value: struct.string().alias('text') }),
      struct.object({ value: struct.number().alias('count') }),
    )

    expect(encodeJson(event, { value: 'hello' })).toEqual({ text: 'hello' })
    expect(encodeJson(event, { value: 3 })).toEqual({ count: 3 })
    expect(decodeJson(event, { count: 3 })).toEqual({ value: 3 })
  })

  test('selects object union branch when nullable primitive field is present as null', () => {
    const Payload = struct.or(
      struct.object({ kind: struct.literal('date'), at: struct.date().null().alias('created_at') }),
      struct.object({ kind: struct.literal('text'), value: struct.string() }),
    )

    expect(encodeJson(Payload, { kind: 'date', at: null })).toEqual({ kind: 'date', created_at: null })
  })

  test('selects an aliased union branch whose literal discriminator is null', () => {
    const Payload = struct.or(
      struct.object({ kind: struct.literal(null).alias('event_type'), value: struct.string().alias('body') }),
      struct.object({ kind: struct.literal('text').alias('event_type'), value: struct.string() }),
    )

    expect(encodeJson(Payload, { kind: null, value: 'hello' })).toEqual({ event_type: null, body: 'hello' })
  })

  test('does not select a union branch whose required nullable field is missing', () => {
    const Payload = struct.or(
      struct.object({ kind: struct.literal('date').alias('event_type'), at: struct.date().null().alias('created_at') }),
      struct.object({ kind: struct.literal('text').alias('event_type'), value: struct.string() }),
    )

    expect(encodeJson(Payload, { kind: 'date' } as never)).toEqual({ kind: 'date' })
  })

  test('does not select a request union branch with a missing declared section', () => {
    const Payload = struct.or(
      struct.object({ query: struct.object({ page: struct.number().alias('p') }) }),
      struct.object({ kind: struct.literal('fallback').alias('event_type') }),
    )

    expect(encodeJson(Payload, { kind: 'fallback' })).toEqual({ event_type: 'fallback' })
  })

  test('does not select an incomplete discriminated-union branch inside or', () => {
    const Payload = struct.or(
      struct.discriminatedUnion('type', [
        struct.object({ type: struct.literal('message').alias('kind'), payload: struct.string().alias('body') }),
      ]),
      struct.object({ type: struct.literal('message').alias('fallback_kind') }),
    )

    expect(encodeJson(Payload, { type: 'message' } as never)).toEqual({ fallback_kind: 'message' })
  })

  test('selects aliased union branch by runtime date value rather than string wire guard', () => {
    const Payload = struct.or(
      struct.object({ value: struct.date().alias('created_at') }),
      struct.object({ value: struct.string().alias('text') }),
    )

    expect(encodeJson(Payload, { value: new Date('2026-05-12T10:00:00Z') })).toEqual({
      created_at: '2026-05-12T10:00:00.000Z',
    })
  })

  test('selects aliased union branch by runtime bigint value rather than number branch', () => {
    const Payload = struct.or(
      struct.object({ value: struct.bigint().alias('id') }),
      struct.object({ value: struct.number().alias('count') }),
    )

    expect(encodeJson(Payload, { value: 42n })).toEqual({ id: '42' })
  })

  test('selects aliased union branches through collection field types', () => {
    const arrayEvent = struct.or(
      struct.object({ value: struct.array(struct.string()).alias('texts') }),
      struct.object({ value: struct.array(struct.number()).alias('counts') }),
    )
    const recordEvent = struct.or(
      struct.object({ value: struct.record(struct.string()).alias('labels') }),
      struct.object({ value: struct.record(struct.number()).alias('totals') }),
    )
    const tupleEvent = struct.or(
      struct.object({ value: struct.tuple([struct.string()]).alias('label_tuple') }),
      struct.object({ value: struct.tuple([struct.number()]).alias('count_tuple') }),
    )

    expect(encodeJson(arrayEvent, { value: [1, 2] })).toEqual({ counts: [1, 2] })
    expect(decodeJson(arrayEvent, { counts: [1, 2] })).toEqual({ value: [1, 2] })
    expect(encodeJson(recordEvent, { value: { total: 3 } })).toEqual({ totals: { total: 3 } })
    expect(decodeJson(recordEvent, { totals: { total: 3 } })).toEqual({ value: { total: 3 } })
    expect(encodeJson(tupleEvent, { value: [3] })).toEqual({ count_tuple: [3] })
    expect(decodeJson(tupleEvent, { count_tuple: [3] })).toEqual({ value: [3] })
  })

  test('rejects ambiguous aliased union object branches', () => {
    const Payload = struct.or(
      struct.object({ value: struct.string().alias('text') }),
      struct.object({ value: struct.string().alias('label') }),
    )

    expect(() => encodeJson(Payload, { value: 'x' })).toThrow('ambiguous union encode')
  })

  test('rejects ambiguous aliased union array branches', () => {
    const Payload = struct.or(struct.array(struct.string()).alias('texts'), struct.array(struct.string()).alias('labels'))

    expect(() => encodeJson(Payload, [])).toThrow('ambiguous union encode')
  })

  test('decodes aliased discriminated union objects symmetrically', () => {
    const event = struct.discriminatedUnion('type', [
      struct.object({
        payload: struct.string().alias('body'),
        type: struct.literal('message').alias('kind'),
      }),
      struct.object({
        count: struct.number().alias('count'),
        type: struct.literal('count').alias('kind'),
      }),
    ])

    expect(encodeJson(event, { payload: 'hello', type: 'message' })).toEqual({
      body: 'hello',
      kind: 'message',
    })
    expect(encodeJson(event, { count: 3, type: 'count' })).toEqual({
      count: 3,
      kind: 'count',
    })
    expect(decodeJson(event, { body: 'hello', kind: 'message' })).toEqual({
      payload: 'hello',
      type: 'message',
    })
    expect(decodeJson(event, { count: 3, kind: 'count' })).toEqual({
      count: 3,
      type: 'count',
    })
    expect(() => decodeJson(event, { count: 1, kind: 'message' })).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'missing_key', path: ['payload'] })] }),
    )
  })

  test('routes aliased discriminated union by discriminator wire key before normalizing target branch', () => {
    const Message = struct.discriminatedUnion('type', [
      struct.object({ type: struct.literal('text').alias('kind'), body: struct.string().alias('message_body') }),
      struct.object({ type: struct.literal('count').alias('kind'), count: struct.number().alias('total_count') }),
    ])

    expect(decodeJson(Message, { kind: 'count', total_count: 3 })).toEqual({ type: 'count', count: 3 })
  })

  test('routes an unaliased discriminator before decoding aliased branch fields', () => {
    const Message = struct.discriminatedUnion('type', [
      struct.object({ type: struct.literal('text'), body: struct.string().alias('message_body') }),
    ])

    expect(decodeJson(Message, { type: 'text', message_body: 'hello' })).toEqual({ type: 'text', body: 'hello' })
  })

  test('caches recursive discriminator metadata across repeated and derived alias decodes', () => {
    let recursiveReads = 0
    let typeReads = 0
    const message = struct.object({
      body: struct.string().alias('message_body'),
      get replies() {
        recursiveReads += 1
        return struct.array(message).alias('thread')
      },
      get type() {
        typeReads += 1
        if (typeReads > 2) {
          throw new Error('schema discriminator reread')
        }
        return struct.literal('text').alias('kind')
      },
    })
    const Message = struct.discriminatedUnion('type', [message])
    const OptionalMessage = Message.optional()
    const NullishMessage = Message.nullish()
    const input = {
      kind: 'text',
      message_body: 'hello',
      thread: [{ kind: 'text', message_body: 'reply', thread: [] }],
    }
    const expected = {
      body: 'hello',
      replies: [{ body: 'reply', replies: [], type: 'text' }],
      type: 'text',
    }

    expect(decodeJson(Message, input)).toEqual(expected)
    expect(decodeJson(Message, input)).toEqual(expected)
    expect(decodeJson(OptionalMessage, input)).toEqual(expected)
    expect(decodeJson(NullishMessage, input)).toEqual(expected)
    expect(recursiveReads).toBe(1)
    expect(typeReads).toBe(2)
  })

  test('stops after the first aliased discriminator selects a branch', () => {
    const Message = struct.discriminatedUnion('type', [
      struct.object({ type: struct.literal('text').alias('kind'), body: struct.string() }),
      struct.object({ type: struct.literal('count').alias('event_type'), count: struct.number() }),
    ])
    let laterReads = 0
    const input = {
      body: 1,
      kind: 'text',
      get event_type() {
        laterReads += 1
        throw new Error('later discriminator must not be read')
      },
    }

    expect(() => decodeJson(Message, input)).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'invalid_type', path: ['body'] })] }),
    )
    expect(laterReads).toBe(0)
    expect(() => decodeJson(Message, { kind: 'count', count: 1 })).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'invalid_union', path: ['type'] })] }),
    )
  })

  test('decodes aliased intersection right-side objects symmetrically', () => {
    const profile = struct.object({
      name: struct.string().alias('full_name'),
    })
    const intersectionStruct = struct.intersection(struct.unknown(), profile)

    expect(encodeJson(intersectionStruct, { name: 'Miao' })).toEqual({ full_name: 'Miao' })
    expect(decodeJson(intersectionStruct, { full_name: 'Miao' })).toEqual({ name: 'Miao' })
    expect(() => decodeJson(intersectionStruct, {})).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'missing_key', path: ['name'] })] }),
    )
  })

  test('encodes and decodes both aliased intersection object sides', () => {
    const account = struct.object({
      id: struct.string().alias('account_id'),
    })
    const profile = struct.object({
      name: struct.string().alias('full_name'),
    })
    const intersectionStruct = struct.intersection(account, profile)

    expect(encodeJson(intersectionStruct, { id: 'u_1', name: 'Miao' })).toEqual({
      account_id: 'u_1',
      full_name: 'Miao',
    })
    expect(decodeJson(intersectionStruct, { account_id: 'u_1', full_name: 'Miao' })).toEqual({
      id: 'u_1',
      name: 'Miao',
    })
  })

  test('encodes and decodes nested aliased intersection object sides', () => {
    const account = struct.object({
      id: struct.string().alias('account_id'),
    })
    const profile = struct.object({
      name: struct.string().alias('full_name'),
    })
    const audit = struct.object({
      when: struct.date().alias('created_at'),
    })
    const intersectionStruct = struct.intersection(struct.intersection(account, profile), audit)

    expect(encodeJson(intersectionStruct, { id: 'u_1', name: 'Miao', when: new Date('2026-05-12T10:00:00Z') })).toEqual({
      account_id: 'u_1',
      created_at: '2026-05-12T10:00:00.000Z',
      full_name: 'Miao',
    })
    expect(decodeJson(intersectionStruct, { account_id: 'u_1', created_at: '2026-05-12T10:00:00.000Z', full_name: 'Miao' })).toEqual({
      id: 'u_1',
      name: 'Miao',
      when: new Date('2026-05-12T10:00:00Z'),
    })
  })
})

const Profile = struct.object({ name: struct.string().alias('display_name') })

describe('encodeJson nullish objects', () => {
  test('encodes null for a nullable object field and omits an optional one', () => {
    const request = struct.object({
      extra: Profile.optional(),
      profile: Profile.nullable(),
    })

    expect(encodeJson(request, { profile: null })).toEqual({ profile: null })
    expect(encodeJson(request, { extra: undefined, profile: { name: 'N' } })).toEqual({
      profile: { display_name: 'N' },
    })
  })

  test('encodes a nullable object root as null and an optional root as undefined', () => {
    expect(encodeJson(Profile.nullable(), null)).toBeNull()
    expect(encodeJson(Profile.optional(), undefined)).toBeUndefined()
    expect(encodeJson(Profile.nullish(), null)).toBeNull()
    expect(encodeJson(Profile.nullish(), undefined)).toBeUndefined()
    expect(encodeJson(Profile.nullable(), { name: 'N' })).toEqual({ display_name: 'N' })
  })

  test('encodes nullable objects nested in arrays and records', () => {
    const nested = struct.object({
      bag: struct.record(Profile.nullable()),
      rows: struct.array(Profile.nullable()),
    })

    expect(
      encodeJson(nested, {
        bag: { a: null, b: { name: 'M' } },
        rows: [null, { name: 'N' }],
      }),
    ).toEqual({
      bag: { a: null, b: { display_name: 'M' } },
      rows: [null, { display_name: 'N' }],
    })
  })

  test('still rejects null and undefined for an object that does not allow them', () => {
    expect(() => encodeJson(Profile, null)).toThrow('json encode expects object value')
    expect(() => encodeJson(Profile, undefined)).toThrow('json encode expects object value')
  })
})
