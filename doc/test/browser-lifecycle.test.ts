import { expect, test } from 'bun:test'
import type { Browser } from 'playwright'
import { withPreviewBrowser } from '../e2e/browser'

type Stage = 'launch' | 'body' | 'close' | 'stop'

function lifecycle(failures: Partial<Record<Stage, unknown>> = {}) {
  const calls: string[] = []
  const step = async (stage: Stage) => {
    calls.push(stage)
    if (stage in failures) throw failures[stage]
  }
  const browser = { close: () => step('close') } as Browser
  const preview = {
    url: new URL('http://localhost:1234'),
    stop: async (force?: boolean) => {
      expect(force).toBe(true)
      await step('stop')
    },
  }
  const run = () =>
    withPreviewBrowser(
      {
        launch: async () => {
          await step('launch')
          return browser
        },
      },
      async (receivedBrowser, receivedPreview) => {
        expect(receivedBrowser).toBe(browser)
        expect(receivedPreview).toBe(preview)
        await step('body')
      },
      () => preview,
    )
  return { calls, run }
}

test('stops the preview when browser launch fails', async () => {
  const failure = new Error('launch failed')
  const { calls, run } = lifecycle({ launch: failure })
  await expect(run()).rejects.toBe(failure)
  expect(calls).toEqual(['launch', 'stop'])
})

test('stops the preview when browser close fails', async () => {
  const failure = new Error('close failed')
  const { calls, run } = lifecycle({ close: failure })
  await expect(run()).rejects.toBe(failure)
  expect(calls).toEqual(['launch', 'body', 'close', 'stop'])
})

test('preserves launch and stop failures in occurrence order', async () => {
  const launch = new Error('launch failed')
  const stop = new Error('stop failed')
  const { calls, run } = lifecycle({ launch, stop })
  await expect(run()).rejects.toMatchObject({ errors: [launch, stop], cause: launch })
  expect(calls).toEqual(['launch', 'stop'])
})

test('preserves body, close and stop failures with the body failure as cause', async () => {
  const body = new Error('body failed')
  const close = new Error('close failed')
  const stop = new Error('stop failed')
  const { calls, run } = lifecycle({ body, close, stop })
  const outcome = await run().then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(outcome).toBeInstanceOf(AggregateError)
  const aggregate = outcome as AggregateError
  expect(aggregate.cause).toBe(body)
  expect(aggregate.errors).toHaveLength(3)
  expect(aggregate.errors[0]).toBe(body)
  expect(aggregate.errors[1]).toBe(close)
  expect(aggregate.errors[2]).toBe(stop)
  expect(calls).toEqual(['launch', 'body', 'close', 'stop'])
})

for (const stage of ['body', 'stop'] as const) {
  test(`preserves a single ${stage} failure unchanged`, async () => {
    const failure = new Error(`${stage} failed`)
    const { calls, run } = lifecycle({ [stage]: failure })
    await expect(run()).rejects.toBe(failure)
    expect(calls).toEqual(['launch', 'body', 'close', 'stop'])
  })
}

for (const stage of ['launch', 'body', 'close', 'stop'] as const) {
  test(`rejects even when ${stage} throws undefined`, async () => {
    const { calls, run } = lifecycle({ [stage]: undefined })
    const outcome = await run().then(
      () => ({ rejected: false }),
      (error: unknown) => ({ rejected: true, error }),
    )
    expect(outcome).toEqual({ rejected: true, error: undefined })
    expect(calls).toEqual(stage === 'launch' ? ['launch', 'stop'] : ['launch', 'body', 'close', 'stop'])
  })
}

test('waits for browser close before stopping and waits for preview stop before resolving', async () => {
  const calls: string[] = []
  const closing = Promise.withResolvers<void>()
  const stopping = Promise.withResolvers<void>()
  const closeStarted = Promise.withResolvers<void>()
  const stopStarted = Promise.withResolvers<void>()
  const browser = {
    close: async () => {
      calls.push('close')
      closeStarted.resolve()
      await closing.promise
      calls.push('closed')
    },
  } as Browser
  let finished = false
  const running = withPreviewBrowser(
    { launch: async () => browser },
    async () => {
      calls.push('body')
    },
    () => ({
      url: new URL('http://localhost:1234'),
      stop: async (force?: boolean) => {
        expect(force).toBe(true)
        calls.push('stop')
        stopStarted.resolve()
        await stopping.promise
        calls.push('stopped')
      },
    }),
  ).then(() => {
    finished = true
  })
  try {
    await closeStarted.promise
    expect(calls).toEqual(['body', 'close'])
    closing.resolve()
    await stopStarted.promise
    expect(calls).toEqual(['body', 'close', 'closed', 'stop'])
    expect(finished).toBe(false)
    stopping.resolve()
    await running
    expect(calls).toEqual(['body', 'close', 'closed', 'stop', 'stopped'])
    expect(finished).toBe(true)
  } finally {
    closing.resolve()
    stopping.resolve()
    await running
  }
})
