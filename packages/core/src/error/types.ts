import type { DecodedResponse, HttpMeta } from "../internal/http_response";
import type { AnyStruct, Infer } from "../struct/types";

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
 *
 * @group errors
 */
export type FaultCode =
  | "CAP_BUFFER_EXCEEDED"
  | "CAP_QUEUE_OVERFLOW"
  | "ENV_UNSUPPORTED"
  | "EXT_HOOK_FAILED"
  | "EXT_INTERCEPTOR_FAILED"
  | "EXT_OBSERVER_FAILED"
  | "HTTP_STATUS"
  | "NET_ABORTED"
  | "NET_BODY_INCOMPLETE"
  | "NET_TIMEOUT"
  | "NET_UNREACHABLE"
  | "REQ_BUILD_FAILED"
  | "REQ_INPUT_INVALID"
  | "REQ_OPTIONS_INVALID"
  | "RES_DECODE_FAILED"
  | "RES_MEDIA_TYPE_INVALID"
  | "RES_STRUCT_MISMATCH";

/**
 * Extracts the class prefix from a fault code: the segment before its first `_`.
 *
 * `FaultClass<FaultCode>` is
 * `'CAP' | 'ENV' | 'EXT' | 'HTTP' | 'NET' | 'REQ' | 'RES'`.
 *
 * @typeParam C - A `FaultCode`, or a union of them.
 * @group errors
 */
export type FaultClass<C extends string> = C extends `${infer TClass}_${string}`
  ? TClass
  : never;

/**
 * Codes whose fault carries response metadata but no body.
 *
 * These are the `code` values of `DecodeFault`. `PreflightFaultCode` is every
 * other `FaultCode` except `HTTP_STATUS`.
 *
 * @group errors
 */
export type DecodeFaultCode =
  "RES_DECODE_FAILED" | "RES_MEDIA_TYPE_INVALID" | "RES_STRUCT_MISMATCH";

/**
 * Codes whose fault may never have reached a response.
 *
 * Every `FaultCode` except `HTTP_STATUS` and the decode codes:
 * `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`, `ENV_UNSUPPORTED`,
 * `EXT_HOOK_FAILED`, `EXT_INTERCEPTOR_FAILED`, `EXT_OBSERVER_FAILED`,
 * `NET_ABORTED`, `NET_BODY_INCOMPLETE`, `NET_TIMEOUT`, `NET_UNREACHABLE`,
 * `REQ_BUILD_FAILED`, `REQ_INPUT_INVALID`, and `REQ_OPTIONS_INVALID`. These
 * are the `code` values of `PreflightFault`.
 *
 * @group errors
 */
export type PreflightFaultCode = Exclude<
  FaultCode,
  DecodeFaultCode | "HTTP_STATUS"
>;

type ErrorBody<TErr> = [TErr] extends [undefined] ? undefined : Infer<TErr>;

/**
 * Non-2xx fault expressed by its decoded body type instead of the struct that produced it.
 *
 * Factories work in decoded values, so they use this form; endpoint types use
 * `HttpStatusFault` and let `Infer` bridge the two. When `TData` is `undefined`,
 * the body was never read and `response` is metadata alone.
 *
 * @group errors
 */
export type HttpStatusFaultOf<TData> = Error & {
  code: "HTTP_STATUS";
  data: TData;
  response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>;
  status: number;
};

/**
 * Fault for a non-2xx response, typed by the declared `error` struct.
 *
 * `TErr` is the endpoint's declared `error` struct, or `undefined` when it
 * declares none. Any non-2xx status. When the endpoint declared `error` and the
 * body decoded, `data` is that body and `response` carries it. Omitting `error`
 * skips decoding, which leaves `data` as `undefined` and `response` without a
 * `body` field. `ErrorBody<TErr>` is that decoded body: `undefined` when no
 * error struct was declared, otherwise `Infer<TErr>`. {@link HttpStatusFaultOf}
 * is the member shape.
 *
 * @group errors
 */
