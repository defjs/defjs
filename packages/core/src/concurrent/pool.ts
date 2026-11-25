import type { Client } from "../client/client";
import { CLIENT } from "../client/client";
import type { AnyFault, PreflightFault } from "../error";
import { ERR_ABORTED } from "../error";
import type { OperationResult } from "../interceptor/interceptor";
import { followAbort, resolveAbortedFault } from "../internal/abort";

/**
 * Execution bounds and cancellation options shared by helpers in `@defjs/core/concurrent`.
 *
 * `concurrency` caps how many operations run in parallel (`Infinity` by default).
 * `signal` cancels the whole batch, propagating alongside any `signal` already
 * carried on a derived `client(options)`.
 *
 * @group client
 */
export interface ConcurrencyOptions {
  /** Maximum number of concurrent operations allowed in flight at once; must be a positive integer (`>= 1`) or `Infinity` (default). */
  readonly concurrency?: number;
  /** Cancels the batch and aborts started operations. */
  readonly signal?: AbortSignal;
}

export type SuccessBranch<TResult> = Extract<
  TResult,
  readonly [null, ...unknown[]]
>;

export type ResultValue<TResult> = [SuccessBranch<TResult>] extends [never]
  ? undefined
  : SuccessBranch<TResult> extends readonly [null, infer TValue, ...unknown[]]
    ? TValue
    : unknown;

export type ResultMeta<TResult> = [SuccessBranch<TResult>] extends [never]
  ? undefined
  : SuccessBranch<TResult> extends readonly [
        null,
        unknown,
        infer TMeta,
        ...unknown[],
      ]
    ? TMeta
    : undefined;

export type SettledTaskResult<TResult extends OperationResult> = [
  PreflightFault,
  undefined,
  undefined,
] extends TResult
  ? TResult
  : TResult | [err: PreflightFault, result: undefined, response: undefined];

interface ClosableSession {
  close(): void;
  readonly closed: Promise<unknown>;
}

/** Validates and resolves `options?.concurrency`, rejecting non-positive or non-integer values with `RangeError`. */
export function resolveConcurrency(options?: ConcurrencyOptions): number {
  const concurrency = options?.concurrency ?? Infinity;
  if (
    concurrency !== Infinity &&
    (!Number.isInteger(concurrency) || concurrency < 1)
  ) {
    throw new RangeError("concurrency must be a positive integer or Infinity");
  }
  return concurrency;
}

function deriveTaskClient(client: Client, signal: AbortSignal): Client {
  const state = client[CLIENT];
  return {
    [CLIENT]: {
      config: state.config,
      options:
        state.options === undefined ? { signal } : { ...state.options, signal },
    },
  };
}

function abortedSignal(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (first?.aborted) return first;
  if (second?.aborted) return second;
  return undefined;
}

function isClosableSession(value: unknown): value is ClosableSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof value.close === "function" &&
    "closed" in value &&
    value.closed instanceof Promise
  );
}

function closeSessions(sessions: readonly ClosableSession[]): void {
  for (const session of sessions) {
    try {
      session.close();
    } catch {
      // Best-effort rollback must not obscure the primary fault or uncaught error.
    }
  }
}

function retainSignalsUntilClosed(
  sessions: readonly ClosableSession[],
  releaseSignals: () => void,
): void {
  if (sessions.length === 0) {
    releaseSignals();
    return;
  }
  void Promise.allSettled(sessions.map((session) => session.closed)).then(
    releaseSignals,
  );
}

/** Runs `items` with bounded parallelism, stopping siblings on the first fault and waiting for started tasks to settle. */
export async function runFailFastPool<TItem>(
  client: Client,
  items: readonly TItem[],
  runItem: (item: TItem, client: Client) => Promise<OperationResult>,
  options?: ConcurrencyOptions,
): Promise<
  | [err: null, results: unknown[], responses: unknown[]]
  | [err: AnyFault, results: undefined, responses: undefined]
