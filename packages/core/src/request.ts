import { type ClientOptions, getClientConfig } from './client'
import { HttpContext } from './context'
import { type Field, FieldType, getFieldMetadata, isField, isFieldGroup } from './field'
import type { HttpHandler } from './handler'
import { getGlobalHttpHandler } from './handler/handler'
import type { InterceptorFn } from './interceptor'
import { makeInterceptorChain } from './interceptor/interceptor'
import type { HttpResponse } from './response'
import type { AsyncValidatorFn, ValidatorFn } from './validator'

export type HttpResponseType = 'arraybuffer' | 'blob' | 'json' | 'text'

export interface HttpProgressEvent {
	/** 表示 Progress 所关联的资源是否具有可以计算的长度。否则，Progress.total 属性将是一个无意义的值 */
	readonly lengthComputable: boolean
	/** 表示底层的进程已经执行的工作量 */
	readonly loaded: number
	/** 正在处理或者传输的数据的总大小. 如果 Progress.lengthComputable 属性是 false，这个值是没有意义的并且应该被忽略 */
	readonly total: number
}

export type HttpProgressFn = (value: HttpProgressEvent) => void

export type TransformRequestFn = (request: HttpRequest) => HttpRequest['body']
export type TransformResponseFn<Output = unknown> = (response: HttpResponse<unknown>) => Output

export interface HttpRequest {
	host?: string

	method: string

	endpoint: string

	body?: Blob | ArrayBuffer | FormData | object | string | number | boolean | null

	headers: Headers

	queryParams: URLSearchParams

	/** 默认：json */
	responseType: HttpResponseType

	context: HttpContext

	timeout: number

	withCredentials?: boolean

	/** when use fetch handler, no upload progress */
	uploadProgress?: HttpProgressFn

	downloadProgress?: HttpProgressFn

	/** 默认：body */
	observe: 'body' | 'stream' | 'response'

	abort: AbortSignal
}

