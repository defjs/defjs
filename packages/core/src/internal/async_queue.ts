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

  close(): void {
    if (this.done) {
      return;
    }

    this.done = true;
    while (this.waiting.length > 0) {
      this.waiting.shift()?.resolve({ done: true, value: undefined });
    }
  }

  fail(error: unknown): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.error = error;
    this.values.length = 0;
    while (this.waiting.length > 0) {
      this.waiting.shift()?.reject(error);
    }
  }

  // Ends the queue with an error but keeps the values already queued: they are pulled first, then every pull rejects.
  failAfterDrain(error: unknown): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.error = error;
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
}
