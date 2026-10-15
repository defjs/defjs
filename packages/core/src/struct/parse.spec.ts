import { describe, expect, test } from 'vitest'
import { decodeJson } from './codec/json'
import { StructError, struct } from './index'
import { parseStructTuple as parse } from './introspection'

describe('parse.ts object and composite values', () => {
  test('requires ordinary object fields and omits optional keys', () => {
    const profile = struct.object({
      id: struct.string(),
      nickname: struct.string().optional(),
      score: struct.number(),
      active: struct.boolean(),
    })

    const [err1, val1] = parse(profile, { id: 'u_1' })
    expect(err1).toBeInstanceOf(StructError)
    expect(err1?.issues).toHaveLength(1)
    expect(err1?.issues[0]?.code).toBe('missing_key')
    expect(err1?.issues[0]?.path).toEqual(['score'])
    expect(val1).toBeUndefined()

    const [err2, val2] = parse(profile, { active: true, id: 'u_1', nickname: undefined, score: 7 })
    if (err2) {
      throw err2
    }
    expect(val2).toEqual({
      active: true,
      id: 'u_1',
      score: 7,
    })
  })

  test('applies the strict object modifier matrix', () => {
    const shape = struct.object({
      name: struct.string(),
      age: struct.number(),
      active: struct.boolean(),
      note: struct.string().optional(),
      nickname: struct.string().null(),
      bio: struct.string().nullish(),
      empty: struct.null(),
      tags: struct.array(struct.string()),
    })

    const valid = {
      active: true,
      age: 20,
      empty: null,
      name: 'Miao',
      nickname: null,
      tags: ['core'],
    }
    const [error, value] = parse(shape, valid)

    if (error) {
      throw error
    }
    expect(value).toEqual({
      active: true,
      age: 20,
      empty: null,
      name: 'Miao',
      nickname: null,
      tags: ['core'],
    })
    expect(Object.hasOwn(value, 'note')).toBe(false)
    expect(Object.hasOwn(value, 'bio')).toBe(false)

    const [missingNullable, missingValue] = parse(shape, { ...valid, nickname: undefined })
    expect(missingNullable).toBeInstanceOf(StructError)
    expect(missingNullable?.issues[0]?.code).toBe('missing_key')
    expect(missingNullable?.issues[0]?.path).toEqual(['nickname'])
    expect(missingValue).toBeUndefined()
  })

  test('applies the strict top-level modifier matrix', () => {
    const [missingError, missingValue] = parse(struct.string(), undefined)
    expect(missingError).toBeInstanceOf(StructError)
    expect(missingValue).toBeUndefined()

    expect(parse(struct.string().optional(), undefined)).toEqual([null, undefined])

    const [nullableMissingError, nullableMissingValue] = parse(struct.string().null(), undefined)
    expect(nullableMissingError).toBeInstanceOf(StructError)
    expect(nullableMissingValue).toBeUndefined()

    expect(parse(struct.string().nullish(), undefined)).toEqual([null, undefined])

    const [nullError, nullValue] = parse(struct.string(), null)
    expect(nullError).toBeInstanceOf(StructError)
    expect(nullValue).toBeUndefined()

    const [optionalNullError, optionalNullValue] = parse(struct.string().optional(), null)
    expect(optionalNullError).toBeInstanceOf(StructError)
    expect(optionalNullValue).toBeUndefined()

    expect(parse(struct.string().null(), null)).toEqual([null, null])
    expect(parse(struct.string().nullable(), null)).toEqual([null, null])
    expect(parse(struct.string().nullish(), null)).toEqual([null, null])

    const [numberErr, numberValue] = parse(struct.bigint(), 42)
    expect(numberErr).toBeInstanceOf(StructError)
    expect(numberValue).toBeUndefined()
  })

  test('parse reads logical keys by default and wire aliases when aliases is true', () => {
    const User = struct.object({
      displayName: struct.string().alias('display_name'),
    })

    expect(parse(User, { displayName: 'Ada' })).toEqual([null, { displayName: 'Ada' }])
    expect(parse(User, { display_name: 'Ada' })[0]).toBeInstanceOf(StructError)
    expect(parse(User, { display_name: 'Ada' }, { aliases: true })).toEqual([null, { displayName: 'Ada' }])
  })

  test('accepts null when literal and composite declarations explicitly allow it', () => {
    expect(parse(struct.literal(null), null)).toEqual([null, null])
    expect(parse(struct.or(struct.null(), struct.string()), null)).toEqual([null, null])
    expect(parse(struct.intersection(struct.null(), struct.null()), null)).toEqual([null, null])
    expect(parse(struct.intersection(struct.unknown(), struct.string()), 'x')).toEqual([null, 'x'])

    const Body = struct.object({ body: struct.null() })
    expect(parse(Body, { body: null })).toEqual([null, { body: null }])
  })

  test('does not inspect later union options or the right intersection after an earlier result', () => {
    let unionLaterReads = 0
    const unionInput = {
      kind: 'first' as const,
      get later() {
        unionLaterReads += 1
        throw new Error('later union option was read')
      },
    }
    const Union = struct.or(struct.object({ kind: struct.literal('first') }), struct.object({ later: struct.string() }))
    expect(parse(Union, unionInput)).toEqual([null, { kind: 'first' }])
    expect(unionLaterReads).toBe(0)

    let intersectionRightReads = 0
    const intersectionInput = {
      first: 1,
      get later() {
        intersectionRightReads += 1
        throw new Error('right intersection was read')
      },
    }
    const Intersection = struct.intersection(struct.object({ first: struct.string() }), struct.object({ later: struct.string() }))
    const [intersectionError, intersectionValue] = parse(Intersection, intersectionInput)
    expect(intersectionError).toBeInstanceOf(StructError)
    expect(intersectionError?.issues[0]?.path).toEqual(['first'])
    expect(intersectionValue).toBeUndefined()
    expect(intersectionRightReads).toBe(0)

    let intersectionThirdReads = 0
    const threeWayInput = {
      first: 1,
      get later() {
        throw new Error('later intersection was read')
      },
      get third() {
        intersectionThirdReads += 1
        throw new Error('third intersection was read')
      },
    }
    const ThreeWay = struct.intersection(
      struct.object({ first: struct.string() }),
      struct.object({ later: struct.string() }),
      struct.object({ third: struct.string() }),
    )
    const [threeWayError] = parse(ThreeWay, threeWayInput)
    expect(threeWayError).toBeInstanceOf(StructError)
    expect(threeWayError?.issues[0]?.path).toEqual(['first'])
    expect(intersectionThirdReads).toBe(0)
  })

  test('maps tagged json input key without changing output key', () => {
    const queryStruct = struct.object({
      pageSize: struct.number().alias('page_size'),
      page: struct.number(),
    })

    const val = decodeJson(queryStruct, { page: 1, page_size: 50 })
    expect(val).toEqual({
      page: 1,
      pageSize: 50,
    })
  })

  test('passes through any and unknown values', () => {
    const uploadStruct = struct.object({
      metadata: struct.any(),
      raw: struct.unknown(),
    })

    const raw = 'raw body'
    const metadata = ['skip', 'validation']

    const [err1, val1] = parse(uploadStruct, { metadata, raw })
    if (err1) {
      throw err1
    }
    expect(val1).toEqual({ metadata, raw })
  })

  test('parses literal, enum and union values', () => {
    const status = struct.enum(['draft', 'published'] as const)
    const channel = struct.enum({ Web: 'web', Mobile: 'mobile', Retry: 3 } as const)
    const id = struct.or(struct.string(), struct.number())

    const [s1err, s1val] = parse(status, undefined)
    expect(s1err).toBeInstanceOf(StructError)
    expect(s1val).toBeUndefined()
    const [c1err, c1val] = parse(channel, undefined)
    expect(c1err).toBeInstanceOf(StructError)
    expect(c1val).toBeUndefined()
    const [i1err, i1val] = parse(id, 'u_123')
    if (i1err) {
      throw i1err
    }
    expect(i1val).toBe('u_123')
    const [i2err, i2val] = parse(id, 9)
    if (i2err) {
      throw i2err
    }
    expect(i2val).toBe(9)
    const [l1err, l1val] = parse(struct.literal('ok'), undefined)
    expect(l1err).toBeInstanceOf(StructError)
    expect(l1val).toBeUndefined()
    const [se] = parse(status, 'archived')
    expect(se).toBeInstanceOf(StructError)
    const [ce] = parse(channel, false)
    expect(ce).toBeInstanceOf(StructError)
    const [le] = parse(struct.literal('ok'), 'no')
    expect(le).toBeInstanceOf(StructError)
    const [ie] = parse(id, false)
    expect(ie).toBeInstanceOf(StructError)
  })

  test('supports tuple and record structures for request payloads', () => {
    const coordinate = struct.tuple([struct.number(), struct.number()])
    const headers = struct.record(struct.string())

    const [c1err, c1val] = parse(coordinate, [120, 30])
    if (c1err) {
      throw c1err
    }
    expect(c1val).toEqual([120, 30])
    const [c2err, c2val] = parse(coordinate, [120, 31])
    if (c2err) {
      throw c2err
    }
    expect(c2val).toEqual([120, 31])
    const [h1err, h1val] = parse(headers, { 'x-trace-id': 'trace-1' })
    if (h1err) {
      throw h1err
    }
    expect(h1val).toEqual({ 'x-trace-id': 'trace-1' })
    const [h2err, h2val] = parse(headers, {})
    if (h2err) {
      throw h2err
    }
    expect(h2val).toEqual({})
    const [ce1] = parse(coordinate, 'bad')
    expect(ce1).toBeInstanceOf(StructError)
    const [ce2] = parse(coordinate, [120, 'bad'])
    expect(ce2).toBeInstanceOf(StructError)
    const [ce3] = parse(coordinate, [120])
    expect(ce3).toBeInstanceOf(StructError)
    expect(ce3?.issues[0]?.code).toBe('invalid_type')
    const [ce4] = parse(coordinate, [120, 30, 10])
    expect(ce4).toBeInstanceOf(StructError)
    expect(ce4?.issues[0]?.code).toBe('invalid_type')
    const [he1] = parse(headers, { retry: 1 })
    expect(he1).toBeInstanceOf(StructError)
    const [he2] = parse(headers, [])
    expect(he2).toBeInstanceOf(StructError)
  })

  test('supports blob file and arrayBuffer payloads', () => {
    const body = struct.arrayBuffer()
    const cover = struct.blob()
    const attachment = struct.file()

    const pdf = new Blob(['pdf'], { type: 'application/pdf' })
    const avatar = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    const bytes = new ArrayBuffer(4)

    const [be1, bv1] = parse(body, bytes)
    if (be1) {
      throw be1
    }
    expect(bv1).toBe(bytes)
    const [ce1, cv1] = parse(cover, pdf)
    if (ce1) {
      throw ce1
    }
    expect(cv1).toBe(pdf)
    const [ae1, av1] = parse(attachment, avatar)
    if (ae1) {
      throw ae1
    }
    expect(av1).toBe(avatar)
    const [be2, bv2] = parse(body, undefined)
    expect(be2).toBeInstanceOf(StructError)
    expect(bv2).toBeUndefined()
    const [ce2, cv2] = parse(cover, undefined)
    expect(ce2).toBeInstanceOf(StructError)
    expect(cv2).toBeUndefined()
    const [ae2, av2] = parse(attachment, undefined)
    expect(ae2).toBeInstanceOf(StructError)
    expect(av2).toBeUndefined()
    const [be3] = parse(body, {})
    expect(be3).toBeInstanceOf(StructError)
    const [ce3] = parse(cover, 'bad')
    expect(ce3).toBeInstanceOf(StructError)
    const [ae3] = parse(attachment, pdf)
    expect(ae3).toBeInstanceOf(StructError)
  })

  test('treats null-prototype objects as plain objects', () => {
    const input = Object.assign(Object.create(null), {
      'x-request-id': 'trace-2',
    }) as unknown as { [key: string]: string }

    const [err, val] = parse(struct.record(struct.string()), input)
    if (err) {
      throw err
    }
    expect(val).toEqual({
      'x-request-id': 'trace-2',
    })
  })

  test('keeps object field output in declaration order', () => {
    const Input = struct.object({
      body: struct.object({ name: struct.string() }),
      headers: struct.object({ trace: struct.string() }),
      path: struct.object({ id: struct.string() }),
      query: struct.object({ page: struct.number().optional() }),
    })

    const [error, value] = parse(Input, {
      body: { name: 'Miao' },
      headers: { trace: 'trace-1' },
      path: { id: 'u_1' },
      query: {},
    })

    if (error) {
      throw error
    }
    expect(Object.keys(value)).toEqual(['body', 'headers', 'path', 'query'])

    const [omittedError, omittedValue] = parse(Input, {
      body: { name: 'Miao' },
      headers: { trace: 'trace-1' },
      path: { id: 'u_1' },
    })
    expect(omittedError).toBeInstanceOf(StructError)
    expect(omittedError?.issues[0]?.path).toEqual(['query'])
    expect(omittedValue).toBeUndefined()

    const RequiredQuery = struct.object({ query: struct.object({ page: struct.number() }) })
    const [missingError, missingValue] = parse(RequiredQuery, {})
    expect(missingError).toBeInstanceOf(StructError)
    expect(missingError?.issues[0]?.code).toBe('missing_key')
    expect(missingError?.issues[0]?.path).toEqual(['query'])
    expect(missingValue).toBeUndefined()

    const OptionalBodyFields = struct.object({ body: struct.object({ note: struct.string().optional() }) })
    const [missingBodyError, missingBodyValue] = parse(OptionalBodyFields, {})
    expect(missingBodyError).toBeInstanceOf(StructError)
    expect(missingBodyError?.issues[0]?.path).toEqual(['body'])
    expect(missingBodyValue).toBeUndefined()
  })

  test('stops object, array, and record parsing at the first issue', () => {
    const objectInput = {
      first: 1,
      get second(): string {
        throw new Error('object parser continued')
      },
    }
    const [objectError] = parse(struct.object({ first: struct.string(), second: struct.string() }), objectInput)
    expect(objectError?.issues).toHaveLength(1)
    expect(objectError?.issues[0]?.path).toEqual(['first'])

    const arrayInput = [1, 'unused']
    Object.defineProperty(arrayInput, 1, {
      enumerable: true,
      get() {
        throw new Error('array parser continued')
      },
    })
    const [arrayError] = parse(struct.array(struct.string()), arrayInput)
    expect(arrayError?.issues).toHaveLength(1)
    expect(arrayError?.issues[0]?.path).toEqual([0])

    const recordInput = {
      first: 1,
      get second(): string {
        throw new Error('record parser continued')
      },
    }
    const [recordError] = parse(struct.record(struct.string()), recordInput)
    expect(recordError?.issues).toHaveLength(1)
    expect(recordError?.issues[0]?.path).toEqual(['first'])
  })

  test('drops unknown keys as the only object parse policy', () => {
    const base = struct.object({
      id: struct.string(),
    })

    const [err, val] = parse(base, { id: 'u_1', extra: 'ignored' })
    if (err) {
      throw err
    }
    expect(val).toEqual({ id: 'u_1' })
  })
})
