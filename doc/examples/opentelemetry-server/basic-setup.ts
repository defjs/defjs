// #region example
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { metrics, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'

const tracer = trace.getTracer('orders-service')
const meter = metrics.getMeter('orders-service')
const logger = logs.getLogger('@defjs/opentelemetry-server')
const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer, meter, logger }))
const metricsOnlyClient = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ meter }))
const logsOnlyClient = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ logger }))

const [error] = await client.execute(readOrders())
if (error) console.error(error.code)
// #endregion
