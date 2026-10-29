// #region example
import { createRequire } from "node:module";
import type pino from "pino";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ConsoleLogRecordExporter,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { logs } from "@opentelemetry/api-logs";
import { createClient, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";

const sdk = new NodeSDK({
  logRecordProcessors: [
    new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() }),
  ],
  instrumentations: [new PinoInstrumentation()],
});
sdk.start();

try {
  const require = createRequire(import.meta.url);
  const createPino: typeof pino = require("pino");
  const appLogger = createPino({ level: "info" });
  const client = createClient(
    withEndpoint("https://api.example.com"),
    withOpenTelemetryServer({
      logger: logs.getLogger("@defjs/opentelemetry-server"),
    }),
  );
  appLogger.info("Order client ready");
  void client;
} finally {
  await sdk.shutdown();
}
// #endregion
