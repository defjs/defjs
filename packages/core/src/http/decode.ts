import type { Fault } from "../error";
import {
  createDecodeFault,
  createHttpStatusFault,
  createUndecodedHttpStatusFault,
} from "../error";
import { awaitWithSignal, resolveAbortFault } from "../internal/abort";
import { parseBytesBody, readBytesText } from "../internal/bytes";
import type { HttpResponseType } from "./http_request";
import type { DecodedResponse, HttpMeta, HttpResponse } from "./http_response";
import { failed, toHttpMeta } from "./http_response";
import { resolveInboundRepresentation } from "../internal/inbound_representation";
import { isBlob } from "../internal/type_guards";
import type { AnyStruct } from "../struct";
import { StructError } from "../struct/errors";
import { parseStructValue } from "../struct/parse";
import type {
  DeclaredResponse,
  HttpExecuteAwaitResult,
  RequestSuccessData,
} from "./http";
import {
  getContentType,
  isJsonMediaType,
  jsonMediaTypeError,
} from "./transport/utils";

const EMPTY_BYTES = new Uint8Array(0);

function finishUndecoded<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  response: HttpResponse<unknown>,
  meta: HttpMeta,
): HttpExecuteAwaitResult<TOutput, TError> {
  if (response.ok) {
    return [
      null,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unnecessary-type-assertion -- INTENT: the published RequestSuccessData<TOutput> is a conditional on the caller's generic TOutput that the runtime `!struct` check cannot narrow. Unasserted: TS2322, `undefined` is not assignable to `DeclaredBody<TOutput>`; the type-aware lint reads the deferred conditional as undefined and calls the assertion unnecessary. Typing the internal result as unknown instead fails at defineRequest's published RequestEndpoint return (TS2322)
      undefined as RequestSuccessData<TOutput>,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: with no output struct the response is the HttpMeta itself, but the published DeclaredResponse<TOutput> is a conditional on the caller's generic TOutput. Unasserted: TS2322, `HttpMeta` is not assignable to `DeclaredResponse<TOutput>`
      meta as DeclaredResponse<TOutput>,
    ];
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: with no `error` struct the published Fault<TError> data is ErrorBody<TError>, a conditional on the caller's generic TError that the runtime `!struct` check cannot narrow. Unasserted: TS2345, `undefined` is not assignable to `ErrorBody<TError>`. Typing this internal result as AnyFault instead fails at defineRequest's published RequestEndpoint return (TS2322, AnyFault is not FaultOf<DeclaredBody<TError>>)
  return failed(createUndecodedHttpStatusFault(meta) as Fault<TError>);
}

function finishDecoded<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  response: HttpResponse<unknown>,
  decoded: unknown,
): HttpExecuteAwaitResult<TOutput, TError> {
  const decodedResponse: DecodedResponse<unknown> = {
    headers: response.headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    body: decoded,
  };
  if (response.ok) {
    return [
      null,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: convertBody parsed `decoded` with definition.output, but the published RequestSuccessData<TOutput> is a conditional on the caller's generic TOutput. Unasserted: TS2322, `unknown` is not assignable to `DeclaredBody<TOutput>`
      decoded as RequestSuccessData<TOutput>,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: same decoded body inside the published DeclaredResponse<TOutput> conditional. Unasserted: TS2322, `DecodedResponse<unknown>` is not assignable to `DeclaredResponse<TOutput>`
      decodedResponse as DeclaredResponse<TOutput>,
    ];
  }
  return failed(
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: `data` was decoded with definition.error, but the published Fault<TError> types it as ErrorBody<TError>, a conditional on the caller's generic TError. Unasserted: TS2345, `unknown` is not assignable to `ErrorBody<TError>`. Typing this internal result as AnyFault instead fails at defineRequest's published RequestEndpoint return (TS2322)
    createHttpStatusFault(decodedResponse) as Fault<TError>,
  );
}

/**
 * Synchronously decodes a response returned straight from `parseFetchResponse` with no interceptor in between.
 * Avoids extra `async` Promise wrapping and redundant media-type checks when the body is already parsed.
 */