export function serializeBody(body: HttpRequest['body']): ArrayBuffer | Blob | FormData | string | null {
	switch (true) {
		case body instanceof FormData:
		case body instanceof Blob:
		case body instanceof ArrayBuffer:
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

export function detectContentTypeHeader(body: HttpRequest['body']): string | null {
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

type RequestInputValue<T> = T extends Field<infer V>
	? V
	: T extends { [K in keyof T]: Field<any> }
		? { [K in keyof T]: RequestInputValue<T[K]> }
		: never

export type RequestOptions<Output = unknown, Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined> = {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType?: HttpResponseType
	context?: HttpContext
	observe?: 'body' | 'response'
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn<Output>
}

const REQUEST_REF = Symbol('RequestRef')

// @ts-ignore
export type RequestRef<_Output = undefined, _Input = undefined> = {
	readonly [REQUEST_REF]: RequestOptions
}

export type MakeRequestFn<Output = undefined, Input = undefined> = () => RequestRef<Output, Input>

/** Observe: Body */

export function defineRequest<
	Output = unknown,
	Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined,
>(options: {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType?: 'json'
	observe?: 'body'
	context?: HttpContext
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn<Output>
}): MakeRequestFn<Output, Input>

export function defineRequest<Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined>(options: {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType: 'text'
	observe?: 'body'
	context?: HttpContext
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn
}): MakeRequestFn<string, Input>

export function defineRequest<Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined>(options: {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType: 'blob'
	observe?: 'body'
	context?: HttpContext
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn
}): MakeRequestFn<Blob, Input>

export function defineRequest<Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined>(options: {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType: 'arraybuffer'
	observe?: 'body'
	context?: HttpContext
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn
}): MakeRequestFn<ArrayBuffer, Input>

/** Observe: Response */

export function defineRequest<
	Output = unknown,
	Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined,
>(options: {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType?: 'json'
	observe: 'response'
	context?: HttpContext
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn<Output>
}): MakeRequestFn<HttpResponse<Output>, Input>

export function defineRequest<Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined>(options: {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType?: 'text'
	observe: 'response'
	context?: HttpContext
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn
}): MakeRequestFn<HttpResponse<string>, Input>

export function defineRequest<Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined>(options: {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType: 'blob'
	observe: 'response'
	context?: HttpContext
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn
}): MakeRequestFn<HttpResponse<Blob>, Input>

export function defineRequest<Input extends Field<any> | Record<PropertyKey, Field<any>> | undefined = undefined>(options: {
	method: string
	endpoint: string
	input?: Input
	interceptors?: InterceptorFn[]
	responseType?: 'arraybuffer'
	observe: 'response'
	context?: HttpContext
	validators?: (ValidatorFn<RequestInputValue<Input>> | AsyncValidatorFn<RequestInputValue<Input>>)[]
	transformRequest?: TransformRequestFn
	transformResponse?: TransformResponseFn
}): MakeRequestFn<HttpResponse<ArrayBuffer>, Input>

export function defineRequest(options: RequestOptions): MakeRequestFn {
	return () => {
		const opts: RequestOptions = {
			...options,
		}
		const ref = {} as RequestRef

		Object.defineProperty(ref, REQUEST_REF, {
			value: opts,
		})

		return ref
	}
}

export function isRequestRef(value: unknown): value is RequestRef {
	return !!value && typeof value === 'object' && REQUEST_REF in value
}

export function getRequestRefOptions(value: unknown): RequestOptions {
	if (!isRequestRef(value)) {
		throw new Error('no request ref')
	}

	return value[REQUEST_REF] as RequestOptions
}

function throwAliaNotSet(): never {
	throw new Error('alias not set')
}

export function fillUrl(endpoint: string, params: Map<string, string>): string {
	for (const [key, value] of params) {
		endpoint = endpoint.replace(`:${key}`, value.toString())
	}
	return endpoint
}

export async function fillRequestFromField(request: HttpRequest, fieldOrFieldGroup: unknown, input: unknown): Promise<void> {
	async function doValid(validators: (ValidatorFn | AsyncValidatorFn)[], value: unknown): Promise<Error | null | undefined> {
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

	if (isField(fieldOrFieldGroup)) {
		const param = new Map<string, string>()
		const queryParams = new URLSearchParams()
		const headers = new Headers()
		let body: any = undefined
		const fieldValue: unknown = input ?? fieldOrFieldGroup()
		const meta = getFieldMetadata(fieldOrFieldGroup)

		const err = await doValid([...meta.validators, ...meta.asyncValidator], fieldValue)
		if (err) {
			throw err
		}

		for (const [type, aliasName] of meta.alias) {
			switch (type) {
				case FieldType.Json:
					body = JSON.stringify(fieldValue)
					break
				case FieldType.Query: {
					if (!aliasName) {
						throwAliaNotSet()
					}
					queryParams.append(aliasName, String(fieldValue))
					break
				}
				case FieldType.Param: {
					if (!aliasName) {
						throwAliaNotSet()
					}
					param.set(aliasName, String(fieldValue))
					break
				}
				case FieldType.Header: {
					if (!aliasName) {
						throwAliaNotSet()
					}
					headers.set(aliasName, String(fieldValue))
					break
				}
				case FieldType.Form: {
					if (!aliasName) {
						throwAliaNotSet()
					}
					const form = new FormData()
					form.append(aliasName, String(fieldValue))
					body = form
					break
				}
				case FieldType.Body:
					body = fieldValue
					break
			}
		}

		request.endpoint = fillUrl(request.endpoint, param)
		request.queryParams = queryParams
		request.headers = headers
		request.body = body
		return
	}

	if (isFieldGroup(fieldOrFieldGroup) && inputIsObject(input)) {
		const param = new Map<string, string>()
		const queryParams = new URLSearchParams()
		const headers = new Headers()
		const formData = new FormData()
		const json = {}
		let body = undefined

		for (const [propertyKey, field] of Object.entries(fieldOrFieldGroup)) {
			const defaultValue = field()
			const meta = getFieldMetadata(field)

			for (const [type, aliasName] of meta.alias) {
				const valueKey = aliasName || propertyKey
				const value: any = input[valueKey] || defaultValue
				const err = await doValid([...meta.validators, ...meta.asyncValidator], value)
				if (err) {
					throw err
				}

				switch (type) {
					case FieldType.Json:
						Object.defineProperty(json, valueKey, {
							value,
							writable: true,
						})
						break
					case FieldType.Query:
						queryParams.append(valueKey, value)
						break
					case FieldType.Param:
						param.set(valueKey, value)
						break
					case FieldType.Header:
						headers.set(valueKey, value)
						break
					case FieldType.Form:
						formData.append(valueKey, value)
						break
					case FieldType.Body:
						body = value
						break
				}
			}

			request.endpoint = fillUrl(request.endpoint, param)
			request.queryParams = queryParams
			request.headers = headers
			if (body) {
				request.body = body
			} else if (Array.from(formData.keys()).length > 0) {
				request.body = formData
			} else if (Object.keys(json).length) {
				request.body = JSON.stringify(json)
			}
		}

		return
	}

	throw new Error('unsupported field type')
}

export type DoRequestOptions = {
	uploadProgress?: HttpProgressFn
	downloadProgress?: HttpProgressFn
	abort?: AbortSignal
	handler?: HttpHandler
	client?: ClientOptions
	timeout?: number
}

type RequestRefOutput<T> = T extends RequestRef<infer O> ? O : undefined
type RequestRefInput<T> = T extends RequestRef<unknown, infer I> ? RequestInputValue<I> : never
type RequestRefWithInput<T> = T extends RequestRef<unknown, infer Input> ? (Input extends undefined ? false : true) : false

export async function doRequest<Ref extends RequestRef>(
	ref: RequestRefWithInput<Ref> extends true ? never : Ref,
	options?: DoRequestOptions,
): Promise<RequestRefOutput<Ref>>

export async function doRequest<Ref extends RequestRef>(
	ref: RequestRefWithInput<Ref> extends true ? Ref : never,
	input: RequestRefInput<Ref>,
	options?: DoRequestOptions,
): Promise<RequestRefOutput<Ref>>

export async function doRequest(...args: unknown[]): Promise<unknown> {
	const argsLength = args.length
	let ref: RequestRef
	let input: Field<any> | Record<PropertyKey, Field<any>> | undefined
	let options: DoRequestOptions = {}

	switch (argsLength) {
		case 2: {
			ref = args[0] as any
			options = args[1] as any
			break
		}
		case 3: {
			ref = args[0] as any
			input = args[1] as any
			options = args[2] as any
			break
		}
		default: {
			throw new Error('invalid arguments')
		}
	}

	const requestOptions = getRequestRefOptions(ref)
	const requiredInput: boolean = !!requestOptions.input

	if (requiredInput && !input) {
		throw new Error('input is required')
	}

	let abortController: AbortController | undefined
	let abortSignal: AbortSignal

	if (options.abort) {
		abortSignal = options.abort
	} else {
		abortController = new AbortController()
		abortSignal = abortController.signal
	}

	const clientOptions = getClientConfig(options.client)
	const req: HttpRequest = {
		host: clientOptions?.host || '',
		method: requestOptions.method,
		endpoint: requestOptions.endpoint,
		queryParams: new URLSearchParams(),
		headers: new Headers(),
		body: undefined,
		responseType: requestOptions.responseType ?? 'json',
		context: requestOptions.context || new HttpContext(),
		observe: requestOptions.observe ?? 'body',
		uploadProgress: options.uploadProgress,
		downloadProgress: options.downloadProgress,
		timeout: options.timeout || 0,
		abort: abortSignal,
	}

	let handler: HttpHandler | undefined
	if (options.handler) {
		handler = options.handler
	} else if (clientOptions?.handler) {
		handler = clientOptions.handler
	} else {
		handler = getGlobalHttpHandler()
	}
	if (!handler) {
		throw new Error('no handler')
	}

	await fillRequestFromField(req, requestOptions.input, input)

	if (typeof requestOptions.transformRequest === 'function') {
		req.body = requestOptions.transformRequest(req)
	}

	const chain = makeInterceptorChain([...(clientOptions?.interceptors || []), ...(requestOptions?.interceptors || [])])

	if (req.timeout > 0 && abortController) {
		setTimeout(() => {
			if (!req.abort.aborted) {
				abortController.abort('timeout')
			}
		}, req.timeout)
	}

	const res = await chain(req, handler)

	if (typeof requestOptions.transformResponse === 'function') {
		res.body = requestOptions.transformResponse(res)
	}

	return res
}

/**
 * @todo Implement streaming requests
 */
export function doRequestStream(req: HttpRequest): void {
	console.log(req)
	return void 0
}
