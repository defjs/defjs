import { expect, test } from 'vitest'
import { ERR_ABORTED, ERR_TIMEOUT } from '../error'
import { createTransportOrigin } from './transport_origin'

test('transport origin is isolated between execution trackers without changing causes', () => {
  const first = createTransportOrigin()
  const second = createTransportOrigin()
  for (const cause of [new Error('shared'), ERR_ABORTED, ERR_TIMEOUT]) {
    expect(first.mark(cause)).toBe(cause)
    expect(first.has(cause)).toBe(true)
    expect(second.has(cause)).toBe(false)
  }
  expect(first.has(new Error('unmarked'))).toBe(false)
})

test('primitive and null causes keep extension attribution', () => {
  const origin = createTransportOrigin()
  for (const cause of [null, undefined, 'failure', 42]) {
    expect(origin.mark(cause)).toBe(cause)
    expect(origin.has(cause)).toBe(false)
  }
})
