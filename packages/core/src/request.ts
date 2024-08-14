import { type Client, getClientConfig, getGlobalClient, isClient } from './client'
import { type HttpContext, makeHttpContext } from './context'
import { ERR_NOT_FOUND_HANDLER, ERR_NOT_SET_ALIAS, ERR_OBSERVE, ERR_UNSUPPORTED_FIELD_TYPE, HttpErrorResponse } from './error'
import { type Field, FieldType, __getFieldMetadata, isField, isFieldGroup } from './field'
import type { HttpHandler } from './handler'
import { getGlobalHttpHandler } from './handler/handler'
import type { InterceptorFn } from './interceptor'
import { makeInterceptorChain } from './interceptor/interceptor'
import { type HttpResponse, __makeResponse } from './response'
import type { AsyncValidatorFn, ValidatorFn } from './validator'

export type HttpResponseType = 'arraybuffer' | 'blob' | 'json' | 'text'

export interface HttpProgressEvent {
  /**
   * Indicates whether the resources associated with Progress have a computable length.
   * Otherwise, the Progress.total attribute will be a meaningless value.
   */
  readonly lengthComputable: boolean

  /** Indicates the workload of the underlying process. */
  readonly loaded: number

  /**
   * The total size of the data being processed or transmitted.
   * If the Progress.lengthComputable attribute is false, this value is meaningless and should be ignored.
   */
  readonly total: number
}

export type HttpProgressFn = (event: HttpProgressEvent) => void

// No suitable scenario was found.
// export type TransformRequestFn<Input = unknown> = (input: Input, request: HttpRequest) => HttpRequest['body']
export type TransformResponseFn<Output = unknown> = (response: HttpResponse<unknown>) => Output

export interface HttpRequest {
  host?: string

  method: string

  endpoint: string

  body?: Blob | ArrayBuffer | FormData | URLSearchParams | object | string | number | boolean | null

  headers?: Headers

  queryParams?: URLSearchParams

  /** default：json */
  responseType?: HttpResponseType

  context?: HttpContext

  timeout?: number

  withCredentials?: boolean

  /** when use fetch handler, no upload progress */
  uploadProgress?: HttpProgressFn

  downloadProgress?: HttpProgressFn

  /**
   * default：body
   */
  observe?: 'body' | 'response'

  abort?: AbortSignal
}

export function __serializeBody(body: HttpRequest['body']): ArrayBuffer | Blob | FormData | URLSearchParams | string | null {
  switch (true) {
    case body instanceof FormData:
    case body instanceof Blob:
    case body instanceof ArrayBuffer:
    case body instanceof URLSearchParams:
    case typeof body === 'string':
      return body
    case typeof body === 'object':
    case typeof body === 'boolean':
    case typeof body === 'number':
    case Array.isArray(body):
      return JSON.stringify(body)
    default:
      return null
  }
}

export function __detectContentTypeHeader(body: HttpRequest['body']): string | null {
  switch (true) {
    case body instanceof FormData:
      return 'multipart/form-data'
    case body instanceof ArrayBuffer:
      return 'application/octet-stream'
    case body instanceof Blob: {
      return body.type || 'application/octet-stream'
    }
    case body instanceof URLSearchParams: {
      return 'application/x-www-form-urlencoded;charset=UTF-8'
    }
    case typeof body === 'string':
      return 'text/plain'
    case typeof body === 'object' && body !== null:
    case typeof body === 'number':
    case typeof body === 'boolean':
      return 'application/json'
    default:
      return null
  }
}

export type RequestInputValue<T> = T extends Field<infer V>
  ? V
  : T extends { [K in keyof T]: Field<any> }
    ? { [K in keyof T]: RequestInputValue<T[K]> }
    : never

export type DoRequestOptions = {
  abort?: AbortSignal
  handler?: HttpHandler
  client?: Client
  timeout?: number
}

