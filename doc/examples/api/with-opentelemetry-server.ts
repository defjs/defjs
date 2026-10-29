// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

const tracer = trace.getTracer("orders-service");
const logger = logs.getLogger("@defjs/opentelemetry-server");
const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({ tracer, logger }),
);
// #endregion
