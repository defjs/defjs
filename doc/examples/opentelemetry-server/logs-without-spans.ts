// #region example
import {
  createClient,
  defineRequest,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import {
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";

const provider = new LoggerProvider({
  processors: [
    new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() }),
  ],
});

async function main() {
  try {
    const client = createClient(
      withEndpoint("https://api.example.test"),
      withHTTPHandle(() => {
        throw new Error("Demonstration transport failure");
      }),
      withOpenTelemetryServer({
        logger: provider.getLogger("@defjs/opentelemetry-server"),
      }),
    );
    const readOrders = defineRequest({
      method: "GET",
      path: "/orders",
      meta: { operation: "orders.read" },
    });
    const [err] = await readOrders(client);
    if (err) {
      console.error(err.code);
      return;
    }
  } finally {
    await provider.shutdown();
  }
}

void main();
// #endregion