export function __buildFieldDefaultValue<Input>(input?: Input): RequestInputValue<Input> {
  if (isField(input)) {
    return input() as RequestInputValue<Input>
  }

  if (isFieldGroup(input)) {
    const obj: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(input)) {
      obj[key] = field()
    }
    return obj as RequestInputValue<Input>
  }

  return undefined as RequestInputValue<Input>
}

export type ObserveType<Observe, Output> = Observe extends 'body' ? Output : Observe extends 'response' ? HttpResponse<Output> : never

export type UseRequestFn<Input, Output, Observe> = {
  doRequest: Input extends undefined
    ? (options?: DoRequestOptions) => Promise<ObserveType<Observe, Output>>
    : (input: RequestInputValue<Input>, options?: DoRequestOptions) => Promise<ObserveType<Observe, Output>>

  getInitValue: () => Input extends Field<infer V>
    ? V
    : Input extends { [K in keyof Input]: Field<any> }
      ? { [K in keyof Input]: RequestInputValue<Input[K]> }
      : undefined

  setUploadProgress: (fn: HttpProgressFn) => void

  setDownloadProgress: (fn: HttpProgressFn) => void
}

export interface DefineRequest<
  Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined,
  Output = unknown,
  Observe extends 'body' | 'response' = 'body',
> {
  (): UseRequestFn<Input, Output, Observe>

  withField<I extends Field<any> | Record<PropertyKey, Field<any>>>(value: I): DefineRequest<I, Output, Observe>

  withInterceptors(value: InterceptorFn[]): DefineRequest<Input, Output, Observe>

  withContext(value: HttpContext): DefineRequest<Input, Output, Observe>

  withCredentials(value: boolean): DefineRequest<Input, Output, Observe>

  withValidators(
    value: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[],
  ): DefineRequest<Input, Output, Observe>

  withTransformResponse<O>(fn: TransformResponseFn<O>): DefineRequest<Input, O, Observe>

  withObserve(value: 'body'): DefineRequest<Input, Output, 'body'>
  withObserve(value: 'response'): DefineRequest<Input, Output, 'response'>

  withResponseType(value: 'json'): DefineRequest<Input, Output, Observe>
  withResponseType(value: 'text'): DefineRequest<Input, string, Observe>
  withResponseType(value: 'blob'): DefineRequest<Input, Blob, Observe>
  withResponseType(value: 'arraybuffer'): DefineRequest<Input, ArrayBuffer, Observe>
}

