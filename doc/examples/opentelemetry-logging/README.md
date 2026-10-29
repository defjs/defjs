# Winston and Defjs in one OpenTelemetry Logs pipeline

Run from the repository root after `bun install`:

```sh
bun doc/examples/opentelemetry-logging/winston.ts
```

The example uses real Winston, the official `OpenTelemetryTransportV3`, and an application-owned `LoggerProvider`. It deliberately fails a local `withHTTPHandle`, so it needs neither a Collector nor an external request. All dependencies are declared in the documentation workspace; no logging SDK is added to the Defjs library itself.

Business code keeps using Winston. Defjs receives `provider.getLogger('@defjs/opentelemetry-server')` through `withOpenTelemetryServer({ logger })`. The two paths share the provider and exporter:

| Record                  | Winston console   | OTel exporter |
| ----------------------- | ----------------- | ------------- |
| Business DEBUG          | Yes               | No            |
| Business INFO           | Yes               | INFO / 9      |
| Business WARN           | Yes               | WARN / 13     |
| Defjs transport failure | No Winston record | WARN / 13     |

The console transport is explicitly set to `debug`, and the OTel transport defaults to `info`. An explicit transport threshold overrides Winston's default logger level. These Winston thresholds do not control the native Defjs Logger. The SDK test runs the same example again with an OTel transport threshold of `error`: business INFO/WARN are then filtered, while the Defjs WARN still reaches the exporter. Apply a common processor or Collector filter for a policy shared by both paths.

The CLI uses `ConsoleLogRecordExporter`, so the terminal shows both ordinary Winston output and structured OTel records. In production, configure an OTLP exporter in the application instead. Do not enable another Winston automatic log-sending path or re-ingest the same console output unless duplication is intended.

`AsyncLocalStorageContextManager` carries a demonstration parent context with trace ID `11111111111111111111111111111111` and span ID `2222222222222222`. Both paths export those IDs in this logger-only example. These fixed IDs are for demonstration; production code uses the actual request context. When Defjs also receives a tracer, its diagnostic can reference an outbound child span while a business log references the parent span in the same trace.

`runWinstonLoggingExample(provider, otelLevel)` closes its own Winston logger after pending writes. The caller registers the global provider before the first record is logged (the transport resolves it lazily, so construction order does not matter) and owns `forceFlush()`, `shutdown()`, and context/global-provider cleanup. The CLI performs that cleanup even if the example fails. Defjs never initializes or shuts down your SDK.

Run the real SDK integration test:

```sh
cd doc && bun --bun vitest run --project doc-unit test/opentelemetry-logging.spec.ts
```

See the [English guide](../../content/en-US/docs/integrations/opentelemetry-server.mdx#logs-and-third-party-loggers) or [Chinese guide](../../content/zh-Hans/docs/integrations/opentelemetry-server.mdx#日志与第三方日志库) for severity mappings, diagnostic fields, lifecycle boundaries, and Pino setup. The Pino snippet is a Node.js instrumentation reference; this Bun example does not verify Pino automatic instrumentation.
