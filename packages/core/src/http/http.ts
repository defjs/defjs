import { statusOutcome } from "../internal/attempt_outcome";
import { retryBudgetFor } from "../balancer/retry_budget";
import type { Client } from "../client/client";
import { CLIENT } from "../client/client";
import type { RetryCondition, RetryOptions } from "../client/config";
import {
  computeReconnectDelay,
  wait,
  type BackoffConfig,
} from "../internal/backoff";
import { normalizeBackoffOptions } from "../internal/reconnect_options";
import type { ClientConfig } from "../client/config";
import { ERR_FETCH_UNSUPPORTED } from "../client/config";
import type { DoneInfo } from "../balancer/balancer";
import { isOffline, pickEndpoint } from "../balancer/runtime";
import type {
  AnyFault,
  DecodeFault,
  Fault,
  FaultOf,
  PreflightFault,
} from "../error";
import {
  ERR_TIMEOUT,
  createDecodeFault,
  createHttpStatusFault,
  createNetworkFault,
  createPreflightFault,
  createUndecodedHttpStatusFault,
} from "../error";
import { makeChain, resolveHttpInterceptors } from "../interceptor/interceptor";
import {
  awaitWithSignal,
  mergeAbortSignals,
  releaseAbortSignal,
  resolveAbortedCause,
  resolveAbortedFault,
  resolveAbortCause,
  resolveAbortFault,
} from "../internal/abort";
import { parseBytesBody, readBytesText } from "../internal/bytes";
import type { EndpointArgs } from "../internal/endpoint_command";
import { resolveInboundRepresentation } from "../internal/inbound_representation";
import { createTransportOrigin } from "../internal/transport_origin";
import { RequestUrlError, resolveRequestUrl } from "../internal/url";
import type { EndpointInput } from "../internal/endpoint_input";
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
import { BodyFailure, isBodyFailure } from "./transport/body_failure";
import {
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  fetchHandlerWithLifecycle,
} from "./transport/fetch";
import { isReadableStreamBody } from "./transport/fetch_init";
import { getContentType, isJsonMediaType } from "./transport/utils";

/**
 * HTTP fields of {@link RequestOptions}: progress callbacks and `signal`.
 *
 * `onDownloadProgress` and `onUploadProgress` are {@link HttpProgressFn}
 * callbacks. They receive an {@link HttpProgressEvent} with `loaded`, `total`,
 * and `lengthComputable`. Other request fields are ignored by HTTP.
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
};

/**
 * HTTP fields read from {@link RequestOptions} for one call.
 *
 * Progress callbacks and `signal`. There is no `timeout` or `abort`.
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
 * `error` structs. Call the returned operation with a client and, when declared, the input.
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
 * Known fields are copied when the definition is created. `builder`, `input`, `output`, and `error` keep their identity. A getter on one of those fields runs during `defineRequest` and its exception escapes the call. Other properties on the definition object are not read.
 *
 * @param definition - Request contract (method, path, input, builder, output).
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
    operation?: string;
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
  const operation = definition.operation;
  const path = definition.path;
  const output = definition.output;
  const error = definition.error;
  const endpoint = {
    builder,
    error,
    input,
    method,
    operation,
    output,
    path,
  };

  return async (client: Client, input?: EndpointInput<TInput>) =>
    executeHttpCommand<TInput, TOutput, TError>(
      client[CLIENT].config,
      endpoint,
      input,
      client[CLIENT].options,
    );
}

type HttpExecutionDefinition<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
> = Omit<RequestDefinition<TInput>, "output" | "error"> & {
  output?: TOutput;
  error?: TError;
};

type RetryAttempt = {
  methods?: string[];
  endpoint?: string;
  info?: DoneInfo;
  replayable: boolean;
  timedOut: boolean;
  /** No endpoint could be used: the pick failed or the selected URL did not resolve. */
  unselected?: boolean;
};