export function defineRequest<Output>(method: string, endpoint: string): DefineRequest<undefined, Output> {
  let requiredInput = false
  let field: Field<any> | Record<PropertyKey, Field<any>> | undefined
  let interceptors: InterceptorFn[] = []
  let responseType: HttpResponseType = 'json'
  let context: HttpContext | undefined
  let observe: 'body' | 'response' = 'body'
  let withCredentials = false
  let validators: (ValidatorFn | AsyncValidatorFn)[] = []
  let transformResponse: TransformResponseFn | undefined

  const fn: DefineRequest<any, any, any> = () => {
    let uploadProgress: HttpProgressFn | undefined
    let downloadProgress: HttpProgressFn | undefined
    let abortSignal: AbortSignal

    const getInitValue = () => __buildFieldDefaultValue(field)

    const setUploadProgress = (fn: HttpProgressFn) => {
      uploadProgress = fn
    }

    const setDownloadProgress = (fn: HttpProgressFn) => {
      downloadProgress = fn
    }

    const doRequest = async (...args: unknown[]) => {
      let input: unknown
      let doRequestOptions: DoRequestOptions | undefined

      switch (args.length) {
        case 1: {
          doRequestOptions = args[0] as any
          break
        }
        case 2: {
          input = args[0] as any
          doRequestOptions = args[1] as any
          break
        }
      }

      if (requiredInput && !input) {
        // todo 打印缺失的字段
        throw new Error(`Because the request has input, the first argument must be the input value`)
      }

      if (validators.length > 0) {
        for (const fn of validators) {
          fn(input)
        }
      }

      const timeout = doRequestOptions?.timeout || 0

      if (doRequestOptions?.abort) {
        abortSignal = doRequestOptions.abort
      } else if (timeout > 0) {
        abortSignal = AbortSignal.timeout(timeout)
      }

      const client = isClient(doRequestOptions?.client) ? doRequestOptions.client : getGlobalClient()
      const clientOptions = getClientConfig(client)

      const req: HttpRequest = {
        host: clientOptions?.host,
        method,
        endpoint,
        queryParams: new URLSearchParams(),
        headers: new Headers(),
        body: undefined,
        withCredentials,
        responseType,
        context: context || makeHttpContext(),
        observe,
        uploadProgress,
        downloadProgress,
        timeout,
        abort: abortSignal,
      }

      const handler = doRequestOptions?.handler || clientOptions?.handler || getGlobalHttpHandler()
      if (!handler) {
        throw ERR_NOT_FOUND_HANDLER
      }

      if (requiredInput) {
        await __fillRequestFromField(req, field, input)
      }

      const chain = makeInterceptorChain([...interceptors])
      let res = await chain(req, handler)

      if (typeof transformResponse === 'function') {
        try {
          res = __makeResponse({
            ...res,
            body: transformResponse(res),
          })
        } catch (error) {
          throw new HttpErrorResponse({ error })
        }
      }

      switch (req.observe) {
        case 'body':
          return res.body
        case 'response':
          return res
        default:
          throw ERR_OBSERVE
      }
    }

    return {
      doRequest,
      getInitValue,
      setUploadProgress,
      setDownloadProgress,
    }
  }

  fn.withField = value => {
    field = value
    requiredInput = true
    return fn
  }

  fn.withInterceptors = value => {
    interceptors = value
    return fn
  }

  fn.withContext = value => {
    context = value
    return fn
  }

  fn.withCredentials = value => {
    withCredentials = value
    return fn
  }

  fn.withValidators = value => {
    validators = value
    return fn
  }

  fn.withTransformResponse = value => {
    transformResponse = value
    return fn
  }

  fn.withObserve = value => {
    observe = value
    return fn
  }

  fn.withResponseType = value => {
    responseType = value
    return fn
  }

  return fn
}

export function __fillUrl(endpoint: string, params: Map<string, string>): string {
  return endpoint.replace(/:([^\/]+)/g, (_, p1) => {
    return params.get(p1) ?? 'undefined'
  })
}

