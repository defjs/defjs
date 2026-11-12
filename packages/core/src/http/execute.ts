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
import type { EndpointInput } from "../internal/endpoint_input";
import type { HttpRequest, HttpResponseType } from "./http_request";
import type { HttpResponse } from "./http_response";
import { resolveInboundRepresentation } from "../internal/inbound_representation";
import { preflight } from "../internal/preflight";
import type { RetryPolicy } from "../internal/retry";
import {
  isRetryMethod,
  resolveRetryPolicy,
  retryStep,
} from "../internal/retry";
import { RequestUrlError } from "../internal/url";
import type { AnyStruct } from "../struct";
import { decodeResponse, failed } from "./decode";
import type { HttpExecuteAwaitResult, RequestDefinition } from "./http";
import type { HttpExecuteOptions } from "./http";
import { createHttpRequest } from "./request";
import type { Attempt } from "./send";
import {
  abortSends,
  attemptReport,
  foreignFault,
  isSending,
  NOT_ATTEMPTED,
  send,
} from "./send";
import { isReadableStreamBody } from "./transport/fetch_init";

type HttpExecutionDefinition<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
> = Omit<RequestDefinition<TInput>, "output" | "error"> & {
  output?: TOutput;
  error?: TError;
};

/** What the retry policy is shown of a failed attempt that it may retry. */
interface RetryFacts {
  /** The failure is a timeout, no response, or 502, 503 or 504; the methods sent decide the rest, once a retry is on the table. */
  readonly retryable: boolean;
  /** Every method sent in the attempt, for the policy's method list. */
  readonly methods: readonly string[];
  readonly status: number | undefined;
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

/** Runs the operation once, or as often as the retry policy asks. */
export async function executeHttp<
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
  // PERF: no policy means one attempt: no loop, no budget, no signal for the waits.
  if (policy === undefined) {
    const { result } = await attemptHttp(
      clientConfig,
      definition,
      input,
      options,
      undefined,
    );
    return result;
  }

  const budget = retryBudgetFor(clientConfig);
  budget.deposit();
  const signal = options?.signal ?? new AbortController().signal;
  let previous: HttpExecuteAwaitResult<TOutput, TError> | undefined;
  for (let retried = 0; ; retried++) {
    const attempt = await attemptHttp(
      clientConfig,
      definition,
      input,
      options,
      policy,
    );
    // A retry that could not use any endpoint has nothing new to report; the attempt that failed is the outcome.
    if (previous !== undefined && attempt.unselected) return previous;
    previous = attempt.result;
    const facts = attempt.retry;
    if (facts === undefined || signal.aborted || isOffline()) {
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
    }));
    if (step !== "retry") {
      return step === "stop" ? attempt.result : failed(step);
    }
    if (!budget.tryWithdraw()) return attempt.result;
    const delay = computeReconnectDelay(policy, retried + 1);
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
 * One attempt: the endpoint pick, the request, the interceptor chain, the decoded response, and the report to the
 * balancer. The balancer's `done` and the release of the caller's signal each happen exactly once, in a `finally`.
 */
async function attemptHttp<
  TInput extends AnyStruct | undefined,
  TOutput extends AnyStruct | undefined,
  TError extends AnyStruct | undefined,
>(
  clientConfig: ClientConfig,
  definition: HttpExecutionDefinition<TInput, TOutput, TError>,
  input: EndpointInput<TInput> | undefined,
  options: HttpExecuteOptions | undefined,
  policy: RetryPolicy | undefined,
): Promise<AttemptResult<TOutput, TError>> {
  const scope = preflight(definition.input, input, options?.signal);
  if (scope instanceof Error) {
    return { result: failed(scope), unselected: false, retry: undefined };
  }
  try {
    // A declaration that is not a struct throws here, and the finally below releases the caller's signal.
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
      operation: definition.operation,
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
          policy === undefined ? undefined : retryFacts(attempt, result[0]),
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
): HttpRequest | PreflightFault {
  const { scope } = attempt;
  let request: HttpRequest;
  try {
    request = createHttpRequest(
      definition.method,
      definition.path,
      scope.input,
      definition.builder,
      {
        signal: scope.signal,
        baseEndpoint: attempt.endpoint.endpoint,
        defaultHeaders: clientConfig.headers,
        downloadProgress: options?.onDownloadProgress,
        inputDeclared: definition.input !== undefined,
        inputGuides: scope.guides,
        errorResponseType,
        operation: definition.operation,
        querySerializer: clientConfig.querySerializer,
        responseType,
        uploadProgress: options?.onUploadProgress,
        withCredentials: clientConfig.withCredentials,
        finalizeHeaders: clientConfig.finalizeHeaders,
      },
    );
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
    abortSends(attempt.sends, new Error("HTTP interceptor chain settled"));
  }

  // A caller abort during interceptor work is reported before this point.
  // The caller signal stays followed while a declared body is still being converted.
  return decodeResponse(definition, response, signal);
}

/**
 * What the retry policy sees of a failed attempt: a timeout, no response, or a response with a non-2xx status.
 * Anything else (cancellation, a build or hook failure, a body that failed to decode on a 2xx response, an attempt
 * whose body stream is spent) is never retried, and `undefined` here.
 */
function retryFacts(
  attempt: Attempt,
  fault: AnyFault | null,
): RetryFacts | undefined {
  if (fault === null || !attempt.replayable) return undefined;
  const { info } = attempt;
  let retryable: boolean;
  let status: number | undefined;
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
    (fault.code === "HTTP_STATUS" || fault.code.startsWith("RES_"))
  ) {
    retryable = info.code === "NET_UNAVAILABLE";
    status = info.status;
  } else {
    return undefined;
  }
  return {
    retryable,
    methods: attempt.methods,
    status,
    method: attempt.method,
    endpoint: attempt.endpoint.endpoint,
  };
}
