// #region example
import { createClient, defineRequest, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("orders-service");
const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({ tracer }),
);
const readOrders = defineRequest({
  method: "GET",
  operation: "orders.read",
  path: "/orders",
});

const command = readOrders();
const outcome = await tracer.startActiveSpan("orders.command", async (span) => {
  try {
    const outcome = await client.execute(command);
    const [error] = outcome;
    if (error) {
      span.setAttribute("error.type", error.code);
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    return outcome;
  } finally {
    span.end();
  }
});

void outcome;
// #endregion
