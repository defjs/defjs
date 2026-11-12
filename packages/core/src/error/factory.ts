import type { DecodedResponse, HttpMeta } from "../http/http_response";
import {
  describeCause,
  ERR_ABORTED,
  ERR_TIMEOUT,
  FAULT_NAME,
  networkCauseCode,
} from "./cause";
import type {
  DecodeFault,
  DecodeFaultCode,
  HttpStatusFaultOf,
  PreflightFault,
  PreflightFaultCode,
} from "./types";

/** The fields a fault variant adds to Error, before the factory has written them. */
type Unwritten<TFault extends Error> = Error &
  Partial<Omit<TFault, keyof Error>>;

function createFault(message: string, cause?: unknown): Error {
  // Variant fields are attached by the specific factory. Error has none of them.
  const fault = new Error(message, { cause });
  Object.defineProperty(fault, "name", {
    configurable: true,
    enumerable: false,
    value: FAULT_NAME,
    writable: true,
  });
  return fault;
}

// Each writer below assigns every field its fault type adds to Error, which is what makes the assertion hold.
// PERF: plain field writes. Building the fault with Object.assign, which the compiler could check, makes every
// factory 30% to 40% slower on Bun 1.4.4 (createDecodeFault: 5.4M to 3.1M ops/s).

function writeHttpStatusFields<TData>(
  fault: Unwritten<HttpStatusFaultOf<TData>>,
  response: HttpStatusFaultOf<TData>["response"],
  data: TData,
): asserts fault is HttpStatusFaultOf<TData> {
  fault.code = "HTTP_STATUS";
  fault.data = data;
  fault.response = response;
  fault.status = response.status;
}

function writeDecodeFields(
  fault: Unwritten<DecodeFault>,
  code: DecodeFaultCode,
  response: HttpMeta,
): asserts fault is DecodeFault {
  fault.code = code;
  fault.response = response;
  fault.status = response.status;
}

function writePreflightFields(
  fault: Unwritten<PreflightFault>,
  code: PreflightFaultCode,
  response: HttpMeta | undefined,
): asserts fault is PreflightFault {
  fault.code = code;
  fault.response = response;
}

function buildHttpStatusFault<TData>(
  response: HttpStatusFaultOf<TData>["response"],
  data: TData,
): HttpStatusFaultOf<TData> {
  // The URL is left out of the message: its query can carry credentials.
  const fault = createFault(
    response.statusText
      ? `Http failure response: ${response.status} - ${response.statusText}`
      : `Http failure response: ${response.status}`,
  );
  writeHttpStatusFields(fault, response, data);
  return fault;
}

/**
 * Builds an `HTTP_STATUS` fault for a non-2xx response whose body decoded against the declared `error` struct.
 *
 * The fault is a native `Error` named `DefjsFault` with `code: 'HTTP_STATUS'`,
 * `data` set to `response.body`, `status` copied from the response, and
 * `response` as passed. The message is `Http failure response: <status>`,
 * followed by ` - <statusText>` when there is one.
 *
 * Use {@link createUndecodedHttpStatusFault} when no body was decoded.
 *
 * @param response - The response, carrying the decoded body.
 * @returns An `HTTP_STATUS` fault whose `data` is that body.
 * @group errors
 */
export function createHttpStatusFault<TData>(
  response: DecodedResponse<TData>,
): HttpStatusFaultOf<TData> {
  return buildHttpStatusFault(response, response.body);
}

/**
 * Builds an `HTTP_STATUS` fault for a non-2xx response that was never decoded, because the endpoint declared no `error` struct.
 *
 * The fault is a native `Error` named `DefjsFault` with `code: 'HTTP_STATUS'`,
 * `data: undefined`, `status` copied from the response, and `response` as passed.
 *
 * Use {@link createHttpStatusFault} when the body was decoded.
 *
 * @param response - Metadata of the response; no body was read.
 * @returns An `HTTP_STATUS` fault whose `data` is `undefined`.
 * @group errors
 */
export function createUndecodedHttpStatusFault(
  response: HttpMeta,
): HttpStatusFaultOf<undefined> {
  return buildHttpStatusFault(response, undefined);
}