export type HttpStatusFault<TErr extends AnyStruct | undefined = undefined> =
  HttpStatusFaultOf<ErrorBody<TErr>>;

/**
 * A response arrived but could not be read as declared.
 *
 * `code` is one of `RES_DECODE_FAILED`, `RES_MEDIA_TYPE_INVALID`, or
 * `RES_STRUCT_MISMATCH`. `response` is metadata only: a body is a decoded value,
 * and decoding is what failed, so there is no `body` field to reach for. The
 * offending detail lives on `cause` (a `StructError` for a struct mismatch, the
 * parser failure for an unreadable representation).
 *
 * @group errors
 */
export type DecodeFault = Error & {
  cause: unknown;
  code: DecodeFaultCode;
  response: HttpMeta;
  status: number;
};

/**
 * A failure that may have happened before any response existed.
 *
 * Covers `REQ_*`, `NET_*`, `EXT_*`, `CAP_*`, and `ENV_UNSUPPORTED`. `response`
 * is present only where the transport already had metadata to report, such as a
 * body that truncated mid-download.
 *
 * @group errors
 */
export type PreflightFault = Error & {
  cause?: unknown;
  code: PreflightFaultCode;
  response?: HttpMeta;
};

/**
 * Any failure returned by `client.execute`, expressed by its decoded error-body type.
 *
 * `Fault<TErr>` is `FaultOf` applied to `Infer<TErr>`, and `HttpAwaitResult` uses
 * `FaultOf<TErrorData>`. Pass a decoded type, not a struct: write
 * `FaultOf<Infer<typeof errorStruct>>`, or use `Fault<typeof errorStruct>`.
 *
 * @typeParam TData - The decoded `error` body, or `undefined` when no error struct was declared.
 * @group errors
 */
export type FaultOf<TData = undefined> =
  DecodeFault | HttpStatusFaultOf<TData> | PreflightFault;

/**
 * Union of every failure `client.execute` can return, discriminated by `code`.
 *
 * `Fault<TErr>` is {@link FaultOf} applied to the decoded body type, so it is the
 * union of {@link DecodeFault}, {@link HttpStatusFault}<TErr>, and
 * {@link PreflightFault}. `ErrorBody<TErr>` is `undefined` when `TErr` is
 * `undefined`, and `Infer<TErr>` otherwise. Switch on `fault.code`.
 *
 * Every variant is a native `Error` named `DefjsFault`, so `String(fault)` produces
 * `DefjsFault: <message>`. `code` and the variant metadata — `status`, `response`,
 * `data` — are enumerable own properties. The native `cause` chain is non-enumerable.
 *
 * Default Struct messages say `received <kind>`, never the received value. A JSON
 * `SyntaxError` behind `RES_DECODE_FAILED` gives the message
 * `Response body could not be decoded`. Structural paths retain record keys, which
 * may be sensitive. Raw `StructIssue.received` and parser causes remain sensitive;
 * custom `errorMap` and extension messages are used verbatim and need review before
 * logging.
 *
 * Call `format()`, `flatten()`, or `prettify()` only after narrowing `fault.cause`
 * to `StructError`; those helpers are not copied onto the fault.
 *
 * @typeParam TErr - The endpoint's declared `error` struct, or `undefined` when it declares none.
 * @group errors
 * @exampleFile examples/api/fault.ts#example
 */
export type Fault<TErr extends AnyStruct | undefined = undefined> = FaultOf<
  ErrorBody<TErr>
>;

/**
 * Any fault at all, whatever its decoded error-body type.
 *
 * Use it for handlers that classify faults without caring which endpoint produced
 * them. Prefer `Fault<typeof yourErrorStruct>` where the body type matters.
 *
 * @group errors
 */
export type AnyFault =
  | DecodeFault
  | HttpStatusFaultOf<undefined>
  | HttpStatusFaultOf<unknown>
  | PreflightFault;
