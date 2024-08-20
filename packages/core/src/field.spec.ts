import { FieldType, __getFieldMetadata, doValid, field, isField, isFieldGroup } from '@src/field'
import { describe, expect, test } from 'vitest'

describe('test field', () => {
  test('should create field with default value', () => {
    expect(field(1)()).toBe(1)
  })

  test('should create field without default value', () => {
    expect(field()()).toBeUndefined()
  })

  test('should create field with type tag', () => {
    expect(field<string>()()).toBeUndefined()
  })

  test('should field with json', () => {
    const id = field(1).withJson('id')
    const meta = __getFieldMetadata(id)
    expect(meta.alias.has(FieldType.Json)).toBeTruthy()
  })

  test('should field with query', () => {
    const id = field(1).withQuery('id')
    const meta = __getFieldMetadata(id)
    expect(meta.alias.has(FieldType.Query)).toBeTruthy()
  })

  test('should field with param', () => {
    const id = field(1).withParam('id')
    const meta = __getFieldMetadata(id)
    expect(meta.alias.has(FieldType.Param)).toBeTruthy()
  })

  test('should field with form', () => {
    const id = field(1).withForm('id')
    const meta = __getFieldMetadata(id)
    expect(meta.alias.has(FieldType.Form)).toBeTruthy()
  })

  test('should field with header', () => {
    const id = field(1).withHeader('id')
    const meta = __getFieldMetadata(id)
    expect(meta.alias.has(FieldType.Header)).toBeTruthy()
  })

  test('should field with url form', () => {
    const id = field(1).withUrlForm('id')
    const meta = __getFieldMetadata(id)
    expect(meta.alias.has(FieldType.UrlForm)).toBeTruthy()
  })

  test('should field with body', () => {
    const id = field(1).withBody()
    const meta = __getFieldMetadata(id)
    expect(meta.alias.has(FieldType.Body)).toBeTruthy()
  })

  test('should field with validators', async () => {
    const err = new Error('value must be less than 10')
    const id = field(1).withValidators(value => {
      if (value > 10) {
        throw err
      }
    })

    const idMeta = __getFieldMetadata(id)
    await expect(doValid(idMeta.validators, 1)).resolves.not.toThrowError(err)
    await expect(doValid(idMeta.validators, 20)).rejects.toThrowError(err)

    const name = field('').withAsyncValidators(async value => {
      if (value.length > 10) {
        throw err
      }
    })
    const nameMeta = __getFieldMetadata(name)
    await expect(doValid(nameMeta.asyncValidator, 'Hello')).resolves.not.toThrowError(err)
    await expect(doValid(nameMeta.asyncValidator, 'Hello World!')).rejects.toThrowError(err)
  })

  test("should isField function it's work", () => {
    expect(isField(field())).toBeTruthy()
    expect(isField({})).toBeFalsy()
  })

  test("should isFieldGroup function it's work", () => {
    expect(
      isFieldGroup({
        id: field(),
        name: field(),
      }),
    ).toBeTruthy()
    expect(isFieldGroup({})).toBeTruthy()
    expect(
      isFieldGroup({
        id: 1,
        name: field(),
      }),
    ).toBeFalsy()
  })
})
