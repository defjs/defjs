import type { Client } from "../client/client";
import type { PreflightFault } from "../error";
import type { OperationResult } from "../interceptor/interceptor";
import type {
  ConcurrencyOptions,
  ResultMeta,
  ResultValue,
  SettledTaskResult,
} from "./pool";
import { runFailFastPool, runSettledPool } from "./pool";

/**
 * Runs one operation over many inputs concurrently, failing fast on the first fault.
 *
 * Returns a pooled error-first tuple `[err, results, responses]`. On success,
 * `results` and `responses` preserve the input order regardless of completion
 * order. On the first operation fault, already-started sibling calls are
 * aborted, in-flight calls and balancer hooks are awaited before returning, and
 * `[firstFault, undefined, undefined]` is returned; caller cancellation via
 * `options.signal` or a derived `client({ signal })` takes precedence as
 * `NET_ABORTED` or `NET_TIMEOUT`.
 *
 * `ResultValue` and `ResultMeta` are internal helper types preserving the
 * operation's exact success value and response metadata types. Rejects
 * zero-argument operations at compile time; pass operations that accept a
 * required or optional input. Use {@link concurrentMapSettled} when partial
 * results should be kept.
 *
 * @param client - Root or derived Defjs client (any per-call `RequestOptions` except `signal` are preserved, and `signal` combines with `options.signal`).
 * @param operation - Defjs operation (such as a `defineRequest`, `defineEventStream`, or `defineWebSocket` endpoint) accepting an input.
 * @param inputs - Ordered inputs to pass to `operation`.
 * @param options - Optional concurrency cap (`concurrency`) and batch cancellation (`signal`).
 * @returns `[null, results, responses]` if every call succeeds, or `[err, undefined, undefined]` on failure.
 * @throws `RangeError` if `options.concurrency` is neither `Infinity` nor a positive integer.
 * @group client
 */
export async function concurrentMap<
  TInput,
  TResult extends OperationResult,
  TOp extends (client: Client, input: TInput) => Promise<TResult>,
>(
  client: Client,
  operation: TOp &
    ((client: Client, input: TInput) => Promise<TResult>) &
    (Parameters<NoInfer<TOp>> extends readonly [Client] ? never : unknown),
  inputs: readonly NoInfer<TInput>[],
  options?: ConcurrencyOptions,
): Promise<
  | [
      err: null,
      results: ResultValue<TResult>[],
      responses: ResultMeta<TResult>[],
    ]
  | [
      err: Exclude<TResult[0], null> | PreflightFault,
      results: undefined,
      responses: undefined,
    ]
> {
  const outcome = await runFailFastPool(
    client,
    inputs,
    (item, taskClient) => operation(taskClient, item),
    options,
  );
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: TypeScript widens TData/TMeta with undefined and TFault to AnyFault if a union of tuples is inferred element-wise, so TResult must be captured whole and decomposed with Extract/Exclude while the shared pool operates on OperationResult
  return outcome as
    | [
        err: null,
        results: ResultValue<TResult>[],
        responses: ResultMeta<TResult>[],
      ]
    | [
        err: Exclude<TResult[0], null> | PreflightFault,
        results: undefined,
        responses: undefined,
      ];
}

/**
 * Runs one operation over many inputs concurrently and collects every error-first result tuple.
 *
 * Unlike {@link concurrentMap}, one failing item does not cancel its siblings.
 * Each item resolves to its own error-first tuple in input order. If the batch
 * `signal` aborts while items are still waiting in the concurrency queue,
 * unstarted slots resolve with `[NET_ABORTED | NET_TIMEOUT, undefined, undefined]`.
 *
 * `SettledTaskResult` is an internal helper type preserving the operation's
 * result tuple. Rejects zero-argument operations at compile time; pass
 * operations that accept a required or optional input.
 *
 * @param client - Root or derived Defjs client.
 * @param operation - Defjs operation accepting an input.
 * @param inputs - Ordered inputs to pass to `operation`.
 * @param options - Optional concurrency cap (`concurrency`) and batch cancellation (`signal`).
 * @returns An array of per-input error-first tuples in input order.
 * @throws `RangeError` if `options.concurrency` is neither `Infinity` nor a positive integer.
 * @group client
 */
export async function concurrentMapSettled<
  TInput,
  TResult extends OperationResult,
  TOp extends (client: Client, input: TInput) => Promise<TResult>,
>(
  client: Client,
  operation: TOp &
    ((client: Client, input: TInput) => Promise<TResult>) &
    (Parameters<NoInfer<TOp>> extends readonly [Client] ? never : unknown),
  inputs: readonly NoInfer<TInput>[],
  options?: ConcurrencyOptions,
): Promise<SettledTaskResult<TResult>[]> {
  const settled = await runSettledPool(
    client,
    inputs,
    (item, taskClient) => operation(taskClient, item),
    options,
  );
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: TypeScript widens TData/TMeta with undefined and TFault to AnyFault if a union of tuples is inferred element-wise, so TResult must be captured whole and decomposed with SettledTaskResult while the shared pool operates on OperationResult
  return settled as SettledTaskResult<TResult>[];
}
