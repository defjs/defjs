import type { Client } from "../client/client";
import type { RetryOptions } from "../client/config";
import type { Fault, FaultOf } from "../error";
import type { EndpointArgs, EndpointInput } from "../internal/endpoint_input";
import type { HttpProgressFn } from "./http_request";
import type { DecodedResponse, HttpMeta } from "./http_response";
import type { BuilderField, HttpRequestShape } from "../internal/builder_types";
import type { OutboundBuilder } from "../internal/outbound_request";
import type { AnyStruct, Infer } from "../struct";
import { executeHttp } from "./execute";

/**
 * HTTP fields of {@link RequestOptions}: progress callbacks, `retry`, and `signal`.
 *
 * `onDownloadProgress` and `onUploadProgress` are {@link HttpProgressFn}
 * callbacks. They receive an {@link HttpProgressEvent} with `loaded`, `total`,
 * and `lengthComputable`. `retry` replaces the client's retry policy for this
 * call. Other request fields are ignored by HTTP.
 *
 * @group http
 */
export type UseRequestConfig = {
  /** Aborts the call. */
  signal?: AbortSignal;
  /** Observes download progress. */
  onDownloadProgress?: HttpProgressFn;
  /** Observes upload progress. */
  onUploadProgress?: HttpProgressFn;
  /** Retry policy for this call. Replaces the client policy as a whole value; the `budget` stays with the client. */
  retry?: Omit<RetryOptions, "budget">;
};

/**
 * HTTP fields read from {@link RequestOptions} for one call.
 *
 * Progress callbacks, `retry`, and `signal`. There is no `timeout` or `abort`.
 *
 * @group http
 */
export type HttpExecuteOptions = UseRequestConfig;

/**
 * Operation returned by `defineRequest`.
 *
 * The first argument is a {@link Client}. Further arguments are the input, and only the input: none when the definition declares no `input`, optional when the input struct accepts `undefined`, and required otherwise. Calling it starts the request and returns the error-first tuple.
 *
 * @group http
 */
export type RequestEndpoint<
  Args extends unknown[],
  Data,
  ErrorData,
  Response extends HttpMeta,
> = (
  client: Client,
  ...args: Args
) => Promise<
  | [error: null, result: Data, response: Response]
  | [error: FaultOf<ErrorData>, result: undefined, response: undefined]
>;

export type { BuilderInput, HttpRequestShape } from "../internal/builder_types";

type DeclaredBody<TStruct> = [TStruct] extends [undefined]
  ? undefined
  : Infer<TStruct>;

export type DeclaredResponse<TStruct> = [TStruct] extends [undefined]
  ? HttpMeta
  : DecodedResponse<Infer<TStruct>>;

/**
 * Decoded success body for the declared `output` struct, or `undefined` when none is declared.
 *
 * @group http
 */
export type RequestSuccessData<TOutput extends AnyStruct | undefined> =
  DeclaredBody<TOutput>;

/**
 * Decoded error body for the declared `error` struct, or `undefined` when none is declared.
 *
 * @group http
 */
export type RequestErrorData<TError extends AnyStruct | undefined> =
  DeclaredBody<TError>;

type ResponseDeclaration<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
> = ([TOutput] extends [undefined] ? { output?: never } : { output: TOutput }) &
  ([TError] extends [undefined] ? { error?: never } : { error: TError });

/**
 * Contract for an HTTP endpoint: method, path, optional input, and the structs that decode its bodies.
 *
 * Declaring `input` requires an explicit `builder` to place the parsed value on
 * the request. `input` only defines the parameters; the builder alone decides
 * where each value goes. Only definitions without `input` may omit `builder`.
 * `output` declares the body for a 2xx response, `error` the body for anything
 * else. Only one of the two ever runs, and omitting one means that body is never
 * read. `ResponseDeclaration` is an internal helper type: `output` and `error`
 * are required only when the matching type parameter is a struct. The struct
 * kind selects how a declared body is read. Pass to `defineRequest` to get a
 * typed endpoint.
 *
 * @group http
 */
export type RequestDefinition<
  TInput extends AnyStruct | undefined = undefined,
  TOutput extends AnyStruct | undefined = undefined,
  TError extends AnyStruct | undefined = undefined,