async function executeHttpCommand<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  definition: HttpExecutionDefinition<TInput, TOutput, TError>,
  input: EndpointInput<TInput> | undefined,
  options: HttpExecuteOptions | undefined,
): Promise<HttpExecuteAwaitResult<TOutput, TError>> {
  let retry:
    | undefined
    | Error
    | {
        policy: Exclude<
          ReturnType<typeof normalizeRetryOptions>,
          undefined | Error
        >;
        budget: ReturnType<typeof retryBudgetFor>;
      };
  try {
    const policy = normalizeRetryOptions(clientConfig.http.retry);
    retry =
      policy === undefined || policy instanceof Error
        ? policy
        : { policy, budget: retryBudgetFor(clientConfig) };
  } catch {
    retry = new RangeError("Invalid retry options");
  }
  if (retry instanceof Error) {
    return [
      createPreflightFault("REQ_OPTIONS_INVALID", retry),
      undefined,
      undefined,
    ];
  }
  if (retry === undefined) {
    return executeHttpAttempt(
      clientConfig,
      definition,
      input,
      options,
      clientConfig.endpoints,
      { replayable: true, timedOut: false },
      undefined,
    );
  }
  const { policy, budget } = retry;
  if (budget instanceof Error)
    return [
      createPreflightFault(
        "REQ_OPTIONS_INVALID",
        new RangeError("Invalid retry options"),
      ),
      undefined,
      undefined,
    ];
  budget.deposit();
  const { maxAttempts, on, methods, attemptTimeoutMs } = policy;
  let candidates = clientConfig.endpoints;
  let previous: HttpExecuteAwaitResult<TOutput, TError> | undefined;
  for (let index = 0; ; index++) {
    const state: RetryAttempt = { replayable: true, timedOut: false };
    const result = await executeHttpAttempt(
      clientConfig,
      definition,
      input,
      options,
      candidates,
      state,
      attemptTimeoutMs,
    );
    // A retry that could not use any endpoint has nothing new to report; the attempt that failed is the outcome.
    if (previous !== undefined && state.unselected === true) return previous;
    previous = result;
    const condition = retryCondition(state, result[0]);
    candidates = candidates.filter((endpoint) => endpoint !== state.endpoint);
    const sentMethods = state.methods ?? [definition.method];
    const allowed =
      condition !== undefined &&
      on.includes(condition) &&
      sentMethods.every(
        (sent) =>
          typeof sent === "string" &&
          methods.some((method) => method.toUpperCase() === sent.toUpperCase()),
      );
    const stopped =
      index + 1 >= maxAttempts ||
      !state.replayable ||
      options?.signal?.aborted ||
      isOffline();
    if (
      !allowed ||
      stopped ||
      state.endpoint === undefined ||
      candidates.length === 0 ||
      !budget.tryWithdraw()
    )
      return result;
    const delay = computeReconnectDelay(policy, index + 1);
    if (delay > 0) {
      const signal = options?.signal ?? new AbortController().signal;
      try {
        await wait(delay, signal);
      } catch {
        return [resolveAbortedFault(signal), undefined, undefined];
      }
    }
  }
}

// Typed as unknown so runtime entries from untyped callers can be tested for membership.
const RETRY_CONDITIONS: readonly unknown[] = [
  "connect-failure",
  "gateway-error",
  "attempt-timeout",
] satisfies readonly RetryCondition[];

