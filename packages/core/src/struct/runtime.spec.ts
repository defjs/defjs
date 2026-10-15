import { describe, expect, test } from 'vitest'
import { isStruct } from './guards'
import { StructError, struct } from './index'
import { getStructFields, parseStructTuple as parse } from './introspection'
import { resolveObjectShape } from './shape'
import { DEFINITION } from './symbols'
import type { RuntimeStruct } from './types'

describe('runtime.ts chain methods', () => {
  test('nullable stays required while optional and nullish may be omitted', () => {
    const testStruct = struct.object({
      a: struct.string().optional(),
      b: struct.string().null(),
      c: struct.string().nullish(),
    })

    const [missingError, missingValue] = parse(testStruct, {})
    expect(missingError).toBeInstanceOf(StructError)
    expect(missingError?.issues[0]?.code).toBe('missing_key')
    expect(missingError?.issues[0]?.path).toEqual(['b'])
    expect(missingValue).toBeUndefined()

    const [err, val] = parse(testStruct, { b: null })
    if (err) {
      throw err
    }
    expect(val).toEqual({ b: null })
  })

  test('alias stores wire names without changing parse output', () => {
    const user = struct.object({
      name: struct.string().alias('full_name'),
    })

    const [err, val] = parse(user, { name: 'Miao' })
    if (err) {
      throw err
    }
    expect(val).toEqual({ name: 'Miao' })
  })

  test('alias requires a string name', () => {
    expect(() => struct.string().alias(null as never)).toThrow('alias() requires a string name')
  })

  test('removed tag method is absent from struct runtime surface', () => {
    expect('tag' in struct.string()).toBe(false)
  })

  test('introspection exposes aliases instead of tags', () => {
    const user = struct.object({
      name: struct.string().alias('user_name'),
      nickname: struct.string(),
    })

    expect(getStructFields(user).map((field) => ({ alias: field.alias, key: field.key }))).toEqual([
      { alias: 'user_name', key: 'name' },
      { alias: undefined, key: 'nickname' },
    ])
  })

  test('getStructFields exposes a readonly public field view', () => {
    const fields = getStructFields(
      struct.object({
        name: struct.string().alias('user_name'),
      }),
    )

    expect(Object.isFrozen(fields)).toBe(true)
    expect(Object.isFrozen(fields[0])).toBe(true)
  })

  test('shares lazy object shape and fields cache across pre-created struct derivations', () => {
    let reads = 0
    const User = struct.object({
      get name() {
        reads += 1
        return struct.string()
      },
    })
    const Alias = User.alias('user')
    const Optional = User.optional()
    const Nullish = User.nullish()
    const baseRuntime = User as unknown as RuntimeStruct
    const aliasRuntime = Alias as unknown as RuntimeStruct
    const optionalRuntime = Optional as unknown as RuntimeStruct
    const nullishRuntime = Nullish as unknown as RuntimeStruct
    const baseDefinition = baseRuntime[DEFINITION]
    const aliasDefinition = aliasRuntime[DEFINITION]
    const optionalDefinition = optionalRuntime[DEFINITION]
    const nullishDefinition = nullishRuntime[DEFINITION]

    if (
      baseDefinition.kind !== 'object' ||
      aliasDefinition.kind !== 'object' ||
      optionalDefinition.kind !== 'object' ||
      nullishDefinition.kind !== 'object'
    ) {
      throw new Error('expected object definition')
    }

    expect(aliasDefinition.cache).toBe(baseDefinition.cache)
    expect(optionalDefinition.cache).toBe(baseDefinition.cache)
    expect(nullishDefinition.cache).toBe(baseDefinition.cache)

    getStructFields(Alias)
    const cachedFields = baseDefinition.cache.fields

    getStructFields(Optional)
    getStructFields(User)
    getStructFields(Nullish)

    expect(reads).toBe(1)
    expect(cachedFields).toBeDefined()
    expect(optionalDefinition.cache.fields).toBe(cachedFields)
    expect(aliasDefinition.cache.fields).toBe(cachedFields)
    expect(nullishDefinition.cache.fields).toBe(cachedFields)
  })

  test('rejects duplicate wire keys in the same object shape', () => {
    const User = struct.object({
      name: struct.string(),
      displayName: struct.string().alias('name'),
    })

    expect(() => getStructFields(User)).toThrow('duplicate wire key "name"')
  })

  test('rejects duplicate aliases in the same object shape', () => {
    const User = struct.object({
      firstName: struct.string().alias('name'),
      displayName: struct.string().alias('name'),
    })

    expect(() => getStructFields(User)).toThrow('duplicate wire key "name"')
  })

  test('rejects duplicate empty wire keys', () => {
    const User = struct.object({
      firstName: struct.string().alias(''),
      secondName: struct.string().alias(''),
    })

    expect(() => getStructFields(User)).toThrow('duplicate wire key ""')
  })

  test('keeps duplicate wire key failures stable across repeated field resolution', () => {
    const User = struct.object({
      firstName: struct.string().alias('name'),
      displayName: struct.string().alias('name'),
    })
    const runtime = User as unknown as RuntimeStruct
    const definition = runtime[DEFINITION]

    if (definition.kind !== 'object') {
      throw new Error('expected object definition')
    }

    const shape = resolveObjectShape(runtime, definition)
    expect(resolveObjectShape(runtime, definition)).toBe(shape)
    expect(() => getStructFields(User)).toThrow('duplicate wire key "name"')
    expect(() => getStructFields(User)).toThrow('duplicate wire key "name"')
  })

  test('does not accept inherited struct definition brand', () => {
    const base = struct.string() as object
    const fake = Object.create(base)

    expect(isStruct(fake)).toBe(false)
  })

  test('does not accept malformed struct definition brand', () => {
    const fake = { [DEFINITION]: { kind: 'object' } }

    expect(isStruct(fake)).toBe(false)
  })

  test('invalid primitive parse returns StructError and undefined', () => {
    const [err, val] = parse(struct.string(), 42)

    expect(err).toBeInstanceOf(StructError)
    expect(val).toBeUndefined()
  })

  test('runtime structs do not carry an own _struct property', () => {
    const value = struct.string()

    expect(Object.hasOwn(value, '_struct')).toBe(false)
    expect('_struct' in value).toBe(false)
    expect(isStruct(value)).toBe(true)
    expect(Object.getOwnPropertySymbols(value)).toEqual([DEFINITION])
  })
})
