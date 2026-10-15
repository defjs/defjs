import { describe, expect, test } from 'vitest'
import { AsyncQueue } from './async_queue'

describe('AsyncQueue', () => {
  test('push and async iterate', async () => {
    const queue = new AsyncQueue<number>({ maxSize: 2 })
    queue.push(1)
    queue.push(2)
    queue.close()

    const results: number[] = []
    for await (const value of queue) {
      results.push(value)
    }
    expect(results).toEqual([1, 2])
  })

  test('push before pull resolves immediately', async () => {
    const queue = new AsyncQueue<string>({ maxSize: 1 })
    queue.push('a')
    const iter = queue[Symbol.asyncIterator]()
    await expect(iter.next()).resolves.toEqual({ done: false, value: 'a' })
  })

  test('pull before push waits for value', async () => {
    const queue = new AsyncQueue<string>({ maxSize: 1 })
    const iter = queue[Symbol.asyncIterator]()
    const promise = iter.next()
    queue.push('b')
    await expect(promise).resolves.toEqual({ done: false, value: 'b' })
  })

  test('close before pull resolves done', async () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    queue.close()
    const iter = queue[Symbol.asyncIterator]()
    await expect(iter.next()).resolves.toEqual({ done: true, value: undefined })
  })

  test('close while waiting resolves done', async () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    const iter = queue[Symbol.asyncIterator]()
    const promise = iter.next()
    queue.close()
    await expect(promise).resolves.toEqual({ done: true, value: undefined })
  })

  test('fail rejects waiting pulls', async () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    const iter = queue[Symbol.asyncIterator]()
    const promise = iter.next()
    queue.fail(new Error('boom'))
    await expect(promise).rejects.toThrow('boom')
  })

  test('fail before pull rejects immediately', async () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    queue.fail(new Error('boom'))
    const iter = queue[Symbol.asyncIterator]()
    await expect(iter.next()).rejects.toThrow('boom')
  })

  test('push after close is ignored', () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    queue.close()
    queue.push(1)
    // Should not throw
  })

  test('close after close is ignored', () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    queue.close()
    queue.close()
    // Should not throw
  })

  test('fail after close is ignored', () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    queue.close()
    queue.fail(new Error('ignored'))
    const iter = queue[Symbol.asyncIterator]()
    // Should resolve done, not reject
    return expect(iter.next()).resolves.toEqual({ done: true, value: undefined })
  })

  test('rejects a second iterator even after reaching a terminal state', () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    queue[Symbol.asyncIterator]()
    queue.close()

    expect(() => queue[Symbol.asyncIterator]()).toThrow(new TypeError('AsyncQueue supports one consumer'))
  })

  test('maxSize with error overflow throws on push', () => {
    const queue = new AsyncQueue<number>({ maxSize: 2 })
    queue.push(1)
    queue.push(2)
    expect(() => queue.push(3)).toThrow('AsyncQueue overflow')
  })

  test('maxSize does not affect waiting consumers', async () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    const iter = queue[Symbol.asyncIterator]()
    const promise = iter.next()
    // waiting consumer should still receive value even though buffer is "full"
    queue.push(1)
    await expect(promise).resolves.toEqual({ done: false, value: 1 })
  })

  test('maxSize error does not affect subsequent pushes after draining', async () => {
    const queue = new AsyncQueue<number>({ maxSize: 1 })
    queue.push(1)
    const iter = queue[Symbol.asyncIterator]()
    await iter.next() // drain
    queue.push(2)
    await expect(iter.next()).resolves.toEqual({ done: false, value: 2 })
  })

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid maxSize %s', (maxSize) => {
    expect(() => new AsyncQueue({ maxSize })).toThrow(new TypeError('AsyncQueue maxSize must be a positive safe integer'))
  })

  test('accepts positive safe-integer maxSize values', () => {
    expect(() => new AsyncQueue({ maxSize: 1 })).not.toThrow()
    expect(() => new AsyncQueue({ maxSize: Number.MAX_SAFE_INTEGER })).not.toThrow()
  })

  test('close drains buffered values in FIFO order', async () => {
    const queue = new AsyncQueue<number>({ maxSize: 2 })
    queue.push(1)
    queue.push(2)
    queue.close()
    const iterator = queue[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  test('fail discards buffered values and rejects current and future pulls', async () => {
    const error = new Error('boom')
    const queue = new AsyncQueue<number>({ maxSize: 2 })
    queue.push(1)
    queue.push(2)
    queue.fail(error)
    const iterator = queue[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toBe(error)
    await expect(iterator.next()).rejects.toBe(error)

    const waitingQueue = new AsyncQueue<number>({ maxSize: 1 })
    const waitingIterator = waitingQueue[Symbol.asyncIterator]()
    const pending = waitingIterator.next()
    waitingQueue.fail(error)
    await expect(pending).rejects.toBe(error)
  })
})
