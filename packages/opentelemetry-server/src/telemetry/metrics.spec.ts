import type { Meter } from "@opentelemetry/api";
import { describe, expect, test, vi } from "vitest";
import {
  createHttpClientMetrics,
  createSSEClientMetrics,
  createWebSocketClientMetrics,
  durationSeconds,
} from "./metrics";
import { method } from "../../test/method";

describe("metrics helpers", () => {
  test("createHttpClientMetrics creates stable HTTP duration metric", () => {
    const meter = makeMeter();

    const metrics = createHttpClientMetrics(meter);

    const [histogramName, histogramOptions] =
      vi.mocked(method(meter, "createHistogram")).mock.calls[0] ?? [];
    expect(histogramName).toBe("http.client.request.duration");
    expect(histogramOptions?.unit).toBe("s");
    expect(
      Array.isArray(histogramOptions?.advice?.explicitBucketBoundaries),
    ).toBe(true);
    expect(metrics.requestDuration).toBe(histogram);
  });

  test("createSSEClientMetrics creates SSE custom metrics", () => {
    const meter = makeMeter();

    const metrics = createSSEClientMetrics(meter);

    expect(method(meter, "createHistogram")).toHaveBeenCalledWith(
      "defjs.client.sse.connect.duration",
      expect.objectContaining({ unit: "s" }),
    );
    expect(method(meter, "createHistogram")).toHaveBeenCalledWith(
      "defjs.client.sse.connection.duration",
      expect.objectContaining({ unit: "s" }),
    );
    expect(method(meter, "createUpDownCounter")).toHaveBeenCalledWith(
      "defjs.client.sse.active_streams",
      expect.objectContaining({ unit: "{stream}" }),
    );
    expect(metrics.connectDuration).toBe(histogram);
    expect(metrics.connectionDuration).toBe(histogram);
    expect(metrics.active).toBe(upDownCounter);
  });

  test("createWebSocketClientMetrics creates WebSocket custom metrics", () => {
    const meter = makeMeter();

    const metrics = createWebSocketClientMetrics(meter);

    expect(method(meter, "createHistogram")).toHaveBeenCalledWith(
      "defjs.client.websocket.connect.duration",
      expect.objectContaining({ unit: "s" }),
    );
    expect(method(meter, "createHistogram")).toHaveBeenCalledWith(
      "defjs.client.websocket.connection.duration",
      expect.objectContaining({ unit: "s" }),
    );
    expect(method(meter, "createUpDownCounter")).toHaveBeenCalledWith(
      "defjs.client.websocket.active_connections",
      expect.objectContaining({ unit: "{connection}" }),
    );
    expect(metrics.connectDuration).toBe(histogram);
    expect(metrics.connectionDuration).toBe(histogram);
    expect(metrics.active).toBe(upDownCounter);
  });

  test("durationSeconds uses explicit end time", () => {
    expect(durationSeconds(100, 250)).toBe(0.15);
  });

  test("durationSeconds defaults to performance.now", () => {
    vi.spyOn(performance, "now").mockReturnValue(350);

    expect(durationSeconds(50)).toBe(0.3);
  });
});

const histogram = { record: vi.fn() };
const upDownCounter = { add: vi.fn() };

function makeMeter(): Meter {
  return {
    createCounter: vi.fn(),
    createHistogram: vi.fn(() => histogram),
    createGauge: vi.fn(),
    createUpDownCounter: vi.fn(() => upDownCounter),
    createObservableCounter: vi.fn(),
    createObservableGauge: vi.fn(),
    createObservableUpDownCounter: vi.fn(),
    addBatchObservableCallback: vi.fn(),
    removeBatchObservableCallback: vi.fn(),
  };
}

const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

describe("histogram bucket isolation", () => {
  test("gives every histogram its own copy of the duration buckets", () => {
    const received: number[][] = [];
    const meter = makeMeter();
    vi.mocked(method(meter, "createHistogram")).mockImplementation(
      (_name, options) => {
        const buckets = options?.advice?.explicitBucketBoundaries;
        if (!buckets) throw new Error("expected explicitBucketBoundaries");
        received.push(buckets);
        return histogram;
      },
    );

    const http = createHttpClientMetrics(meter);
    const sse = createSSEClientMetrics(meter);
    const webSocket = createWebSocketClientMetrics(meter);

    expect(http.requestDuration).toBe(histogram);
    expect(sse.connectDuration).toBe(histogram);
    expect(sse.connectionDuration).toBe(histogram);
    expect(sse.active).toBe(upDownCounter);
    expect(webSocket.connectDuration).toBe(histogram);
    expect(webSocket.connectionDuration).toBe(histogram);
    expect(webSocket.active).toBe(upDownCounter);
    expect(
      vi
        .mocked(method(meter, "createHistogram"))
        .mock.calls.map((call) => call[0]),
    ).toEqual([
      "http.client.request.duration",
      "defjs.client.sse.connect.duration",
      "defjs.client.sse.connection.duration",
      "defjs.client.websocket.connect.duration",
      "defjs.client.websocket.connection.duration",
    ]);
    expect(
      vi
        .mocked(method(meter, "createHistogram"))
        .mock.calls.map((call) => call[1]),
    ).toEqual([
      {
        description: "Duration of HTTP client requests",
        unit: "s",
        advice: { explicitBucketBoundaries: received[0] },
      },
      {
        description: "Duration of SSE connection attempts",
        unit: "s",
        advice: { explicitBucketBoundaries: received[1] },
      },
      {
        description: "Duration of SSE stream connections",
        unit: "s",
        advice: { explicitBucketBoundaries: received[2] },
      },
      {
        description: "Duration of WebSocket connection attempts",
        unit: "s",
        advice: { explicitBucketBoundaries: received[3] },
      },
      {
        description: "Duration of WebSocket connections",
        unit: "s",
        advice: { explicitBucketBoundaries: received[4] },
      },
    ]);
    expect(received).toHaveLength(5);
    expect(new Set(received).size).toBe(5);
    for (const buckets of received) expect(buckets).toEqual(DURATION_BUCKETS);

    received[0]?.splice(0, 1, 999);
    received[0]?.push(42);
    for (const buckets of received.slice(1)) {
      expect(buckets).toEqual(DURATION_BUCKETS);
    }

    received.length = 0;
    createHttpClientMetrics(meter);
    createSSEClientMetrics(meter);
    createWebSocketClientMetrics(meter);
    expect(received).toHaveLength(5);
    expect(new Set(received).size).toBe(5);
    for (const buckets of received) expect(buckets).toEqual(DURATION_BUCKETS);
  });

  test("keeps the next histogram on the default buckets when the meter mutates the first array", () => {
    const received: number[][] = [];
    const meter = makeMeter();
    vi.mocked(method(meter, "createHistogram")).mockImplementation(
      (_name, options) => {
        const buckets = options?.advice?.explicitBucketBoundaries;
        if (!buckets) throw new Error("expected explicitBucketBoundaries");
        if (received.length === 0) {
          buckets[0] = 999;
          buckets.push(42);
        }
        received.push(buckets);
        return histogram;
      },
    );

    const sse = createSSEClientMetrics(meter);

    expect(sse.connectDuration).toBe(histogram);
    expect(sse.connectionDuration).toBe(histogram);
    expect(received[0]?.[0]).toBe(999);
    expect(received[0]).toContain(42);
    expect(received[1]).toEqual(DURATION_BUCKETS);
    expect(received[0]).not.toBe(received[1]);
  });
});
