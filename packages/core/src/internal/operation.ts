import type { Client } from "../client/client";
import { CLIENT } from "../client/client";
import type { PreflightFault } from "../error";
import { createPreflightFault } from "../error";
import type {
  OperationCall,
  OperationInterceptorFn,
  OperationResult,
} from "../interceptor/interceptor";

/** What an operation resolves with when one of its operation interceptors failed. */
type FailedOperation = [
  err: PreflightFault,
  result: undefined,
  response: undefined,
];

/**
 * Runs one operation call inside the client's operation interceptors, or on its own when there are none.
 *
 * `execute` is the call itself and runs at most once, however often an interceptor calls `next()`. An interceptor that
 * throws or rejects resolves its layer with `EXT_INTERCEPTOR_FAILED`, so the `next()` an outer interceptor awaits
 * never rejects, and `discard` releases what the call had opened.
 */
export function executeOperation<TResult extends OperationResult>(
  client: Client,
  call: OperationCall,
  execute: () => Promise<TResult>,
  discard?: (result: TResult, reason: unknown) => void,
): Promise<TResult | FailedOperation> {
  const all = client[CLIENT].config.interceptors;
  // PERF: skip scanning and allocating when no interceptors are registered at all.
  if (all.length === 0) {
    return execute();
  }
  let interceptors: OperationInterceptorFn[] | undefined;
  for (const interceptor of all) {
    if (interceptor.kind === "operation") {
      (interceptors ??= []).push(interceptor.fn);
    }
  }
  // PERF: a client without operation interceptors gets the call's own promise, with no chain and no added await.
  return interceptors === undefined
    ? execute()
    : runOperation(interceptors, call, execute, discard);
}

async function runOperation<TResult extends OperationResult>(
  interceptors: readonly OperationInterceptorFn[],
  call: OperationCall,
  execute: () => Promise<TResult>,
  discard: ((result: TResult, reason: unknown) => void) | undefined,
): Promise<TResult | FailedOperation> {
  let produced: TResult | undefined;
  const fail = (error: unknown): FailedOperation => {
    if (produced !== undefined) {
      discard?.(produced, error);
      produced = undefined;
    }
    return [
      createPreflightFault("EXT_INTERCEPTOR_FAILED", error),
      undefined,
      undefined,
    ];
  };
  const chain = interceptors.reduceRight<
    () => Promise<TResult | FailedOperation>
  >(
    (next, fn) =>
      once(async () => {
        try {
          return await fn(call, next);
        } catch (error) {
          return fail(error);
        }
      }),
    once(async () => (produced = await execute())),
  );
  return chain();
}

function once<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= run());
}