export function decodeDirectResponse<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  definition: { readonly output?: TOutput; readonly error?: TError },
  response: HttpResponse<unknown>,
  responseType?: HttpResponseType,
  errorResponseType?: HttpResponseType,
): HttpExecuteAwaitResult<TOutput, TError> {
  const struct = response.ok ? definition.output : definition.error;
  if (!struct) {
    return finishUndecoded(response, toHttpMeta(response));
  }

  const representation =
    (response.ok ? responseType : errorResponseType) ??
    resolveInboundRepresentation(struct);
  const contentType =
    response.body === undefined ? getContentType(response.headers) : "";
  if (
    response.body === undefined &&
    representation === "json" &&
    !isJsonMediaType(contentType)
  ) {
    return failed(
      createDecodeFault(
        "RES_MEDIA_TYPE_INVALID",
        jsonMediaTypeError(contentType),
        toHttpMeta(response),
      ),
    );
  }

  try {
    const raw =
      response.body === undefined
        ? parseBytesBody(representation, EMPTY_BYTES, contentType)
        : response.body;
    const decoded = parseStructValue(
      struct,
      raw,
      representation === "json" ? WIRE_NAMES : undefined,
    );
    return finishDecoded(response, decoded);
  } catch (error) {
    return failed(
      createDecodeFault(
        error instanceof StructError
          ? "RES_STRUCT_MISMATCH"
          : "RES_DECODE_FAILED",
        error,
        toHttpMeta(response),
      ),
    );
  }
}

/**
 * Turns the response the interceptor chain settled with into the call's result tuple.
 *
 * `ok` is the only fork, and only one side ever decodes: `output` for a 2xx status, `error` for any other. With
 * nothing declared for that side the body is never read, not even to fail on. A caller abort during a conversion
 * wins over the conversion's own fault.
 */
export async function decodeResponse<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  definition: { readonly output?: TOutput; readonly error?: TError },
  response: HttpResponse<unknown>,
  signal: AbortSignal,
): Promise<HttpExecuteAwaitResult<TOutput, TError>> {
  const struct = response.ok ? definition.output : definition.error;

  if (!struct) {
    return finishUndecoded(response, toHttpMeta(response));
  }

  const representation = resolveInboundRepresentation(struct);
  const contentType = getContentType(response.headers);
  // The media type is checked first, before the body is looked at or read, so a response without
  // content (HEAD, 204, 205, 304) is held to the declaration like any other.
  if (representation === "json" && !isJsonMediaType(contentType)) {
    return failed(
      resolveAbortFault(signal) ??
        createDecodeFault(
          "RES_MEDIA_TYPE_INVALID",
          jsonMediaTypeError(contentType),
          toHttpMeta(response),
        ),
    );
  }

  let decoded: unknown;
  try {
    decoded =
      response.body === undefined
        ? parseStructValue(
            struct,
            parseBytesBody(representation, EMPTY_BYTES, contentType),
          )
        : await convertBody(struct, representation, response.body, signal);
  } catch (error) {
    // A representation failure is not a struct mismatch, and a failed decode has no body.
    return failed(
      resolveAbortFault(signal) ??
        createDecodeFault(
          error instanceof StructError
            ? "RES_STRUCT_MISMATCH"
            : "RES_DECODE_FAILED",
          error,
          toHttpMeta(response),
        ),
    );
  }

  return finishDecoded(response, decoded);
}

// A JSON body reads its wire names. One shared record saves an allocation per response: parsing only reads it.
const WIRE_NAMES = { aliases: true };

/**
 * The body as the declared struct reads it. An interceptor's body may already be text, bytes, or a parsed value;
 * the struct kind decides what it is read as.
 */
function convertBody(
  struct: AnyStruct,
  representation: HttpResponseType,
  body: unknown,
  signal: AbortSignal,
): unknown {
  // Only a Blob read is asynchronous and not itself cancellable, so only it races the request signal.
  // Every other body converts synchronously, and the caller checks cancellation right after.
  if (isBlob(body)) {
    return awaitWithSignal(
      () => convertBlob(struct, representation, body),
      signal,
    );
  }
  signal.throwIfAborted();
  switch (representation) {
    case "json": {
      // A JSON string is a string root: the transport already parsed bytes, so do not parse again.
      if (typeof body === "string") {
        return parseStructValue(struct, body, WIRE_NAMES);
      }
      const text = readBytesText(body);
      return parseStructValue(
        struct,
        text === undefined ? body : JSON.parse(text),
        WIRE_NAMES,
      );
    }
    case "text":
      return parseStructValue(struct, readBytesText(body) ?? body);
    default:
      return parseStructValue(struct, body);
  }
}

async function convertBlob(
  struct: AnyStruct,
  representation: HttpResponseType,
  blob: Blob,
): Promise<unknown> {
  switch (representation) {
    case "json":
      return parseStructValue(
        struct,
        JSON.parse(await blob.text()),
        WIRE_NAMES,
      );
    case "text":
      return parseStructValue(struct, await blob.text());
    default:
      return parseStructValue(struct, blob);
  }
}
