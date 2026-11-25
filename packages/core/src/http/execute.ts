import { isOffline, pickEndpoint } from "../balancer/runtime";
import { retryBudgetFor } from "../balancer/retry_budget";
import type { Client } from "../client/client";
import { CLIENT } from "../client/client";
import type { ClientConfig } from "../client/config";
import type { AnyFault, PreflightFault } from "../error";
import { createPreflightFault } from "../error";
import { makeChain, resolveHttpInterceptors } from "../interceptor/interceptor";
import {
  awaitWithSignal,
  resolveAbortedFault,
  resolveAbortFault,
} from "../internal/abort";
import { computeReconnectDelay, wait } from "../internal/backoff";
import { generateCorrelationId } from "../internal/correlation_id";
import type { EndpointInput } from "../internal/endpoint_input";
import type { HttpRequest, HttpResponseType } from "./http_request";
import type { HttpResponse } from "./http_response";
import { failed } from "./http_response";
import { resolveInboundRepresentation } from "../internal/inbound_representation";
import { preflight, preflightDirect } from "../internal/preflight";
import type { RetryPolicy } from "../internal/retry";
import {
  isRetryMethod,
  resolveRetryPolicy,
  retryStep,
} from "../internal/retry";
import {
  computeRetryAfterDelay,
  parseRetryAfter,
} from "../internal/retry_after";
import { statusOutcome } from "../internal/attempt_outcome";
import { RequestUrlError, type CompiledPathTemplate } from "../internal/url";
import type { AnyStruct } from "../struct";
import { decodeDirectResponse, decodeResponse } from "./decode";
import type {
  HttpExecuteAwaitResult,
  HttpExecuteOptions,
  RequestDefinition,
} from "./http";
import { buildDirectHttpRequest, prepareHttpRequest } from "./request";
import type { Attempt } from "./send";
import {
  abortSends,
  attemptReport,
  foreignFault,
  hasSettleableSends,
  isSending,
  NOT_ATTEMPTED,
  resolveFailureInfo,
  send,
  transportFault,
} from "./send";
import { fetchHandlerWithLifecycle } from "./transport/fetch";
import { isReadableStreamBody } from "./transport/fetch_init";

type HttpExecutionDefinition<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
> = Omit<RequestDefinition<TInput>, "output" | "error"> & {
  output?: TOutput;
  error?: TError;
  readonly pathTemplate?: CompiledPathTemplate;
};

/** What the retry policy is shown of a failed attempt that it may retry. */
interface RetryFacts {
  /** The failure is a timeout, no response, or a status in `statusCodes`; the methods sent decide the rest, once a retry is on the table. */
  readonly retryable: boolean;
  /** Every method sent in the attempt, for the policy's method list. */
  readonly methods: readonly string[];
  readonly status: number | undefined;
  readonly headers: Headers | undefined;
  readonly retryAfterMs: number | undefined;
  /** The method of the last request sent; the defined method until one is sent. */
  readonly method: string;
  readonly endpoint: string;
}

interface AttemptResult<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
> {
  readonly result: HttpExecuteAwaitResult<TOutput, TError>;
  /** No endpoint could be used: the pick failed or the selected URL did not resolve. */
  readonly unselected: boolean;
  /** Set only when the policy can ask whether to retry; see `retryFacts`. */
  readonly retry: RetryFacts | undefined;
}

interface DirectRetryState {
  readonly policy: RetryPolicy;
  readonly attempt: number;
  unselected: boolean;
  facts: RetryFacts | undefined;
}

function unwrapAttemptResult<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  attempt: AttemptResult<TOutput, TError>,
): HttpExecuteAwaitResult<TOutput, TError> {
  return attempt.result;
}