> {
  const concurrency = resolveConcurrency(options);
  const clientSignal = client[CLIENT].options?.signal;
  const batchSignal = options?.signal;

  const preAborted = abortedSignal(clientSignal, batchSignal);
  if (preAborted !== undefined) {
    return [resolveAbortedFault(preAborted), undefined, undefined];
  }

  if (items.length === 0) {
    return [null, [], []];
  }

  const batchController = new AbortController();
  const unfollowClient = followAbort(batchController, clientSignal);
  const unfollowBatch = followAbort(batchController, batchSignal);
  const releaseSignals = (): void => {
    unfollowClient();
    unfollowBatch();
  };

  const taskClient = deriveTaskClient(client, batchController.signal);
  const iterator = items.entries();
  const results: unknown[] = [];
  const metas: unknown[] = [];
  const openedSessions: ClosableSession[] = [];
  let stopped = false;
  let firstFault: AnyFault | undefined;
  let uncaughtError: { readonly value: unknown } | undefined;

  const triggerStop = (record: () => void): void => {
    if (!stopped) {
      stopped = true;
      record();
      batchController.abort(ERR_ABORTED);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  const worker = async (): Promise<void> => {
    while (!batchController.signal.aborted) {
      const step = iterator.next();
      if (step.done) return;
      const [index, item] = step.value;
      try {
        const outcome = await runItem(item, taskClient);
        const fault = outcome[0];
        if (fault !== null) {
          triggerStop(() => {
            firstFault = fault;
          });
          continue;
        }
        results[index] = outcome[1];
        metas[index] = outcome[2];
        if (isClosableSession(outcome[1])) {
          openedSessions.push(outcome[1]);
        }
      } catch (error) {
        triggerStop(() => {
          uncaughtError = { value: error };
        });
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (uncaughtError !== undefined) {
    closeSessions(openedSessions);
    releaseSignals();
    throw uncaughtError.value;
  }

  const callerAborted = abortedSignal(clientSignal, batchSignal);
  if (callerAborted !== undefined) {
    closeSessions(openedSessions);
    releaseSignals();
    return [resolveAbortedFault(callerAborted), undefined, undefined];
  }

  if (firstFault !== undefined) {
    closeSessions(openedSessions);
    releaseSignals();
    return [firstFault, undefined, undefined];
  }

  retainSignalsUntilClosed(openedSessions, releaseSignals);
  return [null, results, metas];
}

/** Runs every item to its settled error-first tuple with bounded parallelism. */
export async function runSettledPool<TItem>(
  client: Client,
  items: readonly TItem[],
  runItem: (item: TItem, client: Client) => Promise<OperationResult>,
  options?: ConcurrencyOptions,
): Promise<OperationResult[]> {
  const concurrency = resolveConcurrency(options);
  if (items.length === 0) {
    return [];
  }

  const clientSignal = client[CLIENT].options?.signal;
  const batchSignal = options?.signal;
  const batchController = new AbortController();
  const unfollowClient = followAbort(batchController, clientSignal);
  const unfollowBatch = followAbort(batchController, batchSignal);
  const releaseSignals = (): void => {
    unfollowClient();
    unfollowBatch();
  };

  const taskClient = deriveTaskClient(client, batchController.signal);
  const iterator = items.entries();
  const results: OperationResult[] = [];
  const openedSessions: ClosableSession[] = [];
  let uncaughtError: { readonly value: unknown } | undefined;

  const workerCount = Math.min(concurrency, items.length);
  const worker = async (): Promise<void> => {
    while (uncaughtError === undefined) {
      const step = iterator.next();
      if (step.done) return;
      const [index, item] = step.value;
      if (batchController.signal.aborted) {
        results[index] = [
          resolveAbortedFault(batchController.signal),
          undefined,
          undefined,
        ];
        continue;
      }
      try {
        const outcome = await runItem(item, taskClient);
        results[index] = outcome;
        if (outcome[0] === null && isClosableSession(outcome[1])) {
          openedSessions.push(outcome[1]);
        }
      } catch (error) {
        if (uncaughtError === undefined) {
          uncaughtError = { value: error };
          batchController.abort(ERR_ABORTED);
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (uncaughtError !== undefined) {
    closeSessions(openedSessions);
    releaseSignals();
    throw uncaughtError.value;
  }

  retainSignalsUntilClosed(openedSessions, releaseSignals);
  return results;
}
