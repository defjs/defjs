import { ERR_ABORTED as pluginAborted, ERR_TIMEOUT as pluginTimeout } from '@defjs/core'
import { describe, expect, test, vi } from 'vitest'
import { withOpenTelemetryServer } from '../option'
import { createMockLogger } from '../test-utils'

vi.resetModules()
const appCore = await import('@defjs/core')

describe('caller cancellation across two @defjs/core instances', () => {
  test('the second module instance and the plugin do not share sentinel identity', () => {
    expect(appCore.ERR_ABORTED).not.toBe(pluginAborted)
    expect(appCore.ERR_TIMEOUT).not.toBe(pluginTimeout)
  })

  test('does not log caller cancellation when the client comes from another core instance', async () => {
    const { logger, records } = createMockLogger()
    const abort = new AbortController()
    const client = appCore.createClient(
      appCore.withEndpoint('https://example.invalid'),
      appCore.withHTTPHandle(() => new Promise<Response>(() => undefined)),
      withOpenTelemetryServer({ logger }),
    )
    const pending = client.execute(appCore.defineRequest({ method: 'GET', path: '/inventory' })(), { abort: abort.signal })
    setTimeout(() => abort.abort(), 10)

    const [fault] = await pending
    expect(fault?.code).toBe('NET_ABORTED')
    expect(records).toEqual([])
  })

  test('still logs a timeout from another core instance', async () => {
    const { logger, records } = createMockLogger()
    const client = appCore.createClient(
      appCore.withEndpoint('https://example.invalid'),
      appCore.withHTTPHandle(() => new Promise<Response>(() => undefined)),
      withOpenTelemetryServer({ logger }),
    )

    const [fault] = await client.execute(appCore.defineRequest({ method: 'GET', path: '/inventory' })(), { timeout: 30 })
    expect(fault?.code).toBe('NET_TIMEOUT')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ eventName: 'http.client.request.exception', severityText: 'WARN' })
  })
})
