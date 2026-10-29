import {
  COMMAND_EXECUTE,
  COMMAND_TYPE,
  HTTP_COMMAND,
  type CommandExecutor,
} from "../client/command";
import type { BaseCommand } from "../client/command";
import type { HttpClientConfig } from "../client/config";
import { ERR_FETCH_UNSUPPORTED } from "../client/config";
import type { AnyFault, Fault, FaultOf, PreflightFault } from "../error";
import {
  createDecodeFault,
  createHttpStatusFault,
  createNetworkFault,
  createPreflightFault,
  createUndecodedHttpStatusFault,
} from "../error";
import { makeChain, resolveHttpInterceptors } from "../interceptor/interceptor";
import type { UseCancellationConfig } from "../internal/abort";
import {
  armTransportDeadline,
  awaitWithSignal,
  createAbortTimeoutConflictFault,
  hasAbortTimeoutConflict,
  mergeAbortSignals,
  releaseAbortSignal,
  resolveAbortedFault,
  resolveAbortCause,
  resolveTransportCancellation,
  snapshotCancellationConfig,
  validateTransportTimeout,
} from "../internal/abort";
import { readBytesText } from "../internal/bytes";
import type { EndpointCallable } from "../internal/endpoint_command";
import { resolveInboundRepresentation } from "../internal/inbound_representation";
import { createTransportOrigin } from "../internal/transport_origin";
import { RequestUrlError, resolveRequestUrl } from "../internal/url";
import type { EndpointInput, ParsedInput } from "../internal/endpoint_input";
import { parseEndpointInput } from "../internal/endpoint_input";
import type { HttpProgressFn } from "../internal/http_request";
import type {
  DecodedResponse,
  HttpMeta,
  HttpResponse,
} from "../internal/http_response";
import { isHttpResponse } from "../internal/http_response";
import type { BuilderField, HttpRequestShape } from "../internal/builder_types";
import type { OutboundBuilder } from "../internal/outbound_request";
import type { AnyStruct, Infer } from "../struct";
import { decodeJson } from "../struct/codec/json";
import { StructError } from "../struct/errors";
import { parseStructValue } from "../struct/introspection";
import type { Guide } from "../struct/guide";
import { createHttpRequest } from "./request";
import type { AnyBodyFailure } from "./transport/body_failure";
import { isBodyFailure } from "./transport/body_failure";
import {
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  fetchHandler,
} from "./transport/fetch";
import { getContentType, isJsonMediaType } from "./transport/utils";

/**
 * Per-request options for HTTP execution: progress callbacks and cancellation.
 *
 * The HTTP-specific part of {@link HttpExecuteOptions}, which adds `signal`.
 * `onDownloadProgress` and `onUploadProgress` are {@link HttpProgressFn}
 * callbacks. They receive an {@link HttpProgressEvent} with `loaded`, `total`,
 * and `lengthComputable`.
 *
 * Cancellation is either `abort` or `timeout`, never both. The type rejects
 * both, and at runtime passing both fails with a `REQ_OPTIONS_INVALID` fault.
 * `timeout` must be a positive safe integer no greater than `2_147_483_647`.
 * It replaces the default set by {@link withTimeout} for that call. `abort`
 * combines with that default instead.
 *
 * @group http
 */
export type UseRequestConfig = {
  onDownloadProgress?: HttpProgressFn;
  onUploadProgress?: HttpProgressFn;
} & UseCancellationConfig;

/**
 * Opaque executable HTTP command produced by a `defineRequest` endpoint.
 *
 * Created by calling a `RequestEndpoint` with input. It carries the request
 * definition and optional typed input for `client.execute`. Treat it as opaque
 * and pass it to `client.execute`.
 *
 * @group http
 */
export interface HttpCommand<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined = undefined,
> extends BaseCommand<typeof HTTP_COMMAND> {
  readonly definition: RequestDefinition<TInput, TOutput, TError>;
  readonly input: EndpointInput<TInput> | undefined;
}

