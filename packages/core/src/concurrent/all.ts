import type { Client } from "../client/client";
import type { AnyFault, PreflightFault } from "../error";
import type { OperationResult } from "../interceptor/interceptor";
import type {
  ConcurrencyOptions,
  ResultMeta,
  ResultValue,
  SettledTaskResult,
} from "./pool";
import { runFailFastPool, runSettledPool } from "./pool";

/**
 * Thunk passed to {@link concurrentAll} or {@link concurrentAllSettled}.
 *
 * Receives the batch-derived {@link Client} (`c => getUser(c, input)`) so batch
 * cancellation, per-call client options, and fail-fast aborts flow cleanly into
 * every task without changing how operations are called.
 *
 * @group client
 */
export type ConcurrentTask<TResult extends OperationResult = OperationResult> =
  (client: Client) => Promise<TResult>;

/**
 * Keyed dictionary of heterogeneous {@link ConcurrentTask} functions passed to
 * {@link concurrentAll} or {@link concurrentAllSettled}.
 *
 * @group client
 */
export type ConcurrentTaskRecord = {
  readonly [key: string]: ConcurrentTask;
};

type TupleFault<TTasks extends readonly ConcurrentTask[]> =
  Exclude<Awaited<ReturnType<TTasks[number]>>[0], null> | PreflightFault;

type RecordFault<TTasks extends ConcurrentTaskRecord> =
  Exclude<Awaited<ReturnType<TTasks[keyof TTasks]>>[0], null> | PreflightFault;

type TupleSuccessValues<TTasks extends readonly ConcurrentTask[]> = {
  -readonly [K in keyof TTasks]: ResultValue<Awaited<ReturnType<TTasks[K]>>>;
};

type TupleSuccessMetas<TTasks extends readonly ConcurrentTask[]> = {
  -readonly [K in keyof TTasks]: ResultMeta<Awaited<ReturnType<TTasks[K]>>>;
};

type RecordSuccessValues<TTasks extends ConcurrentTaskRecord> = {
  -readonly [K in keyof TTasks]: ResultValue<Awaited<ReturnType<TTasks[K]>>>;
};

type RecordSuccessMetas<TTasks extends ConcurrentTaskRecord> = {
  -readonly [K in keyof TTasks]: ResultMeta<Awaited<ReturnType<TTasks[K]>>>;
};

type SettledTupleResult<TTasks extends readonly ConcurrentTask[]> = {
  -readonly [K in keyof TTasks]: SettledTaskResult<
    Awaited<ReturnType<TTasks[K]>>
  >;
};

type SettledRecordResult<TTasks extends ConcurrentTaskRecord> = {
  -readonly [K in keyof TTasks]: SettledTaskResult<
    Awaited<ReturnType<TTasks[K]>>
  >;
};

function isTaskList(
  value: readonly ConcurrentTask[] | ConcurrentTaskRecord,
): value is readonly ConcurrentTask[] {
  return Array.isArray(value);
}

