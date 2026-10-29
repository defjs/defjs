import type { DecodedResponse, HttpMeta } from "../internal/http_response";
import { getHttpErrorMessage } from "../internal/http_response";
import {
  describeCause,
  ERR_ABORTED,
  ERR_TIMEOUT,
  isAbortCause,
  isTimeoutCause,
} from "./cause";

export {
  ERR_ABORTED,
  ERR_TIMEOUT,
  isAbortCause,
  isTimeoutCause,
} from "./cause";
import type {
  DecodeFault,
  DecodeFaultCode,
  HttpStatusFaultOf,
  PreflightFault,
  PreflightFaultCode,
} from "./types";

const FAULT_NAME = "DefjsFault";

function createFault<TFault extends Error>(
  message: string,
  cause?: unknown,
): TFault {
  const fault = (
    cause === undefined ? new Error(message) : new Error(message, { cause })
  ) as TFault;
  Object.defineProperty(fault, "name", {
    configurable: true,
    enumerable: false,
    value: FAULT_NAME,
    writable: true,
  });
  if (cause === undefined) {
    Object.defineProperty(fault, "cause", {
      configurable: true,
      enumerable: false,
      value: undefined,
      writable: true,
    });
  }
  return fault;
}

function buildHttpStatusFault<TData>(
  response: HttpMeta,
  data: TData,
): HttpStatusFaultOf<TData> {
  const fault = createFault<HttpStatusFaultOf<TData>>(
    getHttpErrorMessage(response),
  );
  fault.code = "HTTP_STATUS";
  fault.data = data;
  fault.response = response as HttpStatusFaultOf<TData>["response"];
  fault.status = response.status;
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
  const fault = createFault<DecodeFault>(message, cause);
  fault.code = code;
  fault.response = response;
  fault.status = response.status;
  return fault;
}

/**
 * Builds a fault for a failure that may have happened before any response existed.
 *
 * When `cause` is given, its message becomes the fault message; otherwise the
 * code is the message. The result is a native `Error` named `DefjsFault` with
 * `code`, plus `response` when one was given.
 *
 * @param code - The specific failure.
 * @param cause - Underlying value, when there is one; the code becomes the message otherwise.
 * @param response - Metadata, only where the transport already had some to report.
 * @returns A preflight fault.
 * @group errors
 */
export function createPreflightFault(
  code: PreflightFaultCode,
  cause?: unknown,
  response?: HttpMeta,
): PreflightFault {
  const fault = createFault<PreflightFault>(
    cause === undefined ? code : describeCause(cause),
    cause,
  );
  fault.code = code;
  if (response !== undefined) {
    fault.response = response;
  }
  return fault;
}

/**
 * Builds a `NET_*` `PreflightFault`, choosing the code from the shape of `cause`.
 *
 * Optional `response` metadata is attached when the transport already had some
 * to report. The cause is kept as `cause`.
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
 * @param response - Metadata, only where the transport already had some to report.
 * @returns A `NET_ABORTED`, `NET_TIMEOUT`, or `NET_UNREACHABLE` fault.
 * @group errors
 */
export function createNetworkFault(
  cause: unknown,
  response?: HttpMeta,
): PreflightFault {
  if (isAbortCause(cause)) {
    return withResponse(
      createFault<PreflightFault>(ERR_ABORTED.message, cause),
      "NET_ABORTED",
      response,
    );
  }

  if (isTimeoutCause(cause)) {
    const message =
      cause instanceof Error && cause.message
        ? cause.message
        : ERR_TIMEOUT.message;
    return withResponse(
      createFault<PreflightFault>(message, cause),
      "NET_TIMEOUT",
      response,
    );
  }

  return withResponse(
    createFault<PreflightFault>(describeCause(cause), cause),
    "NET_UNREACHABLE",
    response,
  );
}

function withResponse(
  fault: PreflightFault,
  code: PreflightFaultCode,
  response?: HttpMeta,
): PreflightFault {
  fault.code = code;
  if (response !== undefined) {
    fault.response = response;
  }
  return fault;
}
