// #region example
import {
  createClient,
  createResolvedRequestUrl,
  withEndpoint,
} from "@defjs/core";
import { withOpenTelemetryServer } from "@defjs/opentelemetry-server";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("orders-service");
const client = createClient(
  withEndpoint("https://api.example.com"),
  withOpenTelemetryServer({
    tracer,
    http: {
      startSpanHook(request) {
        const attributes = {
          "app.request.method": request.method,
        };
        if (!request.baseEndpoint) return attributes;
        const url = createResolvedRequestUrl(
          request.baseEndpoint,
          request.endpoint,
          request.query?.toString(),
        );
        url.searchParams.delete("access_token");
        return { ...attributes, "url.full": url.href };
      },
      requestHook(span, request) {
        span.setAttribute("app.request.started", true);
      },
      responseHook(span, response) {
        span.setAttribute("app.status", response.status);
      },
    },
    sse: { enabled: false },
    webSocket: { enabled: false },
  }),
);
// #endregion
