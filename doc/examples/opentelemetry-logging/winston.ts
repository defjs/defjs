import { once } from "node:events";
import {
  createClient,
  defineRequest,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { context, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import winston from "winston";

export async function runWinstonLoggingExample(
  loggerProvider: LoggerProvider,
  otelLevel: "info" | "error" = "info",
): Promise<void> {
  const appLogger = winston.createLogger({
    level: "debug",
    format: winston.format.json(),
    transports: [
      new winston.transports.Console({ level: "debug" }),
      new OpenTelemetryTransportV3({ level: otelLevel }),
    ],
  });

  try {
    appLogger.debug("Inspecting inventory", { orderId: "A100" });
    appLogger.info("Order created", { orderId: "A100" });
    appLogger.warn("Inventory is low", { orderId: "A100" });

    const client = createClient(
      withEndpoint("https://example.invalid"),
      withHTTPHandle(async () => {
        throw new TypeError("Local transport is unavailable");
      }),
      withOpenTelemetryServer({
        logger: loggerProvider.getLogger("@defjs/opentelemetry-server"),
      }),
    );
    const inventory = defineRequest({
      method: "GET",
      path: "/inventory",
      operation: "inventory.read",
    });
    const command = inventory();
    const [fault] = await client.execute(command);
    if (fault?.code !== "NET_UNREACHABLE") {
      throw new Error("Expected the local transport to return NET_UNREACHABLE");
    }
  } finally {
    const finished = once(appLogger, "finish");
    appLogger.end();
    try {
      await finished;
    } finally {
      appLogger.close();
    }
  }
}

if (import.meta.main) {
  const provider = new LoggerProvider({
    processors: [
      new SimpleLogRecordProcessor({
        exporter: new ConsoleLogRecordExporter(),
      }),
    ],
  });
  const manager = new AsyncLocalStorageContextManager().enable();
  logs.setGlobalLoggerProvider(provider);
  context.setGlobalContextManager(manager);

  // A request context is supplied by the application. This example needs no tracing SDK.
  const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: "11111111111111111111111111111111",
    spanId: "2222222222222222",
    traceFlags: TraceFlags.SAMPLED,
  });
  try {
    await context.with(parentContext, () => runWinstonLoggingExample(provider));
    await provider.forceFlush();
  } finally {
    try {
      await provider.shutdown();
    } finally {
      logs.disable();
      context.disable();
    }
  }
}
