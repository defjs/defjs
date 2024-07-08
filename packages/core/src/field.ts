import type { AsyncValidatorFn, ValidatorFn } from './validator'

const FIELD = Symbol('field')

export enum FieldType {
  Json = 1,
  Query,
  Param,
  Header,
  Form,
  Body,
}

export interface FieldMetadata<T = undefined> {
  alias: Map<FieldType, string | undefined>
  validators: ValidatorFn<T>[]
  asyncValidator: AsyncValidatorFn<T>[]
}

export type Field<T = undefined> = (() => T) & {
  withJson(alias?: string): Field<T>
  withForm(alias?: string): Field<T>
  withQuery(alias?: string): Field<T>
  withParam(alias?: string): Field<T>
  withHeader(alias?: string): Field<T>
  withBody(): Field<T>
  withValidators(...fn: ValidatorFn<T>[]): Field<T>
  withAsyncValidators(...fn: AsyncValidatorFn<T>[]): Field<T>
  readonly [FIELD]: FieldMetadata<T>
}

export function field(): Field
export function field<T>(): Field<T | undefined>
export function field<T>(defaultValue: T): Field<T>
export function field<T = undefined>(defaultValue?: T): Field<T> {
  const meta: FieldMetadata<T> = {
    alias: new Map<FieldType, string>(),
    validators: [],
    asyncValidator: [],
  }
  const getter = (() => defaultValue) as Field<T>

  Object.defineProperty(getter, FIELD, {
    value: meta,
  })

  getter.withJson = alias => {
    meta.alias.set(FieldType.Json, alias)
    return getter
  }
  getter.withForm = alias => {
    meta.alias.set(FieldType.Form, alias)
    return getter
  }
  getter.withQuery = alias => {
    meta.alias.set(FieldType.Query, alias)
    return getter
  }
  getter.withParam = alias => {
    meta.alias.set(FieldType.Param, alias)
    return getter
  }
  getter.withHeader = alias => {
    meta.alias.set(FieldType.Header, alias)
    return getter
  }
  getter.withBody = () => {
    meta.alias.set(FieldType.Body, undefined)
    return getter
  }
  getter.withValidators = (...fn) => {
    meta.validators = fn
    return getter
  }
  getter.withAsyncValidators = (...fn) => {
    meta.asyncValidator = fn
    return getter
  }
  return getter
}

type ExtractFieldValue<T> = T extends Field<infer V>
  ? V
  : T extends { [K in keyof T]: Field<any> }
    ? { [K in keyof T]: ExtractFieldValue<T[K]> }
    : never

export function __getFieldMetadata<T>(field: Field<T>): FieldMetadata<ExtractFieldValue<T>> {
  return field[FIELD] as any
}

export function validatorField(validators: ValidatorFn<any>[], value: unknown): void {
  for (const fn of validators) {
    const err = fn(value)
    if (err) {
      throw err
    }
  }
}

export async function asyncValidatorField(asyncValidator: AsyncValidatorFn<any>[], value: unknown): Promise<void> {
  for (const fn of asyncValidator) {
    const err = await fn(value)
    if (err) {
      throw err
    }
  }
}

export function isField(value: unknown): value is Field {
  return !!value && typeof value === 'function' && FIELD in value
}

export function isFieldGroup(value: unknown): value is Record<PropertyKey, Field> {
  return !!value && typeof value === 'object' && Object.entries(value).every(([, v]) => isField(v))
}
