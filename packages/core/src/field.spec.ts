import { describe, expect, test } from 'bun:test'
import { FieldType, asyncValidatorField, field, getFieldMetadata, isField, isFieldGroup, validatorField } from './field'

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
		const meta = getFieldMetadata(id)
		expect(meta.alias.has(FieldType.Json)).toBeTrue()
	})

	test('should field with query', () => {
		const id = field(1).withQuery('id')
		const meta = getFieldMetadata(id)
		expect(meta.alias.has(FieldType.Query)).toBeTrue()
	})

	test('should field with param', () => {
		const id = field(1).withParam('id')
		const meta = getFieldMetadata(id)
		expect(meta.alias.has(FieldType.Param)).toBeTrue()
	})

	test('should field with form', () => {
		const id = field(1).withForm('id')
		const meta = getFieldMetadata(id)
		expect(meta.alias.has(FieldType.Form)).toBeTrue()
	})

	test('should field with header', () => {
		const id = field(1).withHeader('id')
		const meta = getFieldMetadata(id)
		expect(meta.alias.has(FieldType.Header)).toBeTrue()
	})

	test('should field with body', () => {
		const id = field(1).withBody()
		const meta = getFieldMetadata(id)
		expect(meta.alias.has(FieldType.Body)).toBeTrue()
	})

	test("should isField function it's work", () => {
		expect(isField(field())).toBeTrue()
		expect(isField({})).toBeFalse()
	})

	test("should isFieldGroup function it's work", () => {
		expect(
			isFieldGroup({
				id: field(),
				name: field(),
			}),
		).toBeTrue()
		expect(isFieldGroup({})).toBeTrue()
		expect(
			isFieldGroup({
				id: 1,
				name: field(),
			}),
		).toBeFalse()
	})

	test('should validatorField is working', () => {
		const idField = field(0).withValidators(value => {
			const valid = typeof value === 'number' && !isNaN(value)
			if (!valid) {
				return new Error('invalid number')
			}
			return value < 10 ? new Error('min 10') : null
		})
		const meta = getFieldMetadata(idField)
		expect(() => validatorField(meta.validators, 1)).toThrowError(Error)
		expect(() => validatorField(meta.validators, 10)).toBeEmpty()
	})

	test('should asyncValidatorField is working', async () => {
		const idField = field(0).withAsyncValidators(async value => {
			const valid = typeof value === 'number' && !isNaN(value)
			if (!valid) {
				return new Error('invalid number')
			}
			return value < 10 ? new Error('min 10') : null
		})
		const meta = getFieldMetadata(idField)
		await expect(asyncValidatorField(meta.asyncValidator, 1)).rejects.toThrowError(Error)
		await expect(asyncValidatorField(meta.asyncValidator, 10)).resolves.toBeEmpty()
	})
})
