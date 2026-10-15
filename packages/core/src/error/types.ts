import type { DecodedResponse, HttpMeta } from '../internal/http_response'
import type { AnyStruct, Infer } from '../struct/types'

/**
 * Every failure Defjs reports, as one closed set of codes.
 *
 * The prefix before the first `_` is the class; there is no separate `kind` field.
 * Read the prefix for coarse triage and the whole code for an exact case:
 *
 * | Class  | Meaning                                                        |
 * | ------ | -------------------------------------------------------------- |
 * | `HTTP` | The peer answered with a non-2xx status.                        |
 * | `REQ`  | The request never left: input, execute options, or build.       |
 * | `NET`  | No usable response: cancel, timeout, connect, truncated body.   |
 * | `RES`  | A response arrived but could not be read as declared.           |
 * | `EXT`  | Code you attached to the pipeline threw.                        |
 * | `CAP`  | A declared buffer or queue limit was exceeded.                  |
 * | `ENV`  | The host runtime lacks a required capability.                   |
 *
 * The set is closed on purpose: it keeps `switch (fault.code)` exhaustive. Extensions
 * report their own detail through `cause`, not through a new code.
 */
export type FaultCode =
  | 'CAP_BUFFER_EXCEEDED'
  | 'CAP_QUEUE_OVERFLOW'
  | 'ENV_UNSUPPORTED'
  | 'EXT_HOOK_FAILED'
  | 'EXT_INTERCEPTOR_FAILED'
  | 'EXT_OBSERVER_FAILED'
  | 'HTTP_STATUS'
  | 'NET_ABORTED'
  | 'NET_BODY_INCOMPLETE'
  | 'NET_TIMEOUT'
  | 'NET_UNREACHABLE'
  | 'REQ_BUILD_FAILED'
  | 'REQ_INPUT_INVALID'
  | 'REQ_OPTIONS_INVALID'
  | 'RES_DECODE_FAILED'
  | 'RES_MEDIA_TYPE_INVALID'
  | 'RES_STRUCT_MISMATCH'

/**
 * The class of a fault code: the segment before its first `_`.
 *
 * @typeParam C - A `FaultCode`, or a union of them.
 */
export type FaultClass<C extends string> = C extends `${infer TClass}_${string}` ? TClass : never

/** Codes whose fault carries response metadata but no body. */
export type DecodeFaultCode = 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID' | 'RES_STRUCT_MISMATCH'

/** Codes whose fault may never have reached a response. */
export type PreflightFaultCode = Exclude<FaultCode, DecodeFaultCode | 'HTTP_STATUS'>

type ErrorBody<TErr> = [TErr] extends [undefined] ? undefined : Infer<TErr>

/**
 * `HttpStatusFault` expressed by its decoded body type instead of the struct that produced it.
 *
 * Factories work in decoded values, so they use this form; endpoint types use
 * `HttpStatusFault` and let `Infer` bridge the two.
 */
export type HttpStatusFaultOf<TData> = Error & {
  code: 'HTTP_STATUS'
  data: TData
  response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>
  status: number
}

/**
 * The peer answered with a non-2xx status and the declared `error` struct decoded its body.
 *
 * Omitting `error` skips decoding, which leaves `data` as `undefined` and `response`
 * without a `body` field.
 */
export type HttpStatusFault<TErr extends AnyStruct | undefined = undefined> = HttpStatusFaultOf<ErrorBody<TErr>>

/**
 * A response arrived but could not be read as declared.
 *
 * `response` is metadata only: a body is a decoded value, and decoding is what failed.
 * The offending detail lives on `cause` (a `StructError` for a struct mismatch, the
 * parser failure for an unreadable representation).
 */
export type DecodeFault = Error & {
  cause: unknown
  code: DecodeFaultCode
  response: HttpMeta
  status: number
}

/**
 * A failure that may have happened before any response existed.
 *
 * `response` is present only where the transport already had metadata to report,
 * such as a body that truncated mid-download.
 */
export type PreflightFault = Error & {
  cause?: unknown
  code: PreflightFaultCode
  response?: HttpMeta
}

/**
 * Any failure returned by `client.execute`, expressed by its decoded error-body type.
 *
 * @typeParam TData - The decoded `error` body, or `undefined` when no error struct was declared.
 */
export type FaultOf<TData = undefined> = DecodeFault | HttpStatusFaultOf<TData> | PreflightFault

/**
 * Any failure returned by `client.execute`, discriminated by `code`.
 *
 * @typeParam TErr - The endpoint's declared `error` struct, or `undefined` when it declares none.
 */
export type Fault<TErr extends AnyStruct | undefined = undefined> = FaultOf<ErrorBody<TErr>>

/**
 * Any fault at all, whatever its decoded error-body type.
 *
 * Use it for handlers that classify faults without caring which endpoint produced them.
 * Prefer `Fault<typeof yourErrorStruct>` where the body type matters.
 */
export type AnyFault = DecodeFault | HttpStatusFaultOf<undefined> | HttpStatusFaultOf<unknown> | PreflightFault