export async function __fillRequestFromField(request: HttpRequest, fieldOrFieldGroup: unknown, input: unknown): Promise<void> {
  async function doValid(validators: (ValidatorFn<any> | AsyncValidatorFn<any>)[], value: unknown): Promise<Error | null | undefined> {
    for (const validator of validators) {
      const err = await validator(value)
      if (err) {
        return err
      }
    }

    return undefined
  }

  function inputIsObject(input: unknown): input is Record<PropertyKey, unknown> {
    return typeof input === 'object' && input !== null
  }

  function serializeToString(value: unknown): string {
    switch (true) {
      case Array.isArray(value):
      case typeof value === 'object' && value !== null:
        return JSON.stringify(value)
      case typeof value === 'object' && value === null:
      case typeof value === 'boolean':
      case typeof value === 'number':
      case typeof value === 'string':
        return String(value)
      default:
        throw new Error('Unsupported value type')
    }
  }

  function appendValue<T extends URLSearchParams | Headers | FormData>(sp: T, key: string, value: unknown): T {
    if (Array.isArray(value)) {
      for (const v of value) {
        sp.append(key, serializeToString(v))
      }
    } else {
      sp.set(key, serializeToString(value))
    }
    return sp
  }

  function setValue(sp: Map<string, string>, key: string, value: unknown): Map<string, string> {
    if (Array.isArray(value)) {
      for (const v of value) {
        setValue(sp, key, serializeToString(v))
      }
    }

    sp.set(key, serializeToString(value))
    return sp
  }

  function getValidValue(value: unknown, defaultValue: unknown): unknown {
    switch (true) {
      case typeof value === 'undefined':
        return defaultValue
      case typeof value === 'object' && value === null:
        return value
      default:
        return value
    }
  }

  if (isField(fieldOrFieldGroup)) {
    let params: Map<string, string> | undefined
    let queryParams: URLSearchParams | undefined
    let headers: Headers | undefined
    let body: any = undefined
    const validValue: unknown = getValidValue(input, fieldOrFieldGroup())
    const meta = __getFieldMetadata(fieldOrFieldGroup)

    const err = await doValid([...meta.validators, ...meta.asyncValidator], validValue)
    if (err) {
      throw err
    }

    for (const [type, aliasName] of meta.alias) {
      switch (type) {
        case FieldType.Query: {
          if (!aliasName) {
            throw ERR_NOT_SET_ALIAS
          }
          queryParams = appendValue(new URLSearchParams(), aliasName, validValue)
          break
        }
        case FieldType.Param: {
          if (!aliasName) {
            throw ERR_NOT_SET_ALIAS
          }
          params = setValue(new Map<string, string>(), aliasName, validValue)
          break
        }
        case FieldType.Header: {
          if (!aliasName) {
            throw ERR_NOT_SET_ALIAS
          }
          headers = appendValue(new Headers(), aliasName, validValue)
          break
        }
        case FieldType.Form: {
          if (!aliasName) {
            throw ERR_NOT_SET_ALIAS
          }
          body = appendValue(new FormData(), aliasName, validValue)
          break
        }
        case FieldType.UrlForm: {
          if (!aliasName) {
            throw ERR_NOT_SET_ALIAS
          }
          body = appendValue(new URLSearchParams(), aliasName, validValue)
          break
        }
        case FieldType.Json:
        case FieldType.Body:
          body = validValue
          break
      }
    }

    if (params) {
      request.endpoint = __fillUrl(request.endpoint, params)
    }

    request.queryParams = queryParams
    request.headers = headers
    request.body = body

    return
  }

  if (isFieldGroup(fieldOrFieldGroup) && inputIsObject(input)) {
    let params = new Map<string, string>()
    let queryParams = new URLSearchParams()
    let headers = new Headers()
    let urlForm = new URLSearchParams()
    let formData = new FormData()
    const json = {}
    let body: any = undefined
    let lastBodyField: FieldType.Body | FieldType.UrlForm | FieldType.Json | FieldType.Form | undefined

    for (const [propertyKey, field] of Object.entries(fieldOrFieldGroup)) {
      const meta = __getFieldMetadata(field)

      for (const [type, aliasName] of meta.alias) {
        const valueKey = aliasName || propertyKey
        const value = getValidValue(input[propertyKey], field())
        const err = await doValid([...meta.validators, ...meta.asyncValidator], value)
        if (err) {
          throw err
        }

        switch (type) {
          case FieldType.Json: {
            Object.defineProperty(json, valueKey, {
              value,
              writable: true,
              enumerable: true,
            })
            lastBodyField = FieldType.Json
            break
          }
          case FieldType.Query:
            queryParams = appendValue(queryParams, valueKey, value)
            break
          case FieldType.Param:
            params = setValue(params, valueKey, value)
            break
          case FieldType.Header:
            headers = appendValue(headers, valueKey, value)
            break
          case FieldType.Form: {
            formData = appendValue(formData, valueKey, value)
            lastBodyField = FieldType.Form
            break
          }
          case FieldType.UrlForm: {
            urlForm = appendValue(urlForm, valueKey, value)
            lastBodyField = FieldType.UrlForm
            break
          }
          case FieldType.Body: {
            body = value
            lastBodyField = FieldType.Body
            break
          }
        }
      }
    }

    request.endpoint = __fillUrl(request.endpoint, params)
    request.queryParams = queryParams
    request.headers = headers

    switch (lastBodyField) {
      case FieldType.Body:
        request.body = body
        break
      case FieldType.Form:
        request.body = formData
        break
      case FieldType.UrlForm:
        request.body = urlForm
        break
      case FieldType.Json:
        request.body = json
        break
    }

    return
  }

  throw ERR_UNSUPPORTED_FIELD_TYPE
}
