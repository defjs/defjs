// #region example
import winston from 'winston'
import { logs } from '@opentelemetry/api-logs'
import { ConsoleLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport'
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'

const provider = new LoggerProvider({
  processors: [new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() })],
})
logs.setGlobalLoggerProvider(provider)

const appLogger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console({ level: 'debug' }), new OpenTelemetryTransportV3({ level: 'info' })],
})
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({ logger: provider.getLogger('@defjs/opentelemetry-server') }),
)

appLogger.debug('Preparing request')
appLogger.info('Order client ready')
void client
// #endregion