function normalizeRetryOptions(
  policy: RetryOptions | undefined,
):
  | (Required<Pick<RetryOptions, "maxAttempts" | "on" | "methods">> &
      Pick<RetryOptions, "attemptTimeoutMs"> &
      BackoffConfig)
  | undefined
  | Error {
  if (policy === undefined) return undefined;
  if (policy === null || typeof policy !== "object" || Array.isArray(policy))
    return new RangeError("Invalid retry options");
  const { maxAttempts = 2 } = policy;
  const on = policy.on ?? ["connect-failure"];
  const methods = policy.methods ?? ["GET", "HEAD", "OPTIONS", "TRACE"];
  const attemptTimeoutMs = policy.attemptTimeoutMs;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    !Array.isArray(on) ||
    on.some((value: unknown) => !RETRY_CONDITIONS.includes(value)) ||
    !Array.isArray(methods) ||
    methods.some((value) => typeof value !== "string" || value.length === 0) ||
    (attemptTimeoutMs !== undefined &&
      (!Number.isFinite(attemptTimeoutMs) ||
        attemptTimeoutMs <= 0 ||
        attemptTimeoutMs > 2_147_483_647))
  ) {
    return new RangeError("Invalid retry options");
  }
  try {
    const backoff = normalizeBackoffOptions(
      policy,
      { delayMs: 25, factor: 2, jitter: 0.2, maxDelayMs: 250 },
      "HTTP retry",
    );
    return { maxAttempts, on, methods, attemptTimeoutMs, ...backoff };
  } catch {
    return new RangeError("Invalid retry options");
  }
}

function retryCondition(
  state: RetryAttempt,
  fault: AnyFault | null,
): RetryCondition | undefined {
  if (state.timedOut && fault?.code === "NET_TIMEOUT") return "attempt-timeout";
  const info = state.info;
  if (info?.code === "NET_UNREACHABLE" && fault?.code === "NET_UNREACHABLE")
    return "connect-failure";
  if (
    (fault?.code === "HTTP_STATUS" || fault?.code.startsWith("RES_")) &&
    info?.code === "NET_UNAVAILABLE"
  )
    return "gateway-error";
  return undefined;
}