/** Runs the operation once, or as often as the retry policy asks. */
export function executeHttp<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  client: Client,
  definition: HttpExecutionDefinition<TInput, TOutput, TError>,
  input: EndpointInput<TInput> | undefined,
): Promise<HttpExecuteAwaitResult<TOutput, TError>> {
  const clientConfig = client[CLIENT].config;
  const options = client[CLIENT].options;
  const policy = resolveRetryPolicy(options?.retry ?? clientConfig.retry);
  const direct =
    clientConfig.interceptors.length === 0 &&
    options?.signal === undefined &&
    clientConfig.finalizeHeaders === undefined;
  // PERF: no policy means one attempt: no loop, no budget, no signal for the waits.
  if (policy === undefined) {
    if (direct) {
      return runDirectHttp(clientConfig, definition, input, options);
    }
    return attemptHttpGuarded(
      clientConfig,
      definition,
      input,
      options,
      undefined,
      generateCorrelationId(),
      0,
    ).then(unwrapAttemptResult);
  }

  return executeHttpWithRetry(
    clientConfig,
    definition,
    input,
    options,
    policy,
    direct,
  );
}

async function executeHttpWithRetry<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  definition: HttpExecutionDefinition<TInput, TOutput, TError>,
  input: EndpointInput<TInput> | undefined,
  options: HttpExecuteOptions | undefined,
  policy: RetryPolicy,
  direct: boolean,
): Promise<HttpExecuteAwaitResult<TOutput, TError>> {
  const correlationId = direct ? undefined : generateCorrelationId();
  const budget = retryBudgetFor(clientConfig);
  budget.deposit();
  const signal = options?.signal ?? new AbortController().signal;
  let previous: HttpExecuteAwaitResult<TOutput, TError> | undefined;
  for (let retried = 0; ; retried++) {
    let attempt: AttemptResult<TOutput, TError>;
    if (direct && policy.attemptTimeoutMs === undefined) {
      const retryState: DirectRetryState = {
        policy,
        attempt: retried,
        unselected: false,
        facts: undefined,
      };
      const result = await runDirectHttp(
        clientConfig,
        definition,
        input,
        options,
        retryState,
      );
      attempt = {
        result,
        unselected: retryState.unselected,
        retry: retryState.facts,
      };
    } else {
      attempt = await attemptHttpGuarded(
        clientConfig,
        definition,
        input,
        options,
        policy,
        correlationId,
        retried,
      );
    }
    // A retry that could not use any endpoint has nothing new to report; the attempt that failed is the outcome.
    if (previous !== undefined && attempt.unselected) return previous;
    previous = attempt.result;
    const facts = attempt.retry;
    if (facts === undefined || signal.aborted || isOffline()) {
      return attempt.result;
    }
    if (
      facts.retryAfterMs !== undefined &&
      facts.retryAfterMs > policy.maxRetryAfterMs
    ) {
      return attempt.result;
    }
    const step = await retryStep(policy, retried, signal, (number) => ({
      transport: "http",
      attempt: number,
      cause: attempt.result[0],
      retryable:
        facts.retryable &&
        facts.methods.every((sent) => isRetryMethod(policy, sent)),
      method: facts.method,
      endpoint: facts.endpoint,
      status: facts.status,
      headers: facts.headers,
      retryAfterMs: facts.retryAfterMs,
    }));
    if (step !== "retry") {
      return step === "stop" ? attempt.result : failed(step);
    }
    if (!budget.tryWithdraw()) return attempt.result;
    const delay =
      facts.retryAfterMs !== undefined
        ? computeRetryAfterDelay(
            facts.retryAfterMs,
            policy.jitter,
            policy.maxRetryAfterMs,
          )
        : computeReconnectDelay(policy, retried + 1);
    if (delay > 0) {
      try {
        await wait(delay, signal);
      } catch {
        return failed(resolveAbortedFault(signal));
      }
    }
  }
}

/**
 * One guarded attempt: the endpoint pick, the request, the interceptor chain, the decoded response, and the report to
 * the balancer. The balancer's `done` and the release of the caller's signal each happen exactly once, in a `finally`.
 */