/**
 * Options passed to `client.execute` or `executeHttpCommand` for one HTTP call: progress, `abort` or `timeout`, and `signal`.
 *
 * Cancellation is `abort` or `timeout`, not both (`abort` XOR `timeout`).
 * `signal` combines with either; it is not an alias for `abort`. Valid shapes:
 * `{ timeout }`, `{ abort }`, `{ signal, timeout }`, `{ signal, abort }`.
 * `{ abort, timeout }` is invalid and makes the call resolve with a
 * `REQ_OPTIONS_INVALID` fault. `timeout` must be a positive safe integer in
 * `1..2_147_483_647`.
 *
 * When `timeout` is omitted, the client's `withTimeout` default applies;
 * `abort` combines with that default.
 *
 * @group http
 */
export type HttpExecuteOptions = UseRequestConfig & { signal?: AbortSignal };

/**
 * Callable endpoint returned by `defineRequest`.
 *
 * Call it to get an `HttpCommand`: with no arguments when the endpoint declares
 * no `input`, with an optional argument when the input struct accepts
 * `undefined`, and otherwise with the struct's input value.
 *
 * @group http
 */
export type RequestEndpoint<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined = undefined,
> = EndpointCallable<TInput, HttpCommand<TInput, TOutput, TError>>;

export type { BuilderInput, HttpRequestShape } from "../internal/builder_types";

type DeclaredBody<TStruct> = [TStruct] extends [undefined]
  ? undefined
  : Infer<TStruct>;

type DeclaredResponse<TStruct> = [TStruct] extends [undefined]
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
 * are required only when the matching type parameter is a struct. There is no
 * `responseType`: the struct kind selects how a declared body is read. Pass to
 * `defineRequest` to get a typed endpoint.
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
  operation?: string;
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

