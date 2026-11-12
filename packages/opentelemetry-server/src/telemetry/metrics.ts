import type { Histogram, Meter, UpDownCounter } from "@opentelemetry/api";

const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

export interface HttpClientMetrics {
  requestDuration: Histogram;
}

export interface SSEClientMetrics {
  connectDuration: Histogram;
  connectionDuration: Histogram;
  activeStreams: UpDownCounter;
}

export interface WebSocketClientMetrics {
  connectDuration: Histogram;
  connectionDuration: Histogram;
  activeConnections: UpDownCounter;
}

export function createHttpClientMetrics(meter: Meter): HttpClientMetrics {
  return {
    requestDuration: meter.createHistogram("http.client.request.duration", {
      description: "Duration of HTTP client requests",
      unit: "s",
      advice: { explicitBucketBoundaries: [...DURATION_BUCKETS] },
    }),
  };
}

export function createSSEClientMetrics(meter: Meter): SSEClientMetrics {
  return {
    connectDuration: meter.createHistogram(
      "defjs.client.sse.connect.duration",
      {
        description: "Duration of SSE connection attempts",
        unit: "s",
        advice: { explicitBucketBoundaries: [...DURATION_BUCKETS] },
      },
    ),
    connectionDuration: meter.createHistogram(
      "defjs.client.sse.connection.duration",
      {
        description: "Duration of SSE stream connections",
        unit: "s",
        advice: { explicitBucketBoundaries: [...DURATION_BUCKETS] },
      },
    ),
    activeStreams: meter.createUpDownCounter(
      "defjs.client.sse.active_streams",
      {
        description: "Number of active SSE streams",
        unit: "{stream}",
      },
    ),
  };
}

export function createWebSocketClientMetrics(
  meter: Meter,
): WebSocketClientMetrics {
  return {
    connectDuration: meter.createHistogram(
      "defjs.client.websocket.connect.duration",
      {
        description: "Duration of WebSocket connection attempts",
        unit: "s",
        advice: { explicitBucketBoundaries: [...DURATION_BUCKETS] },
      },
    ),
    connectionDuration: meter.createHistogram(
      "defjs.client.websocket.connection.duration",
      {
        description: "Duration of WebSocket connections",
        unit: "s",
        advice: { explicitBucketBoundaries: [...DURATION_BUCKETS] },
      },
    ),
    activeConnections: meter.createUpDownCounter(
      "defjs.client.websocket.active_connections",
      {
        description: "Number of active WebSocket connections",
        unit: "{connection}",
      },
    ),
  };
}

export function durationSeconds(
  startMs: number,
  endMs: number = performance.now(),
): number {
  return (endMs - startMs) / 1000;
}