async function attemptHttpGuarded<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  definition: HttpExecutionDefinition<TInput, TOutput, TError>,
  input: EndpointInput<TInput> | undefined,
  options: HttpExecuteOptions | undefined,
  policy: RetryPolicy | undefined,
  correlationId: string | undefined,
  retryAttempt: number,
): Promise<AttemptResult<TOutput, TError>> {
  const scope = preflight(definition.input, input, options?.signal);
  if (scope instanceof Error) {
    return { result: failed(scope), unselected: false, retry: undefined };
  }
  try {
    // Read a status class only when that side declared a struct, using that side's kind.
    // The other side is cancelled unread. A transport fault while reading a declared side still surfaces.
    const responseType = definition.output
      ? resolveInboundRepresentation(definition.output)
      : undefined;
    const errorResponseType = definition.error
      ? resolveInboundRepresentation(definition.error)
      : undefined;

    const picked = pickEndpoint(clientConfig.balancer, {
      endpoints: clientConfig.endpoints,
      meta: definition.meta,
    });
    if (picked[0] !== null) {
      return { result: failed(picked[0]), unselected: true, retry: undefined };
    }
    const attempt: Attempt = {
      scope,
      endpoint: picked[1],
      handle: clientConfig.http.handle,
      timeoutMs: policy?.attemptTimeoutMs,
      sends: [],
      methods: [],
      method: definition.method,
      faults: undefined,
      settled: false,
      replayable: true,
      timedOut: false,
      abortedWhileSending: false,
      unselected: false,
      info: NOT_ATTEMPTED,
    };

    try {
      const request = buildRequest(
        attempt,
        clientConfig,
        definition,
        options,
        responseType,
        errorResponseType,
        correlationId,
        retryAttempt,
      );
      const result: HttpExecuteAwaitResult<TOutput, TError> =
        request instanceof Error
          ? failed(request)
          : await runChain(attempt, clientConfig, definition, request);
      attempt.info = attemptReport(attempt, result[0]?.code);
      return {
        result,
        unselected: attempt.unselected,
        retry:
          policy === undefined
            ? undefined
            : retryFacts(attempt, result[0], policy),
      };
    } finally {
      for (const record of attempt.sends) {
        if (record.timer !== undefined) clearTimeout(record.timer);
        record.unlink?.();
      }
      attempt.endpoint.done(attempt.info);
    }
  } finally {
    scope.release();
  }
}