/**
 * Builds a decode fault for a response that arrived but could not be read as declared.
 *
 * `code` is `RES_DECODE_FAILED`, `RES_MEDIA_TYPE_INVALID`, or
 * `RES_STRUCT_MISMATCH`. The fault carries metadata only: a body is a decoded
 * value, and decoding is what failed, so there is no `body`. `status` is copied
 * from `response`. The result is a native `Error` named `DefjsFault`.
 *
 * `cause` is the underlying parser or struct failure and is kept as `cause`.
 * Its message normally becomes the fault message (`String(cause)` when it is
 * not an `Error`). For `RES_DECODE_FAILED` with an `Error` named `SyntaxError`,
 * the message is `Response body could not be decoded`, so `String(fault)` does
 * not include a body fragment. Default Struct messages contain received kinds,
 * not values; raw values and parser text remain on the cause.
 *
 * @param code - Which read step failed.
 * @param cause - Underlying parser or struct failure.
 * @param response - Metadata of the response that could not be read.
 * @returns A decode fault with no body.
 * @group errors
 */
export function createDecodeFault(
  code: DecodeFaultCode,
  cause: unknown,
  response: HttpMeta,
): DecodeFault {
  const message =
    code === "RES_DECODE_FAILED" &&
    cause instanceof Error &&
    cause.name === "SyntaxError"
      ? "Response body could not be decoded"
      : describeCause(cause);
  const fault = createFault(message, cause);
  writeDecodeFields(fault, code, response);
  return fault;
}

/**
 * Builds a fault for a failure that may have happened before any response existed.
 *
 * When `cause` is given, its message becomes the fault message; otherwise the
 * code is the message. The result is a native `Error` named `DefjsFault` with
 * `code`. `response` is `undefined` until transport metadata exists.
 *
 * @param code - The specific failure.
 * @param cause - Underlying value, when there is one; the code becomes the message otherwise.
 * @param response - Transport metadata. `undefined` until that metadata exists.
 * @returns A preflight fault.
 * @group errors
 */
export function createPreflightFault(
  code: PreflightFaultCode,
  cause?: unknown,
  response?: HttpMeta,
): PreflightFault {
  const fault = createFault(
    cause === undefined ? code : describeCause(cause),
    cause,
  );
  writePreflightFields(fault, code, response);
  return fault;
}

/**
 * Builds a `NET_*` `PreflightFault`, choosing the code from the shape of `cause`.
 *
 * `response` is `undefined` until the transport has metadata to report. The
 * cause is kept as `cause`.
 *
 * - `NET_ABORTED` when {@link isAbortCause} recognizes an abort-branded `Error`
 *   (including `ERR_ABORTED` from another Core copy) or a `DOMException` named
 *   `AbortError`. The message is `Request was aborted`.
 * - `NET_TIMEOUT` when {@link isTimeoutCause} recognizes a timeout-branded
 *   `Error` (including `ERR_TIMEOUT` from another Core copy) or a `DOMException`
 *   or `Error` named `TimeoutError`. The message is the cause's message, or
 *   `Request timed out` when that is empty.
 * - `NET_UNREACHABLE` for anything else, with the cause's message.
 *
 * @param cause - Underlying cancellation, timeout, or transport failure.
 * @param response - Transport metadata. `undefined` until that metadata exists.
 * @returns A `NET_ABORTED`, `NET_TIMEOUT`, or `NET_UNREACHABLE` fault.
 * @group errors
 */
export function createNetworkFault(
  cause: unknown,
  response?: HttpMeta,
): PreflightFault {
  const code = networkCauseCode(cause);
  const fault = createFault(networkMessage(code, cause), cause);
  writePreflightFields(fault, code, response);
  return fault;
}

function networkMessage(
  code: ReturnType<typeof networkCauseCode>,
  cause: unknown,
): string {
  switch (code) {
    case "NET_ABORTED":
      return ERR_ABORTED.message;
    case "NET_TIMEOUT":
      return cause instanceof Error && cause.message
        ? cause.message
        : ERR_TIMEOUT.message;
    default:
      return describeCause(cause);
  }
}