async function executeHttpAttempt<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  definition: HttpExecutionDefinition<TInput, TOutput, TError>,
  input: EndpointInput<TInput> | undefined,
  options: HttpExecuteOptions | undefined,
  candidates: readonly string[],
  state: RetryAttempt,
  attemptTimeoutMs: number | undefined,
): Promise<HttpExecuteAwaitResult<TOutput, TError>> {
  const config = options;

  // Faults carry their own response metadata, so the tuple's third slot belongs to success only.
  const fail = (
    fault: Fault<TError>,
  ): HttpExecuteAwaitResult<TOutput, TError> => [fault, undefined, undefined];

  const callerAbort = config?.signal;

  // Fast path: caller already aborted before we did any struct work — skip parseEndpointInput.
  if (callerAbort?.aborted) {
    return fail(resolveAbortedFault(callerAbort));
  }

  // A declaration that is not a struct throws here, before the caller's signal gets a listener.
  // Read a status class only when that side declared a struct, using that side's kind.
  // The other side is cancelled unread. A transport fault while reading a declared side still surfaces.
  const responseType = definition.output
    ? resolveInboundRepresentation(definition.output)
    : undefined;
  const errorResponseType = definition.error
    ? resolveInboundRepresentation(definition.error)
    : undefined;

  const controller = new AbortController();
  // A caller signal still goes through a composite: listeners must never be left on a signal the caller keeps.
  const requestSignal = mergeAbortSignals(controller.signal, [callerAbort]);
  const stopBeforeTransport = (
    fault: PreflightFault,
  ): HttpExecuteAwaitResult<TOutput, TError> => {
    releaseAbortSignal(requestSignal);
    return fail(fault);
  };

  const inputGuides = new WeakMap<object, Guide>();
  let parsedInput: unknown;
  try {
    parsedInput = definition.input
      ? parseEndpointInput(definition.input, input, inputGuides)
      : input;
  } catch (error) {
    return stopBeforeTransport(
      resolveAbortFault(requestSignal) ??
        createPreflightFault("REQ_INPUT_INVALID", error),
    );
  }

  const parsedCancellation = resolveAbortFault(requestSignal);
  if (parsedCancellation) {
    return stopBeforeTransport(parsedCancellation);
  }

  const picked = pickEndpoint(clientConfig.balancer, {
    endpoints: candidates,
    ...(candidates === clientConfig.endpoints
      ? {}
      : { members: clientConfig.endpoints }),
    operation: definition.operation,
  });
  if (picked[0] !== null) {
    state.unselected = true;
    return stopBeforeTransport(picked[0]);
  }
  const resolved = picked[1];
  // Each send to the selected endpoint has its own timer; interceptor work and decoding are not timed.
  const sendTimers = new Set<ReturnType<typeof setTimeout>>();
  let sending = 0;
  let abortedWhileSending = false;
  state.endpoint = resolved.endpoint;

  // One pick for every next(). The last matching attempt wins, even if an earlier one settles later.
  let attempt: HttpAttempt | undefined;
  let attemptSeq = 0;
  let appliedSeq = 0;
  let finalFault: AnyFault | null | undefined;
  const finish = (fault: AnyFault | null) => {
    finalFault = fault;
  };
  const remember = (seq: number, next: HttpAttempt) => {
    if (seq < appliedSeq) {
      return;
    }
    appliedSeq = seq;
    attempt = next;
  };

  try {
    let request;
    try {
      request = createHttpRequest(
        definition.method,
        definition.path,
        parsedInput,
        definition.builder,
        {
          signal: requestSignal,
          baseEndpoint: resolved.endpoint,
          defaultHeaders: clientConfig.headers,
          downloadProgress: config?.onDownloadProgress,
          inputDeclared: definition.input !== undefined,
          inputGuides,
          errorResponseType,
          operation: definition.operation,
          querySerializer: clientConfig.querySerializer,
          responseType,
          uploadProgress: config?.onUploadProgress,
          withCredentials: clientConfig.withCredentials,
          finalizeHeaders: clientConfig.finalizeHeaders,
        },
      );
    } catch (error) {
      const fault =
        resolveAbortFault(requestSignal) ??
        createPreflightFault("REQ_BUILD_FAILED", error);
      if (error instanceof RequestUrlError) state.unselected = true;
      finish(fault);
      return stopBeforeTransport(fault);
    }

    state.replayable = !isReadableStreamBody(request.body);
    const builtCancellation = resolveAbortFault(requestSignal);
    if (builtCancellation) {
      finish(builtCancellation);
      return stopBeforeTransport(builtCancellation);
    }

    const transportOrigin = createTransportOrigin();
    // A failure found before the request is sent is shown to interceptors as the error that caused it, so they and
    // any tracing around them never see a library class. This remembers which fault such an error stands for.
    // An object matches by identity. A primitive a hook threw matches by value, so an interceptor that throws an
    // equal primitive after next() rejected with it is given the hook's code, the same trade-off createTransportOrigin makes.
    const localFailures = new Map<unknown, AnyBodyFailure>();
    // One controller per send, so stopping a live send never reaches one whose upload body already failed.
    const liveTransports = new Set<AbortController>();
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

      const matches = nextRequest.baseEndpoint === resolved.endpoint;
      const seq = matches ? ++attemptSeq : 0;
      const note = (next: HttpAttempt) => {
        if (matches) {
          remember(seq, next);
        }
      };
      const reject = (error: unknown): Promise<HttpResponse<unknown>> => {
        const rejected = Promise.reject<HttpResponse<unknown>>(error);
        void rejected.catch(() => undefined);
        return rejected;
      };

      const transportController = new AbortController();
      if (requestSignal.aborted) {
        transportController.abort(requestSignal.reason);
      }
      let transportAbort: AbortSignal;
      try {
        resolveRequestUrl(nextRequest);
        // Headers rejects an invalid name or value with a TypeError. Checking here makes that a request that cannot be
        // built, not a NET_UNREACHABLE that only surfaces once the transport builds its own Headers.
        try {
          void new Headers(nextRequest.headers);
        } catch (error) {
          localFailures.set(
            error,
            new BodyFailure("REQ_BUILD_FAILED", error, undefined),
          );
          throw error;
        }
        // transportController already follows requestSignal through abortTransport. Only an interceptor that
        // swapped the signal needs a composite, which is expensive to build and to listen on.
        transportAbort =
          nextRequest.signal === undefined ||
          nextRequest.signal === requestSignal
            ? transportController.signal
            : mergeAbortSignals(transportController.signal, [
                nextRequest.signal,
              ]);
      } catch (error) {
        note({ landed: false });
        return reject(error);
      }
      const due = resolveAbortFault(transportAbort);
      if (due) {
        // Already aborted: fetch never starts, so this next() did not reach the endpoint.
        note({ landed: false });
        const rejected = reject(
          transportOrigin.mark(resolveAbortedCause(transportAbort)),
        );
        releaseAbortSignal(transportAbort);
        return rejected;
      }
      liveTransports.add(transportController);
      if (isReadableStreamBody(nextRequest.body)) state.replayable = false;
      let started = false;
      let streamedBody = false;
      let bodyFailed = false;
      let sendTimer: ReturnType<typeof setTimeout> | undefined;
      // Runs once: the fulfilled and rejected handlers below are exclusive.
      const settleSend = () => {
        if (!matches || !started) return;
        sending -= 1;
        if (sendTimer !== undefined) {
          clearTimeout(sendTimer);
          sendTimers.delete(sendTimer);
        }
      };
      const pending = fetchHandlerWithLifecycle(
        {
          ...nextRequest,
          signal: transportAbort,
        },
        clientConfig.http.handle,
        {
          start(streamed) {
            started = true;
            streamedBody = streamed;
            (state.methods ??= []).push(nextRequest.method);
            if (!matches) return;
            resolved.start();
            sending += 1;
            if (attemptTimeoutMs !== undefined) {
              sendTimer = setTimeout(() => {
                state.timedOut = true;
                controller.abort(ERR_TIMEOUT);
              }, attemptTimeoutMs);
              sendTimers.add(sendTimer);
            }
          },
          response(response) {
            if (matches)
              resolved.end({
                attempted: true,
                status: response.status,
                code: statusOutcome(response.status),
              });
          },
          bodyFailed() {
            bodyFailed = true;
          },
        },
      )
        .then(
          (settled) => {
            settleSend();
            note({
              landed: true,
              info: {
                attempted: true,
                status: settled.status,
                code: statusOutcome(settled.status),
              },
            });
            return settled;
          },
          (error: unknown) => {
            settleSend();
            const classified = classifyHttpAttempt(
              error,
              started,
              streamedBody,
            );
            if (matches)
              resolved.end(
                httpAttemptDone(
                  classified,
                  createNetworkFault(
                    resolveAbortCause(transportAbort) ?? error,
                  ),
                  true,
                ),
              );
            note(classified);
            // Cancellation outranks whatever the transport was doing when it noticed. Tagging here is
            // the only way to tell a dead server from an interceptor that threw the same value: both
            // reach the chain's catch as one bare cause.
            const surfaced = resolveAbortCause(transportAbort) ?? error;
            if (isLocalFailure(surfaced)) {
              localFailures.set(surfaced.cause, surfaced);
              throw transportOrigin.mark(surfaced.cause);
            }
            throw transportOrigin.mark(surfaced);
          },
        )
        .finally(() => {
          // A body that already failed leaves nothing to stop, and Chromium reports an abort after that as an
          // unhandled rejection. Every other send still needs the abort to release its body, so it keeps its signal.
          if (bodyFailed) {
            liveTransports.delete(transportController);
            releaseAbortSignal(transportAbort);
          }
        });
      inflightTransport = pending;
      return pending;
    };

    const abortLiveTransports = (reason: unknown) => {
      for (const transport of liveTransports) {
        transport.abort(reason);
      }
    };
    const abortTransport = () => {
      abortedWhileSending = sending > 0;
      abortLiveTransports(requestSignal.reason);
    };
    try {
      try {
        const httpInterceptors = resolveHttpInterceptors(
          clientConfig.interceptors,
        );
        const chain = makeChain(httpInterceptors);
        // A signal that is already aborted fires nothing here; each send checks it when it starts.
        requestSignal.addEventListener("abort", abortTransport, { once: true });

        const chainPromise = chain(request, handler);
        void chainPromise.catch(() => undefined);
        const settled = await awaitWithSignal(
          () => chainPromise,
          requestSignal,
        );
        // Interceptors are user code, and only an HttpResponse carries the `ok` fork the pipeline reads next.
        // `response` stays unset on failure so the finally block still releases the signal.
        if (!isHttpResponse(settled)) {
          throw new TypeError(
            "HTTP interceptor must resolve an HttpResponse from next() or makeResponse()",
          );
        }
        response = settled;
      } catch (error) {
        const fromTransport = transportOrigin.has(error);
        const cancelled = resolveAbortFault(requestSignal);
        if (cancelled) {
          abortTransport();
          if (inflightTransport) {
            await Promise.allSettled([inflightTransport]);
          }
          finish(cancelled);
          return fail(cancelled);
        }
        if (error instanceof RequestUrlError) {
          const fault = createPreflightFault("REQ_BUILD_FAILED", error);
          finish(fault);
          return fail(fault);
        }
        // The transport only reads a side that declared a struct, so a tagged body failure belongs to that side.
        // Failures before the request is sent (upload observer, finalizeHeaders, a used body stream) are also tagged, without response metadata.
        const failure = isBodyFailure(error) ? error : localFailures.get(error);
        if (failure) {
          const fault = fromBodyFailure(failure);
          finish(fault);
          return fail(fault);
        }
        if (
          fromTransport &&
          (error === ERR_STREAMING_REQUEST_UNSUPPORTED ||
            error === ERR_FETCH_UNSUPPORTED)
        ) {
          const fault = createPreflightFault("ENV_UNSUPPORTED", error);
          finish(fault);
          return fail(fault);
        }
        // Recognized cancellation shapes stay cancellation wherever they came from; anything else
        // belongs to whoever produced it.
        const networkFault = createNetworkFault(error);
        if (networkFault.code !== "NET_UNREACHABLE") {
          finish(networkFault);
          return fail(networkFault);
        }
        const fault = fromTransport
          ? networkFault
          : createPreflightFault("EXT_INTERCEPTOR_FAILED", error);
        finish(fault);
        return fail(fault);
      }
    } finally {
      requestSignal.removeEventListener("abort", abortTransport);
      chainSettled = true;
      abortLiveTransports(new Error("HTTP interceptor chain settled"));
      // Keep the caller signal armed while a declared body is still being converted.
      if (!response) {
        releaseAbortSignal(requestSignal);
      }
    }

    const settledResponse = response;
    const meta = toHttpMeta(settledResponse);

    // Philosophy 2: `ok` is the only fork, and only one side ever decodes.
    const struct = settledResponse.ok ? definition.output : definition.error;

    // Philosophy 5: with nothing declared for this side, that body is never read — not even to
    // fail on. An unreadable representation on the side you opted out of is none of your business.
    // A caller abort during interceptor work is reported before this point. An undecoded status has no body to cancel.
    if (!struct) {
      releaseAbortSignal(requestSignal);
      if (settledResponse.ok) {
        finish(null);
        return [
          null,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unnecessary-type-assertion -- INTENT: the published RequestSuccessData<TOutput> is a conditional on the caller's generic TOutput that the runtime `!struct` check cannot narrow. Unasserted: TS2322, `undefined` is not assignable to `DeclaredBody<TOutput>`; bun lint reads the deferred conditional as undefined and calls the assertion unnecessary. Typing the internal result as unknown instead fails at defineRequest's published RequestEndpoint return (TS2322)
          undefined as RequestSuccessData<TOutput>,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: with no output struct the response is the HttpMeta itself, but the published DeclaredResponse<TOutput> is a conditional on the caller's generic TOutput. Unasserted: TS2322, `HttpMeta` is not assignable to `DeclaredResponse<TOutput>`
          meta as DeclaredResponse<TOutput>,
        ];
      }
      const fault = createUndecodedHttpStatusFault(meta);
      finish(fault);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: with no `error` struct the published Fault<TError> data is ErrorBody<TError>, a conditional on the caller's generic TError that the runtime `!struct` check cannot narrow. Unasserted: TS2345, `undefined` is not assignable to `ErrorBody<TError>`. Typing this internal result as AnyFault instead fails at defineRequest's published RequestEndpoint return (TS2322, AnyFault is not FaultOf<DeclaredBody<TError>>)
      return fail(fault as Fault<TError>);
    }

    let decoded: unknown;
    try {
      decoded = await decodeDeclaredBody(
        struct,
        settledResponse,
        requestSignal,
      );
    } catch (error) {
      // A caller abort wins over a conversion fault.
      const cancelled = resolveAbortFault(requestSignal);
      if (cancelled) {
        finish(cancelled);
        return fail(cancelled);
      }
      // Philosophy 3 + 4: representation failures are not struct mismatches, and a failed decode has no body.
      const fault =
        error instanceof JsonMediaTypeError
          ? createDecodeFault("RES_MEDIA_TYPE_INVALID", error, meta)
          : error instanceof StructError
            ? createDecodeFault("RES_STRUCT_MISMATCH", error, meta)
            : createDecodeFault("RES_DECODE_FAILED", error, meta);
      finish(fault);
      return fail(fault);
    } finally {
      releaseAbortSignal(requestSignal);
    }

    const decodedResponse: DecodedResponse<unknown> = {
      ...meta,
      body: decoded,
    };
    if (settledResponse.ok) {
      finish(null);
      return [
        null,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: decodeDeclaredBody parsed `decoded` with definition.output, but the published RequestSuccessData<TOutput> is a conditional on the caller's generic TOutput. Unasserted: TS2322, `unknown` is not assignable to `DeclaredBody<TOutput>`
        decoded as RequestSuccessData<TOutput>,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: same decoded body inside the published DeclaredResponse<TOutput> conditional. Unasserted: TS2322, `DecodedResponse<unknown>` is not assignable to `DeclaredResponse<TOutput>`
        decodedResponse as DeclaredResponse<TOutput>,
      ];
    }

    const fault = createHttpStatusFault(decodedResponse);
    finish(fault);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: `data` was decoded with definition.error, but the published Fault<TError> types it as ErrorBody<TError>, a conditional on the caller's generic TError. Unasserted: TS2345, `unknown` is not assignable to `ErrorBody<TError>`. Typing this internal result as AnyFault instead fails at defineRequest's published RequestEndpoint return (TS2322)
    return fail(fault as Fault<TError>);
  } finally {
    for (const timer of sendTimers) clearTimeout(timer);
    state.info = httpAttemptDone(attempt, finalFault, abortedWhileSending);
    resolved.done(state.info);
  }
}

