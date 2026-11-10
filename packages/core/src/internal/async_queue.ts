type PendingNext<T> = {
  resolve: (result: IteratorResult<T>) => void;
  reject: (reason: unknown) => void;
};

const NO_ERROR = Symbol("NO_ERROR");

export interface AsyncQueueOptions {
  /** Maximum number of queued values. Omit it to leave the queue unbounded. */
  maxSize?: number;
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  // Queued values are stored as the results `next()` hands out, so an `undefined` value is still a queued result.
  private readonly values: IteratorYieldResult<T>[] = [];
  private readonly waiting: PendingNext<T>[] = [];
  // Producers parked by `waitForRoom`. The only caller has a single producer, so this is never long.
  private readonly roomWaiters: (() => void)[] = [];
  private readonly maxSize: number | undefined;
  private done = false;
  private error: unknown = NO_ERROR;
  private iteratorClaimed = false;

  constructor(options: AsyncQueueOptions = {}) {
    const { maxSize } = options;
    if (
      maxSize !== undefined &&
      (!Number.isSafeInteger(maxSize) || maxSize < 1)
    ) {
      throw new TypeError("AsyncQueue maxSize must be a positive safe integer");
    }
    this.maxSize = maxSize;
  }

  /** Values queued for a consumer that has not asked for them yet. */
  get size(): number {
    return this.values.length;
  }

  push(value: T): void {
    if (this.done) {
      return;
    }

    const waiting = this.waiting.shift();
    if (waiting) {
      waiting.resolve({ done: false, value });
      return;
    }

    if (this.maxSize !== undefined && this.values.length >= this.maxSize) {
      throw new Error("AsyncQueue overflow");
    }

    this.values.push({ done: false, value });
  }

  /**
   * Resolves once `push` has room again or the queue has ended. `undefined` means there is room now,
   * so a producer can keep pushing synchronously and only awaits when the queue is full.
   */
  waitForRoom(): Promise<void> | undefined {
    if (
      this.done ||
      this.maxSize === undefined ||
      this.values.length < this.maxSize
    ) {
      return undefined;
    }
    return new Promise<void>((resolve) => {
      this.roomWaiters.push(resolve);
    });
  }

  /** Drops the values nobody has taken yet. */
  discard(): void {
    this.values.length = 0;
  }

  close(): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.releaseRoom();
    while (this.waiting.length > 0) {
      this.waiting.shift()?.resolve({ done: true, value: undefined });
    }
  }

  /** Values already queued are still delivered; every pull after them rejects with `error`. */
  fail(error: unknown): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.error = error;
    this.releaseRoom();
    while (this.waiting.length > 0) {
      this.waiting.shift()?.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.iteratorClaimed) {
      throw new TypeError("AsyncQueue supports one consumer");
    }
    this.iteratorClaimed = true;

    return {
      next: () => {
        const queued = this.values.shift();
        if (queued) {
          this.releaseRoom();
          return Promise.resolve(queued);
        }

        if (this.error !== NO_ERROR) {
          return Promise.reject(this.error);
        }

        if (this.done) {
          return Promise.resolve({ done: true, value: undefined });
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiting.push({ resolve, reject });
        });
      },
    };
  }

  private releaseRoom(): void {
    for (const resolve of this.roomWaiters.splice(0)) {
      resolve();
    }
  }
}
