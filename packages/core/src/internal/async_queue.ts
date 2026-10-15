type PendingNext<T> = {
  resolve: (result: IteratorResult<T>) => void
  reject: (reason: unknown) => void
}

const NO_ERROR = Symbol('NO_ERROR')

export interface AsyncQueueOptions {
  maxSize: number
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiting: PendingNext<T>[] = []
  private readonly maxSize: number
  private done = false
  private error: unknown = NO_ERROR
  private iteratorClaimed = false

  constructor(options: AsyncQueueOptions) {
    if (!Number.isSafeInteger(options.maxSize) || options.maxSize < 1) {
      throw new TypeError('AsyncQueue maxSize must be a positive safe integer')
    }
    this.maxSize = options.maxSize
  }

  push(value: T): void {
    if (this.done) {
      return
    }

    const waiting = this.waiting.shift()
    if (waiting) {
      waiting.resolve({ done: false, value })
      return
    }

    if (this.values.length >= this.maxSize) {
      throw new Error('AsyncQueue overflow')
    }

    this.values.push(value)
  }

  close(): void {
    if (this.done) {
      return
    }

    this.done = true
    while (this.waiting.length > 0) {
      this.waiting.shift()?.resolve({ done: true, value: undefined })
    }
  }

  fail(error: unknown): void {
    if (this.done) {
      return
    }

    this.done = true
    this.error = error
    this.values.length = 0
    while (this.waiting.length > 0) {
      this.waiting.shift()?.reject(error)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.iteratorClaimed) {
      throw new TypeError('AsyncQueue supports one consumer')
    }
    this.iteratorClaimed = true

    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({
            done: false,
            value: this.values.shift() as T,
          })
        }

        if (this.error !== NO_ERROR) {
          return Promise.reject(this.error)
        }

        if (this.done) {
          return Promise.resolve({ done: true, value: undefined })
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiting.push({ resolve, reject })
        })
      },
    }
  }
}