/** Direct single-send HTTP execution bypassing chain allocation, abort listeners, duplicate URL parsing, and extra microtasks. */
async function runDirectHttp<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  definition: HttpExecutionDefinition<TInput, TOutput, TError>,
  input: EndpointInput<TInput> | undefined,
  options: HttpExecuteOptions | undefined,
  retryState?: DirectRetryState,
): Promise<HttpExecuteAwaitResult<TOutput, TError>> {
  const scope = preflightDirect(definition.input, input);
  if (scope instanceof Error) {
    return failed(scope);
  }
  const responseType = definition.output
    ? resolveInboundRepresentation(definition.output)
    : undefined;
  const errorResponseType = definition.error
    ? resolveInboundRepresentation(definition.error)
    : undefined;

  const picked = pickEndpoint(clientConfig.balancer, {
    endpoints: clientConfig.endpoints,
    meta: definition.meta,
  });
  if (picked[0] !== null) {
    if (retryState !== undefined) {
      retryState.unselected = true;
    }
    return failed(picked[0]);
  }
  const endpoint = picked[1];
  let started = false;
  let streamed = false;
  let replayable = true;
  let bodyFailed = false;
  let info = NOT_ATTEMPTED;
  let method = definition.method;
  const methods: string[] = [];

  try {
    let request: HttpRequest;
    let url: URL;
    try {
      ({ request, url } = buildDirectHttpRequest(
        definition.method,
        definition.path,
        definition.pathTemplate,
        scope.input,
        definition.builder,
        {
          baseEndpoint: endpoint.endpoint,
          defaultHeaders: clientConfig.headers,
          downloadProgress: options?.onDownloadProgress,
          inputGuides: scope.guides,
          errorResponseType,
          meta: definition.meta,
          querySerializer: clientConfig.querySerializer,
          responseType,
          retryAttempt: retryState?.attempt ?? 0,
          uploadProgress: options?.onUploadProgress,
          withCredentials: clientConfig.withCredentials,
        },
      ));
    } catch (error) {
      if (retryState !== undefined) {
        retryState.unselected = error instanceof RequestUrlError;
      }
      return failed(createPreflightFault("REQ_BUILD_FAILED", error));
    }

    let uploadController: AbortController | undefined;
    if (isReadableStreamBody(request.body)) {
      replayable = false;
      uploadController = new AbortController();
      request.signal = uploadController.signal;
    }

    let result: HttpExecuteAwaitResult<TOutput, TError>;
    try {
      let response: HttpResponse<unknown>;
      try {
        response = await fetchHandlerWithLifecycle(
          request,
          clientConfig.http.handle,
          {
            url,
            ownedHeaders: true,
            start(isStreamed) {
              started = true;
              streamed = isStreamed;
              methods.push(request.method);
              method = request.method;
              endpoint.start();
            },
            response(raw) {
              endpoint.end({
                attempted: true,
                status: raw.status,
                code: statusOutcome(raw.status),
              });
            },
            bodyFailed() {
              bodyFailed = true;
            },
          },
        );
      } finally {
        if (uploadController !== undefined && !bodyFailed) {
          uploadController.abort(new Error("HTTP interceptor chain settled"));
        }
      }
      info = {
        attempted: true,
        status: response.status,
        code: statusOutcome(response.status),
      };
      result = decodeDirectResponse(
        definition,
        response,
        responseType,
        errorResponseType,
      );
    } catch (error) {
      info = resolveFailureInfo(error, started, streamed);
      endpoint.end(info);
      result = failed(transportFault(error));
    }

    if (retryState !== undefined) {
      retryState.facts = retryFacts(
        {
          endpoint,
          info,
          method,
          methods,
          replayable,
          timedOut: false,
        },
        result[0],
        retryState.policy,
      );
    }
    return result;
  } finally {
    endpoint.done(info);
  }
}

/** The request, or the fault that ends the attempt: a builder or URL failure, or a cancellation. */
function buildRequest(
  attempt: Attempt,
  clientConfig: ClientConfig,
  definition: HttpExecutionDefinition<
    AnyStruct | undefined,
    AnyStruct | undefined,
    AnyStruct | undefined
  >,
  options: HttpExecuteOptions | undefined,
  responseType: HttpResponseType | undefined,
  errorResponseType: HttpResponseType | undefined,
  correlationId: string | undefined,
  retryAttempt: number,
): HttpRequest | PreflightFault {
  const { scope } = attempt;
  let request: HttpRequest;
  try {
    const prepared = prepareHttpRequest(
      definition.method,
      definition.path,
      scope.input,
      definition.builder,
      {
        signal: scope.signal,
        baseEndpoint: attempt.endpoint.endpoint,
        defaultHeaders: clientConfig.headers,
        downloadProgress: options?.onDownloadProgress,
        inputGuides: scope.guides,
        pathTemplate: definition.pathTemplate,
        errorResponseType,
        meta: definition.meta,
        querySerializer: clientConfig.querySerializer,
        responseType,
        correlationId,
        retryAttempt,
        uploadProgress: options?.onUploadProgress,
        withCredentials: clientConfig.withCredentials,
        finalizeHeaders: clientConfig.finalizeHeaders,
      },
    );
    request = prepared.request;
    attempt.validatedUrl = prepared.url;
    attempt.validatedBase = request.baseEndpoint;
    attempt.validatedEndpoint = request.endpoint;
  } catch (error) {
    if (error instanceof RequestUrlError) attempt.unselected = true;
    return (
      resolveAbortFault(scope.signal) ??
      createPreflightFault("REQ_BUILD_FAILED", error)
    );
  }
  if (isReadableStreamBody(request.body)) {
    attempt.replayable = false;
  }
  return resolveAbortFault(scope.signal) ?? request;
}