type HttpAttempt = {
  landed: boolean;
  info?: DoneInfo;
};

/** Map a fetchHandler rejection onto the attempt that reached the selected endpoint. */
function classifyHttpAttempt(
  error: unknown,
  started: boolean,
  streamedBody: boolean,
): HttpAttempt {
  if (
    !started ||
    error === ERR_FETCH_UNSUPPORTED ||
    error === ERR_STREAMING_REQUEST_UNSUPPORTED
  ) {
    return { landed: false };
  }
  if (isBodyFailure(error)) {
    if (error.code === "NET_BODY_INCOMPLETE") {
      return {
        landed: true,
        info: {
          attempted: true,
          code: "NET_BODY_INCOMPLETE",
          status: error.meta.status,
        },
      };
    }
    if (
      error.code === "RES_DECODE_FAILED" ||
      error.code === "RES_MEDIA_TYPE_INVALID"
    ) {
      return {
        landed: true,
        info: {
          attempted: true,
          status: error.meta.status,
          code: statusOutcome(error.meta.status),
        },
      };
    }
    if (error.meta === undefined) {
      return { landed: false };
    }
    return {
      landed: true,
      info: {
        attempted: true,
        status: error.meta.status,
        code: statusOutcome(error.meta.status),
      },
    };
  }
  if (createNetworkFault(error).code === "NET_UNREACHABLE") {
    // With a streamed request body, fetch rejects with the same network error whether the endpoint is
    // down, the connection is HTTP/1.x, a redirect cannot replay the stream, a CORS preflight failed,
    // or the body source itself threw. None of these shows the endpoint is down, so none is attributed.
    if (streamedBody) {
      return { landed: false };
    }
    return {
      landed: true,
      info: { attempted: true, code: "NET_UNREACHABLE" },
    };
  }
  // Timeout and abort are decided from the call's final fault, which can replace a status.
  return { landed: true };
}