> = ResponseDeclaration<TOutput, TError> & {
  builder?: OutboundBuilder;
  input?: TInput;
  method: string;
  meta?: { [key: string]: unknown };
  path: string;
};

/**
 * Await-result tuple for an HTTP call: success is `[null, data, response]`, and failure is `[fault, undefined, undefined]`.
 *
 * `TData` and `TErrorData` are decoded body types. On success the third slot
 * carries `body` only when `output` was declared. On failure it is `undefined`,
 * because the fault already holds whatever response metadata existed.
 *
 * @group http
 */
export type HttpAwaitResult<TData = undefined, TErrorData = undefined> =
  | [
      error: null,
      result: TData,
      response: [TData] extends [undefined] ? HttpMeta : DecodedResponse<TData>,
    ]
  | [error: FaultOf<TErrorData>, result: undefined, response: undefined];

export type HttpExecuteAwaitResult<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
> =
  | [
      error: null,
      result: RequestSuccessData<TOutput>,
      response: DeclaredResponse<TOutput>,
    ]
  | [error: Fault<TError>, result: undefined, response: undefined];

/**
 * Declares a typed HTTP request endpoint.
 *
 * Pass method, path, an optional input struct, and the single `output` and
 * `error` structs. Call the returned operation with a client and, when declared, the input.
 *
 * The contract is `method`, `path`, an optional `input` struct, optional
 * `output` and `error` structs, and an optional `meta`. A declared `input`
 * always requires an explicit `builder`. `input` only defines the parameters;
 * the builder alone decides where each value goes. Only definitions without
 * `input` may omit `builder`. `ResponseDeclaration` and `BuilderField` are
 * internal helper types: `output` and `error` are required only when the
 * matching type parameter is a struct, and `builder` is
 * `(input: BuilderInput<TInput>) => HttpRequestShape` when `input` is declared.
 *
 * `output` is one struct for the 2xx body; `error` is one struct for every
 * non-2xx body. Neither is keyed by status. A declaration is an assertion:
 * omitting one means that body is never read.
 *
 * Known fields are copied when the definition is created. `builder`, `input`, `output`, `error`, and `meta` keep their identity. A getter on one of those fields runs during `defineRequest` and its exception escapes the call. Other properties on the definition object are not read.
 *
 * @param definition - Request contract (method, path, input, builder, output, error, meta).
 * @returns An operation `(client, ...input) => Promise<error-first tuple>`.
 *
 * The checked example file passes the whole input object as `path`. This snippet maps individual fields into `path` and `query` instead:
 *
 * @example
 * ```ts
 * const getOrder = defineRequest({
 *   method: 'GET',
 *   path: '/orders/:id',
 *   input: struct.object({ id: struct.number(), verbose: struct.boolean() }),
 *   builder: (input) => ({ path: { id: input.id }, query: { verbose: input.verbose } }),
 *   output: struct.object({ id: struct.number(), status: struct.string() }),
 * })
 * ```
 * @group http
 * @exampleFile examples/api/define-request.ts#example
 */
export function defineRequest<
  const M extends string,
  const P extends string,
  TInput extends AnyStruct | undefined = undefined,
  TOutput extends AnyStruct | undefined = undefined,
  TError extends AnyStruct | undefined = undefined,
>(
  definition: ResponseDeclaration<TOutput, TError> & {
    input?: TInput;
    method: M;
    meta?: { [key: string]: unknown };
    path: P;
  } & BuilderField<NoInfer<TInput>, HttpRequestShape<NoInfer<P>, NoInfer<M>>>,
): RequestEndpoint<
  EndpointArgs<TInput>,
  RequestSuccessData<TOutput>,
  RequestErrorData<TError>,
  DeclaredResponse<TOutput>
> {
  // Copy known definition fields. Schemas and builder stay the same references.
  const builder = definition.builder;
  const input = definition.input;
  const method = definition.method;
  const meta = definition.meta;
  const path = definition.path;
  const output = definition.output;
  const error = definition.error;
  const endpoint = {
    builder,
    error,
    input,
    method,
    meta,
    output,
    path,
  };

  return (client: Client, input?: EndpointInput<TInput>) =>
    executeHttp<TInput, TOutput, TError>(client, endpoint, input);
}
