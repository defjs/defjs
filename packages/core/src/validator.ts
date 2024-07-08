export type ValidatorFn<T = unknown> = (value: T) => Error | null | undefined
export type AsyncValidatorFn<T = unknown> = (value: T) => Promise<Error | null | undefined>

export const required: ValidatorFn = value => {
  if (!value) {
    return new Error('required')
  }
  return null
}

export const requiredTrue: ValidatorFn = value => {
  if (typeof value !== 'boolean' || !value) {
    return new Error('requiredTrue')
  }
  return null
}

export const minLength = (min: number) => {
  return ((value: unknown) => {
    if (typeof value !== 'string') {
      return new Error('invalid string')
    }
    if (value.length < min) {
      return new Error(`minLength ${min}`)
    }
    return null
  }) as ValidatorFn
}

export const maxLength = (max: number) => {
  return ((value: unknown) => {
    if (typeof value !== 'string') {
      return new Error('invalid string')
    }
    if (value.length > max) {
      return new Error(`maxLength ${max}`)
    }
    return null
  }) as ValidatorFn
}

export const min = (min: number) => {
  return ((value: unknown) => {
    if (typeof value !== 'number' || isNaN(value)) {
      return new Error('invalid number')
    }
    if (value < min) {
      return new Error(`minLength ${min}`)
    }
    return null
  }) as ValidatorFn
}

export const max = (max: number) => {
  return ((value: unknown) => {
    if (typeof value !== 'number' || isNaN(value)) {
      return new Error('invalid number')
    }
    if (value > max) {
      return new Error(`maxLength ${max}`)
    }
    return null
  }) as ValidatorFn
}

export const pattern = (pattern: string | RegExp) => {
  return ((value: unknown) => {
    if (typeof value !== 'string') {
      return new Error('invalid string')
    }
    if (typeof pattern === 'string') {
      pattern = new RegExp(pattern)
    }
    if (!pattern.test(value)) {
      return new Error('pattern')
    }
    return null
  }) as ValidatorFn
}