/**
 * Fold the transport note and the call's final fault into the one `done` report.
 *
 * No landed attempt is `{ attempted: false }`, including a timeout that fired
 * before fetch. A call that ends as `NET_TIMEOUT` while a send to the endpoint
 * was in flight reports `NET_TIMEOUT` and drops any status already noted; a
 * timeout during interceptor work after the send settled keeps the endpoint's
 * own outcome. `NET_ABORTED` is never an attempt.
 */
function httpAttemptDone(
  attempt: HttpAttempt | undefined,
  fault: AnyFault | null | undefined,
  abortedWhileSending: boolean,
): DoneInfo {
  if (fault?.code === "NET_ABORTED") {
    return { attempted: false };
  }
  if (
    attempt?.landed === true &&
    fault?.code === "NET_TIMEOUT" &&
    abortedWhileSending
  ) {
    return { attempted: true, code: "NET_TIMEOUT" };
  }
  return attempt?.info ?? { attempted: false };
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

async function decodeDeclaredBody<S extends AnyStruct>(
  struct: S,
  response: HttpResponse<unknown>,
  signal: AbortSignal,
): Promise<Infer<S>> {
  const representation = resolveInboundRepresentation(struct);
  const contentType = getContentType(response.headers);
  // The media type is checked first, before the body is looked at or read, so a response without
  // content (HEAD, 204, 205, 304) is held to the declaration like any other.
  if (representation === "json" && !isJsonMediaType(contentType)) {
    throw new JsonMediaTypeError(contentType);
  }
  if (isAbsentDeclaredBody(response)) {
    // Fetch reads an absent body as zero bytes. JSON parses them like any other bytes and fails.
    return parseStructValue(
      struct,
      parseBytesBody(representation, new Uint8Array(0), contentType),
    );
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

/** A request refused before it was sent: the hook or platform error behind it is what interceptors are shown. */
function isLocalFailure(
  value: unknown,
): value is BodyFailure<"EXT_HOOK_FAILED" | "REQ_BUILD_FAILED"> {
  return (
    isBodyFailure(value) &&
    (value.code === "EXT_HOOK_FAILED" || value.code === "REQ_BUILD_FAILED")
  );
}

/** Map a transport-tagged body failure onto the fault it was classified as. */
function fromBodyFailure(
  failure: AnyBodyFailure,
): DecodeFault | PreflightFault {
  const { cause, code, meta } = failure;

  if (code === "RES_DECODE_FAILED" || code === "RES_MEDIA_TYPE_INVALID") {
    return createDecodeFault(code, cause, meta);
  }

  return createPreflightFault(code, cause, meta);
}

async function parseStructResponse<S extends AnyStruct>(
  struct: S,
  body: unknown,
): Promise<Infer<S>> {
  // Interceptor bodies may already be text, bytes, or a parsed value. The struct kind decides.
  // A JSON string is a string root: the transport already parsed bytes, so do not parse again.
  const responseType = resolveInboundRepresentation(struct);
  if (responseType === "json") {
    if (typeof body === "string") {
      return decodeJson(struct, body);
    }
    const text = await readBodyText(body);
    const value: unknown = text === undefined ? body : JSON.parse(text);
    return decodeJson(struct, value);
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