type HttpExecuteAwaitResult<
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
 * `error` structs. Call the returned endpoint with input to get an `HttpCommand`
 * for `client.execute`.
 *
 * The contract is `method`, `path`, an optional `input` struct, optional
 * `output` and `error` structs, and an optional `operation`. A declared `input`
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
 * @param definition - Request contract (method, path, input, builder, output).
 * @returns An endpoint that creates `HttpCommand` values from input.
 *
 * The checked example file passes the whole input object as `path`. This snippet maps individual fields into `path` and `query` instead:
 *
 * @example
 * ```ts
 * const getUser = defineRequest({
 *   method: 'GET',
 *   path: '/users/:id',
 *   input: struct.object({ id: struct.number(), verbose: struct.boolean() }),
 *   builder: (input) => ({ path: { id: input.id }, query: { verbose: input.verbose } }),
 *   output: struct.object({ id: struct.number(), name: struct.string() }),
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
    operation?: string;
    path: P;
  } & BuilderField<NoInfer<TInput>, HttpRequestShape<NoInfer<P>, NoInfer<M>>>,
): RequestEndpoint<TInput, TOutput, TError> {
  // Snapshot the top-level definition so a later mutation of the caller's object cannot retarget this endpoint.
  const endpoint = { ...definition } as RequestDefinition<
    TInput,
    TOutput,
    TError
  >;

  function create(
    input?: EndpointInput<TInput>,
  ): HttpCommand<TInput, TOutput, TError> {
    const command: HttpCommand<TInput, TOutput, TError> = {
      [COMMAND_EXECUTE]: executeHttpCommand as CommandExecutor,
      [COMMAND_TYPE]: HTTP_COMMAND,
      definition: endpoint,
      input,
    };

    return command;
  }

  return ((input?: EndpointInput<TInput>) => create(input)) as RequestEndpoint<
    TInput,
    TOutput,
    TError
  >;
}

/**
 * Runs an `HttpCommand` against client config: validate input, send the request, and parse the response.
 *
 * Low-level entry used by `client.execute`. Prefer `client.execute(command, options)`
 * in application code. `HttpClientConfig` is the HTTP part of `ClientConfig`, so
 * a `ClientConfig` is accepted. `HttpExecuteAwaitResult` is the internal result
 * tuple.
 *
 * The result is `[null, data, response]` or `[fault, undefined, undefined]`.
 * `data` is the decoded `output` body, or `undefined` when none is declared.
 * `response` is `DecodedResponse` when `output` is declared and `HttpMeta`
 * otherwise. The fault is `Fault<TError>`. A non-2xx status is `HTTP_STATUS`
 * when no `error` struct is declared (its `data` is `undefined`) or when the
 * declared body decodes (its `data` is that body). When a declared `error` body
 * cannot be read, the fault is a `RES_*` decode fault instead. On failure the
 * tuple's third slot is `undefined`; the fault carries the response metadata.
 * `options.timeout` falls back to the client's `withTimeout` default when omitted.
 *
 * @param clientConfig - Resolved HTTP client configuration (endpoint, interceptors, handler).
 * @param command - Command from a `defineRequest` endpoint.
 * @param options - Per-request progress and cancellation options.
 * @returns An await-result tuple of success body or typed request error.
 * @group http
 */
export async function executeHttpCommand<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  clientConfig: HttpClientConfig,
  command: HttpCommand<TInput, TOutput, TError>,
  options?: HttpExecuteOptions,
): Promise<HttpExecuteAwaitResult<TOutput, TError>> {
  const { definition, input } = command;
  const config = options ?? {};

  // Faults carry their own response metadata, so the tuple's third slot belongs to success only.
  const fail = (fault: AnyFault): HttpExecuteAwaitResult<TOutput, TError> => {
    return [fault as Fault<TError>, undefined, undefined];
  };

  let cancellation;
  try {
    // Client `withTimeout` fills HTTP execute only when the call omits `timeout`.
    // XOR still applies only to execute options that pass both `abort` and `timeout`.
    cancellation = snapshotCancellationConfig({
      abort: config.abort,
      signal: config.signal,
      timeout:
        config.timeout !== undefined ? config.timeout : clientConfig.timeout,
    });
  } catch (error) {
    return fail(createPreflightFault("REQ_OPTIONS_INVALID", error));
  }

  if (hasAbortTimeoutConflict(config)) {
    return fail(createAbortTimeoutConflictFault());
  }

  try {
    validateTransportTimeout(cancellation.timeout);
  } catch (error) {
    return fail(createPreflightFault("REQ_OPTIONS_INVALID", error));
  }

  const controller = new AbortController();

  // Fast path: caller already aborted before we did any struct work — skip parseEndpointInput.
  const preAbortedSignal = [cancellation.abort, cancellation.signal].find(
    (signal) => signal?.aborted,
  );
  if (preAbortedSignal) {
    return fail(resolveAbortedFault(preAbortedSignal));
  }

  // The deadline covers parse, the builder, the transport, and declared-body conversion.
  // release() only clears the timer, so a response that already arrived is not aborted by it.
  const deadline = armTransportDeadline(cancellation.timeout);
  // The deadline signal is ours and per request, so alone it is the request signal. A caller signal
  // still goes through a composite: listeners must never be left on a signal the caller keeps.
  const requestSignal =
    cancellation.abort === undefined &&
    cancellation.signal === undefined &&
    deadline.signal
      ? deadline.signal
      : mergeAbortSignals(controller.signal, [
          cancellation.abort,
          cancellation.signal,
          deadline.signal,
        ]);
  deadline.releaseOnAbort(requestSignal);
  const stopBeforeTransport = (
    fault: PreflightFault,
  ): HttpExecuteAwaitResult<TOutput, TError> => {
    deadline.release();
    releaseAbortSignal(requestSignal);
    return fail(fault);
  };

  // Read a status class only when that side declared a struct, using that side's kind.
  // The other side is cancelled unread. A transport fault while reading a declared side still surfaces.
  const responseType = definition.output
    ? resolveInboundRepresentation(definition.output)
    : undefined;
  const errorResponseType = definition.error
    ? resolveInboundRepresentation(definition.error)
    : undefined;
  const inputGuides = new WeakMap<object, Guide>();
  let parsedInput: ParsedInput<TInput>;
  try {
    parsedInput = parseEndpointInput<TInput>(
      definition.input,
      input,
      inputGuides,
    );
  } catch (error) {
    return stopBeforeTransport(
      resolveTransportCancellation(
        deadline,
        requestSignal,
        createPreflightFault("REQ_INPUT_INVALID", error),
      ),
    );
  }

  const parsedCancellation = resolveTransportCancellation(
    deadline,
    requestSignal,
  );
  if (parsedCancellation) {
    return stopBeforeTransport(parsedCancellation);
  }

  let request;
  try {
    request = createHttpRequest(
      definition.method,
      definition.path,
      parsedInput,
      definition.builder,
      {
        abort: requestSignal,
        baseEndpoint: clientConfig.endpoint,
        defaultHeaders: clientConfig.headers,
        downloadProgress: config.onDownloadProgress,
        inputDeclared: definition.input !== undefined,
        inputGuides,
        errorResponseType,
        operation: definition.operation,
        querySerializer: clientConfig.querySerializer,
        responseType,
        timeout: cancellation.timeout,
        uploadProgress: config.onUploadProgress,
        withCredentials: clientConfig.withCredentials,
        xsrf: clientConfig.xsrf,
      },
    );
  } catch (error) {
    return stopBeforeTransport(
      resolveTransportCancellation(
        deadline,
        requestSignal,
        createPreflightFault("REQ_BUILD_FAILED", error),
      ),
    );
  }

  const builtCancellation = resolveTransportCancellation(
    deadline,
    requestSignal,
  );
  if (builtCancellation) {
    return stopBeforeTransport(builtCancellation);
  }

  const releaseRequestTimeout = deadline.release;

  const transportOrigin = createTransportOrigin();
  const transportController = new AbortController();
  let chainSettled = false;
  let inflightTransport: Promise<HttpResponse<unknown>> | undefined;
  let response: HttpResponse<unknown> | undefined;
  const handler = (
    nextRequest: typeof request,
  ): Promise<HttpResponse<unknown>> => {
    if (chainSettled) {
      const rejected = Promise.reject<HttpResponse<unknown>>(
        new Error(
          "HTTP interceptor next() cannot be called after the chain has settled",
        ),
      );
      void rejected.catch(() => undefined);
      return rejected;
    }

    try {
      resolveRequestUrl(nextRequest);
    } catch (error) {
      const rejected = Promise.reject<HttpResponse<unknown>>(error);
      void rejected.catch(() => undefined);
      return rejected;
    }

    // transportController already follows requestSignal through abortTransport. Only an interceptor that
    // swapped the signal needs a composite, which is expensive to build and to listen on.
    const transportAbort =
      nextRequest.abort === undefined || nextRequest.abort === requestSignal
        ? transportController.signal
        : mergeAbortSignals(transportController.signal, [nextRequest.abort]);
    // Interceptors run after the post-builder check. A deadline that expired there must not start the fetch.
    const due = resolveTransportCancellation(deadline, transportAbort);
    if (due) {
      // `due` exists only after this signal has aborted, so the cause is the abort sentinel.
      const rejected = Promise.reject<HttpResponse<unknown>>(
        transportOrigin.mark(resolveAbortCause(transportAbort) as Error),
      );
      releaseAbortSignal(transportAbort);
      void rejected.catch(() => undefined);
      return rejected;
    }
    const pending = fetchHandler(
      {
        ...nextRequest,
        abort: transportAbort,
      },
      clientConfig.http.handle,
    )
      .catch((error: unknown) => {
        // Cancellation outranks whatever the transport was doing when it noticed. Tagging here is
        // the only way to tell a dead server from an interceptor that threw the same value: both
        // reach the chain's catch as one bare cause.
        throw transportOrigin.mark(resolveAbortCause(transportAbort) ?? error);
      })
      .finally(() => {
        releaseAbortSignal(transportAbort);
      });
    inflightTransport = pending;
    return pending;
  };

  const abortTransport = () => {
    if (!transportController.signal.aborted) {
      transportController.abort(requestSignal.reason);
    }
  };
  try {
    try {
      const httpInterceptors = resolveHttpInterceptors(
        clientConfig.interceptors,
      );
      const chain = makeChain(httpInterceptors);
      if (requestSignal.aborted) {
        abortTransport();
      } else {
        requestSignal.addEventListener("abort", abortTransport, { once: true });
      }

      const chainPromise = chain(request, handler);
      void chainPromise.catch(() => undefined);
      const settled = await awaitWithSignal(() => chainPromise, requestSignal);
      // Interceptors are user code, and only an HttpResponse carries the `ok` fork the pipeline reads next.
      // `response` stays unset on failure so the finally block still releases the deadline and the signal.
      if (!isHttpResponse(settled)) {
        throw new TypeError(
          "HTTP interceptor must resolve an HttpResponse from next() or makeResponse()",
        );
      }
      response = settled;
    } catch (error) {
      const fromTransport = transportOrigin.has(error);
      const cancelled = resolveTransportCancellation(deadline, requestSignal);
      if (cancelled) {
        abortTransport();
        if (inflightTransport) {
          await Promise.allSettled([inflightTransport]);
        }
        return fail(cancelled);
      }
      if (error instanceof RequestUrlError) {
        return fail(createPreflightFault("REQ_BUILD_FAILED", error));
      }
      // The transport only reads a side that declared a struct, so a tagged body failure belongs to that side.
      // An upload observer failure is also tagged, without response metadata.
      if (isBodyFailure(error)) {
        return fail(fromBodyFailure(error));
      }
      if (
        fromTransport &&
        (error === ERR_STREAMING_REQUEST_UNSUPPORTED ||
          error === ERR_FETCH_UNSUPPORTED)
      ) {
        return fail(createPreflightFault("ENV_UNSUPPORTED", error));
      }
      // Recognized cancellation shapes stay cancellation wherever they came from; anything else
      // belongs to whoever produced it.
      const networkFault = createNetworkFault(error);
      if (networkFault.code !== "NET_UNREACHABLE") {
        return fail(networkFault);
      }
      return fail(
        fromTransport
          ? networkFault
          : createPreflightFault("EXT_INTERCEPTOR_FAILED", error),
      );
    }
  } finally {
    requestSignal.removeEventListener("abort", abortTransport);
    chainSettled = true;
    if (!transportController.signal.aborted) {
      transportController.abort(new Error("HTTP interceptor chain settled"));
    }
    // Keep the deadline armed while a declared body is still being converted.
    if (!response) {
      releaseRequestTimeout();
      releaseAbortSignal(requestSignal);
    }
  }

  const settledResponse = response as HttpResponse<unknown>;
  const meta = toHttpMeta(settledResponse);

  // Philosophy 2: `ok` is the only fork, and only one side ever decodes.
  const struct = settledResponse.ok ? definition.output : definition.error;

  // Philosophy 5: with nothing declared for this side, that body is never read — not even to
  // fail on. An unreadable representation on the side you opted out of is none of your business.
  // Interceptor work can still cross the deadline. Check before release, which makes the gate a no-op.
  if (!struct) {
    const cancelled = resolveTransportCancellation(deadline, requestSignal);
    releaseRequestTimeout();
    releaseAbortSignal(requestSignal);
    if (cancelled) {
      return fail(cancelled);
    }
    if (settledResponse.ok) {
      return [
        null,
        undefined as RequestSuccessData<TOutput>,
        meta as DeclaredResponse<TOutput>,
      ];
    }
    return fail(createUndecodedHttpStatusFault(meta));
  }

  let decoded: unknown;
  try {
    decoded = await decodeDeclaredBody(struct, settledResponse, requestSignal);
    // Synchronous conversion can finish before the deadline timer runs.
    // A declared error uses the same wall-clock gate as a success.
    const cancelled = resolveTransportCancellation(deadline, requestSignal);
    if (cancelled) {
      return fail(cancelled);
    }
  } catch (error) {
    // Caller abort wins over an overdue deadline, which wins over a conversion fault.
    const cancelled = resolveTransportCancellation(deadline, requestSignal);
    if (cancelled) {
      return fail(cancelled);
    }
    // Philosophy 3 + 4: representation failures are not struct mismatches, and a failed decode has no body.
    if (error instanceof JsonMediaTypeError) {
      return fail(createDecodeFault("RES_MEDIA_TYPE_INVALID", error, meta));
    }
    if (error instanceof StructError) {
      return fail(createDecodeFault("RES_STRUCT_MISMATCH", error, meta));
    }
    return fail(createDecodeFault("RES_DECODE_FAILED", error, meta));
  } finally {
    releaseRequestTimeout();
    releaseAbortSignal(requestSignal);
  }

  const decodedResponse: DecodedResponse<unknown> = { ...meta, body: decoded };
  if (settledResponse.ok) {
    return [
      null,
      decoded as RequestSuccessData<TOutput>,
      decodedResponse as DeclaredResponse<TOutput>,
    ];
  }

  return fail(createHttpStatusFault(decodedResponse));
}

function toHttpMeta(response: HttpResponse<unknown>): HttpMeta {
  return {
    headers: response.headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  };
}

class JsonMediaTypeError extends TypeError {
  constructor(contentType: string) {
    super(`Expected a JSON media type, received ${contentType || "<none>"}`);
    this.name = "TypeError";
  }
}

function isAbsentDeclaredBody(response: HttpResponse<unknown>): boolean {
  return response.body === undefined;
}

async function decodeDeclaredBody(
  struct: AnyStruct,
  response: HttpResponse<unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const representation = resolveInboundRepresentation(struct);
  const absent = isAbsentDeclaredBody(response);
  const contentType = getContentType(response.headers);
  // The media type is checked before any read. An absent body has nothing to classify.
  if (!absent && representation === "json" && !isJsonMediaType(contentType)) {
    throw new JsonMediaTypeError(contentType);
  }
  if (absent) {
    if (representation === "text") {
      return parseStructValue(struct, "");
    }
    throw new TypeError("Response body is absent");
  }
  // Only a Blob read is asynchronous and not itself cancellable, so only it races the request signal.
  // Every other body converts synchronously, and the caller checks cancellation right after.
  if (typeof Blob !== "undefined" && response.body instanceof Blob) {
    return await awaitWithSignal(
      () => parseStructResponse(struct, response.body),
      signal,
    );
  }
  signal.throwIfAborted();
  return await parseStructResponse(struct, response.body);
}

/** Map a transport-tagged body failure onto the fault it was classified as. */
function fromBodyFailure(failure: AnyBodyFailure): AnyFault {
  const { cause, code, meta } = failure;

  if (code === "RES_DECODE_FAILED" || code === "RES_MEDIA_TYPE_INVALID") {
    return createDecodeFault(code, cause, meta);
  }

  return createPreflightFault(code, cause, meta);
}

async function parseStructResponse(
  struct: AnyStruct,
  body: unknown,
): Promise<unknown> {
  // Interceptor bodies may already be text, bytes, or a parsed value. The struct kind decides.
  // A JSON string is a string root: the transport already parsed bytes, so do not parse again.
  const responseType = resolveInboundRepresentation(struct);
  if (responseType === "json") {
    if (typeof body === "string") {
      return decodeJson(struct, body);
    }
    const text = await readBodyText(body);
    return decodeJson(struct, text === undefined ? body : JSON.parse(text));
  }
  if (responseType === "text") {
    const text = await readBodyText(body);
    return parseStructValue(struct, text ?? body);
  }
  return parseStructValue(struct, body);
}

function readBodyText(value: unknown): string | Promise<string> | undefined {
  const text = readBytesText(value);
  return (
    text ??
    (typeof Blob !== "undefined" && value instanceof Blob
      ? value.text()
      : undefined)
  );
}
