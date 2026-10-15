import { expect, spyOn, test } from 'bun:test'
import { context, ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { runWinstonLoggingExample } from '../examples/opentelemetry-logging/winston'

test('Winston and Defjs share a provider while retaining their own severity thresholds', async () => {
  const exporter = new InMemoryLogRecordExporter()
  const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] })
  const manager = new AsyncLocalStorageContextManager().enable()
  const output = spyOn(process.stdout, 'write').mockImplementation(() => true)
  const parent = { traceId: '11111111111111111111111111111111', spanId: '2222222222222222', traceFlags: TraceFlags.SAMPLED }
  const parentContext = trace.setSpanContext(ROOT_CONTEXT, parent)
  logs.setGlobalLoggerProvider(provider)
  context.setGlobalContextManager(manager)
  try {
    await context.with(parentContext, () => runWinstonLoggingExample(provider))
    await provider.forceFlush()
    const first = exporter.getFinishedLogRecords().slice()
    expect(first).toHaveLength(3)
    expect(first.map((record) => [record.body, record.severityNumber])).toEqual([
      ['Order created', 9],
      ['Inventory is low', 13],
      ['HTTP client request failed', 13],
    ])
    expect(first.map((record) => record.instrumentationScope.name)).toEqual([
      '@opentelemetry/winston-transport',
      '@opentelemetry/winston-transport',
      '@defjs/opentelemetry-server',
    ])
    for (const record of first) expect(record.spanContext).toEqual(parent)
    expect(first[2]?.attributes).toMatchObject({ 'exception.type': 'TypeError', 'defjs.phase': 'request', 'http.request.method': 'GET' })
    const consoleMessages = output.mock.calls.map(([line]) => JSON.parse(String(line)).message)
    expect(consoleMessages).toEqual(['Inspecting inventory', 'Order created', 'Inventory is low'])

    await context.with(parentContext, () => runWinstonLoggingExample(provider, 'error'))
    await provider.forceFlush()
    const additional = exporter.getFinishedLogRecords().slice(first.length)
    expect(additional).toHaveLength(1)
    expect(additional[0]).toMatchObject({
      body: 'HTTP client request failed',
      severityNumber: 13,
      instrumentationScope: { name: '@defjs/opentelemetry-server' },
      spanContext: parent,
    })
  } finally {
    try {
      await provider.shutdown()
    } finally {
      logs.disable()
      context.disable()
      output.mockRestore()
    }
  }
})