/** Sends `request` through the interceptors, then decodes the response they settled with. */
async function runChain<
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  attempt: Attempt,
  clientConfig: ClientConfig,
  definition: { readonly output?: TOutput; readonly error?: TError },
  request: HttpRequest,
): Promise<HttpExecuteAwaitResult<TOutput, TError>> {
  const signal = attempt.scope.signal;
  const onAbort = () => {
    attempt.abortedWhileSending = isSending(attempt.sends);
    abortSends(attempt.sends, signal.reason);
  };
  let response: HttpResponse<unknown>;
  try {
    const chain = makeChain(resolveHttpInterceptors(clientConfig.interceptors));
    // A signal that is already aborted fires nothing here; each send checks it when it starts.
    signal.addEventListener("abort", onAbort, { once: true });
    const chainPromise = chain(request, (next) => send(attempt, next));
    void chainPromise.catch(() => undefined);
    response = await awaitWithSignal(() => chainPromise, signal);
  } catch (error) {
    const cancelled = resolveAbortFault(signal);
    if (cancelled) {
      // Let every send settle, so that the balancer is told before the call ends.
      const pending = [];
      for (const record of attempt.sends) {
        if (record.pending) pending.push(record.pending);
      }
      await Promise.allSettled(pending);
      return failed(cancelled);
    }
    // An interceptor that rethrows what next() rejected with keeps that send's fault.
    return failed(attempt.faults?.get(error) ?? foreignFault(error));
  } finally {
    signal.removeEventListener("abort", onAbort);
    attempt.settled = true;
    if (hasSettleableSends(attempt.sends)) {
      abortSends(attempt.sends, new Error("HTTP interceptor chain settled"));
    }
  }

  // A caller abort during interceptor work is reported before this point.
  // The caller signal stays followed while a declared body is still being converted.
  return decodeResponse(definition, response, signal);
}

function isResponseFault(
  fault: AnyFault,
): fault is Exclude<AnyFault, PreflightFault> {
  switch (fault.code) {
    case "HTTP_STATUS":
    case "RES_DECODE_FAILED":
    case "RES_MEDIA_TYPE_INVALID":
    case "RES_STRUCT_MISMATCH":
      return true;
    default:
      return false;
  }
}

/**
 * What the retry policy sees of a failed attempt: a timeout, no response, or a response with a non-2xx status.
 * Anything else (cancellation, a build or hook failure, a body that failed to decode on a 2xx response, an attempt
 * whose body stream is spent) is never retried, and `undefined` here.
 */
function retryFacts(
  attempt: Pick<
    Attempt,
    "endpoint" | "info" | "method" | "methods" | "replayable" | "timedOut"
  >,
  fault: AnyFault | null,
  policy: RetryPolicy,
): RetryFacts | undefined {
  if (fault === null || !attempt.replayable) return undefined;
  const { info } = attempt;
  let retryable: boolean;
  let status: number | undefined;
  let headers: Headers | undefined;
  let retryAfterMs: number | undefined;
  if (attempt.timedOut && fault.code === "NET_TIMEOUT") {
    retryable = true;
  } else if (
    info.code === "NET_UNREACHABLE" &&
    fault.code === "NET_UNREACHABLE"
  ) {
    retryable = true;
  } else if (
    info.status !== undefined &&
    (info.status < 200 || info.status >= 300) &&
    isResponseFault(fault)
  ) {
    status = info.status;
    retryable = policy.statusCodes.includes(info.status);
    headers = fault.response.headers;
    if (policy.retryAfter && (info.status === 429 || info.status === 503)) {
      retryAfterMs = parseRetryAfter(headers.get("retry-after"));
    }
  } else {
    return undefined;
  }
  return {
    retryable,
    methods: attempt.methods,
    status,
    headers,
    retryAfterMs,
    method: attempt.method,
    endpoint: attempt.endpoint.endpoint,
  };
}
