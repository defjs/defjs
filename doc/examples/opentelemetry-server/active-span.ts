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
  meta: { operation: "orders.read" },
  path: "/orders",
});

const outcome = await tracer.startActiveSpan("orders.read", async (span) => {
  try {
    const outcome = await readOrders(client);
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
// #endregion