function defineOwn(
  target: { [key: string]: unknown },
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Runs a tuple of heterogeneous Defjs tasks concurrently, failing fast on the first fault.
 *
 * Each task receives the batch-derived {@link Client} (`(c) => getUser(c, input)`).
 * Preserves heterogeneous result and metadata types in tuple positions without
 * requiring `as const`. On the first fault, aborts remaining siblings, closes
 * any SSE streams or WebSocket sessions already opened by earlier tasks in the
 * batch, waits for started tasks to settle, and returns `[firstFault, undefined, undefined]`.
 *
 * `TupleFault`, `RecordFault`, `TupleSuccessValues`, `TupleSuccessMetas`,
 * `RecordSuccessValues`, `RecordSuccessMetas`, `ResultValue`, and `ResultMeta`
 * are internal helper types preserving tuple and record inference.
 *
 * @param client - Root or derived Defjs client.
 * @param tasks - Tuple or array of task functions receiving the batch client.
 * @param options - Optional concurrency limit and batch cancellation signal.
 * @returns `[null, resultsTuple, responsesTuple]` on full success, or `[err, undefined, undefined]` on failure.
 * @throws `RangeError` if `options.concurrency` is neither `Infinity` nor a positive integer.
 * @group client
 */
export function concurrentAll<const TTasks extends readonly ConcurrentTask[]>(
  client: Client,
  tasks: TTasks,
  options?: ConcurrencyOptions,
): Promise<
  | [
      err: null,
      results: TupleSuccessValues<TTasks>,
      responses: TupleSuccessMetas<TTasks>,
    ]
  | [err: TupleFault<TTasks>, results: undefined, responses: undefined]
>;

/**
 * Runs a keyed record of heterogeneous Defjs tasks concurrently, failing fast on the first fault.
 *
 * Keys in `tasks` map directly to properties on `results` and `responses`.
 * Uses `Object.defineProperty` so keys such as `__proto__` stay own data
 * properties.
 *
 * @param client - Root or derived Defjs client.
 * @param tasks - Named record of task functions receiving the batch client.
 * @param options - Optional concurrency limit and batch cancellation signal.
 * @returns `[null, resultsRecord, responsesRecord]` on full success, or `[err, undefined, undefined]` on failure.
 * @throws `RangeError` if `options.concurrency` is neither `Infinity` nor a positive integer.
 */
export function concurrentAll<const TTasks extends ConcurrentTaskRecord>(
  client: Client,
  tasks: TTasks,
  options?: ConcurrencyOptions,
): Promise<
  | [
      err: null,
      results: RecordSuccessValues<TTasks>,
      responses: RecordSuccessMetas<TTasks>,
    ]
  | [err: RecordFault<TTasks>, results: undefined, responses: undefined]
>;

export async function concurrentAll(
  client: Client,
  tasks: readonly ConcurrentTask[] | ConcurrentTaskRecord,
  options?: ConcurrencyOptions,
): Promise<
  | [
      err: null,
      results: readonly unknown[] | { [key: string]: unknown },
      responses: readonly unknown[] | { [key: string]: unknown },
    ]
  | [err: AnyFault, results: undefined, responses: undefined]
> {
  if (isTaskList(tasks)) {
    return runFailFastPool(client, tasks, (task, c) => task(c), options);
  }

  const entries = Object.entries(tasks);
  const outcome = await runFailFastPool(
    client,
    entries,
    ([, task], taskClient) => task(taskClient),
    options,
  );
  if (outcome[0] !== null) {
    return outcome;
  }

  const values: { [key: string]: unknown } = {};
  const metas: { [key: string]: unknown } = {};
  const [, rawValues, rawMetas] = outcome;
  for (const [index, [key]] of entries.entries()) {
    defineOwn(values, key, rawValues[index]);
    defineOwn(metas, key, rawMetas[index]);
  }
  return [null, values, metas];
}

/**
 * Runs a tuple of heterogeneous Defjs tasks concurrently and returns each task's own error-first tuple.
 *
 * One failing task never aborts its siblings. Queued tasks skipped because the
 * batch `signal` aborted resolve with `[NET_ABORTED | NET_TIMEOUT, undefined, undefined]`.
 *
 * `SettledTupleResult`, `SettledRecordResult`, and `SettledTaskResult` are
 * internal helper types preserving per-task settled result inference.
 *
 * @param client - Root or derived Defjs client.
 * @param tasks - Tuple or array of task functions receiving the batch client.
 * @param options - Optional concurrency limit and batch cancellation signal.
 * @returns A tuple of settled error-first results matching `tasks`.
 * @throws `RangeError` if `options.concurrency` is neither `Infinity` nor a positive integer.
 * @group client
 */
export function concurrentAllSettled<
  const TTasks extends readonly ConcurrentTask[],
>(
  client: Client,
  tasks: TTasks,
  options?: ConcurrencyOptions,
): Promise<SettledTupleResult<TTasks>>;

/**
 * Runs a keyed record of heterogeneous Defjs tasks concurrently and returns each task's own error-first tuple.
 *
 * One failing task never aborts its siblings. Queued tasks skipped because the
 * batch `signal` aborted resolve with `[NET_ABORTED | NET_TIMEOUT, undefined, undefined]`.
 *
 * @param client - Root or derived Defjs client.
 * @param tasks - Named record of task functions receiving the batch client.
 * @param options - Optional concurrency limit and batch cancellation signal.
 * @returns A keyed record of settled error-first results matching `tasks`.
 * @throws `RangeError` if `options.concurrency` is neither `Infinity` nor a positive integer.
 */
export function concurrentAllSettled<const TTasks extends ConcurrentTaskRecord>(
  client: Client,
  tasks: TTasks,
  options?: ConcurrencyOptions,
): Promise<SettledRecordResult<TTasks>>;

export async function concurrentAllSettled(
  client: Client,
  tasks: readonly ConcurrentTask[] | ConcurrentTaskRecord,
  options?: ConcurrencyOptions,
): Promise<OperationResult[] | { [key: string]: OperationResult }> {
  if (isTaskList(tasks)) {
    return runSettledPool(client, tasks, (task, c) => task(c), options);
  }

  const entries = Object.entries(tasks);
  const settled = await runSettledPool(
    client,
    entries,
    ([, task], taskClient) => task(taskClient),
    options,
  );
  const record: { [key: string]: OperationResult } = {};
  for (const [index, [key]] of entries.entries()) {
    defineOwn(record, key, settled[index]);
  }
  return record;
}
