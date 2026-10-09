export type RequestScalarValue = bigint | boolean | null | number | string

export type RequestBuildValue = readonly unknown[] | { [key: string]: unknown } | string | number | boolean | null | undefined

export type RequestFormDataScalar = boolean | null | number | string | undefined
export type RequestFormDataFileLike = Blob | File
export type RequestFormDataValue =
  | RequestFormDataScalar
  | RequestFormDataFileLike
  | readonly RequestFormDataScalar[]
  | readonly RequestFormDataFileLike[]

export interface RequestBodyOptions {
  readonly contentType?: string | null
}

export function isRequestScalarValue(value: unknown): value is RequestScalarValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value === null
}

export function serializeRequestScalarValue(value: RequestScalarValue): string {
  return String(value)
}
