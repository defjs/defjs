// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("orders-service");
const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({
    tracer,
    webSocket: { queryPropagation: true },
  }),
);
// #endregion
