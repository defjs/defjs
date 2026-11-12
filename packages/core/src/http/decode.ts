import type { Fault } from "../error";
import {
  createDecodeFault,
  createHttpStatusFault,
  createUndecodedHttpStatusFault,
} from "../error";
import { awaitWithSignal, resolveAbortFault } from "../internal/abort";
import { parseBytesBody, readBytesText } from "../internal/bytes";
import type { HttpResponseType } from "../internal/http_request";
import type { DecodedResponse, HttpResponse } from "../internal/http_response";
import { toHttpMeta } from "../internal/http_response";
import { resolveInboundRepresentation } from "../internal/inbound_representation";
import { isBlob } from "../internal/type_guards";
import type { AnyStruct } from "../struct";
import { decodeJson } from "../struct/codec/json";
import { StructError } from "../struct/errors";
import { parseStructValue } from "../struct/introspection";
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
  const meta = toHttpMeta(response);
  const struct = response.ok ? definition.output : definition.error;

  if (!struct) {
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
          meta,
        ),
    );
  }

  let decoded: unknown;
  try {
    decoded = await convertBody(
      struct,
      representation,
      contentType,
      response.body,
      signal,
    );
  } catch (error) {
    // A representation failure is not a struct mismatch, and a failed decode has no body.
    return failed(
      resolveAbortFault(signal) ??
        createDecodeFault(
          error instanceof StructError
            ? "RES_STRUCT_MISMATCH"
            : "RES_DECODE_FAILED",
          error,
          meta,
        ),
    );
  }

  const decodedResponse: DecodedResponse<unknown> = { ...meta, body: decoded };
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

/** Faults carry their own response metadata, so the tuple's third slot belongs to success only. */
function failed<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(fault: Fault<TError>): HttpExecuteAwaitResult<TOutput, TError> {
  return [fault, undefined, undefined];
}

/**
 * The body as the declared struct reads it. An interceptor's body may already be text, bytes, or a parsed value;
 * the struct kind decides what it is read as.
 */
function convertBody(
  struct: AnyStruct,
  representation: HttpResponseType,
  contentType: string,
  body: unknown,
  signal: AbortSignal,
): unknown {
  if (body === undefined) {
    // Fetch reads an absent body as zero bytes. JSON parses them like any other bytes and fails.
    return parseStructValue(
      struct,
      parseBytesBody(representation, new Uint8Array(0), contentType),
    );
  }
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
        return decodeJson(struct, body);
      }
      const text = readBytesText(body);
      return decodeJson(struct, text === undefined ? body : JSON.parse(text));
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
      return decodeJson(struct, JSON.parse(await blob.text()));
    case "text":
      return parseStructValue(struct, await blob.text());
    default:
      return parseStructValue(struct, blob);
  }
}
