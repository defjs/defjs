import { describe, expect, test, vi } from "vitest";
import {
  createMockLogger,
  createMockMetrics,
  createMockPropagator,
  createMockTracer,
  makeHttpRequest,
} from "../../test/mocks";
import { method } from "../../test/method";
import { resolveHttpUrl } from "../telemetry/url";
import { startClientCall } from "./call";

describe("startClientCall", () => {
  test("redacts a url.full returned by startSpanHook", () => {
    const { tracer } = createMockTracer();

    startClientCall(
      {
        tracer,
        propagator: createMockPropagator(),
        startSpanHook: () => ({
          "url.full":
            "https://hook-user:HOOKSECRET@tenant.example/x?sig=HOOKSIG",
        }),
      },
      makeHttpRequest(),
      resolveHttpUrl,
      "GET",
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes?.[
        "url.full"
      ],
    ).toBe("https://REDACTED:REDACTED@tenant.example/x?sig=REDACTED");
  });

  test("leaves a non-string url.full from startSpanHook alone", () => {
    const { tracer } = createMockTracer();

    startClientCall(
      {
        tracer,
        propagator: createMockPropagator(),
        startSpanHook: () => ({ "url.full": 5 }),
      },
      { ...makeHttpRequest(), baseEndpoint: undefined },
      resolveHttpUrl,
      "GET",
    );

    expect(
      vi.mocked(method(tracer, "startSpan")).mock.calls[0]?.[1]?.attributes,
    ).toEqual({ "http.request.method": "GET", "url.full": 5 });
  });

  test("reports each meta key as a defjs.meta attribute with its value as given", () => {
    const { tracer, spans } = createMockTracer();
    const options = { tracer, propagator: createMockPropagator() };
    const owner = { team: "orders", tier: 1 };

    for (const [name, meta] of [
      [undefined, { operation: "orders.read", owner }],
      ["SSE", { tags: ["live", "orders"] }],
      ["WebSocket", { shard: 42, beta: false }],
    ] as const) {
      startClientCall(
        options,
        { ...makeHttpRequest(), endpoint: "/users/42", meta },
        resolveHttpUrl,
        "GET",
        name,
      );
    }

    expect(spans.map(({ name }) => name)).toEqual(["GET", "SSE", "WebSocket"]);
    expect(spans[0]?.attributes["defjs.meta.operation"]).toBe("orders.read");
    expect(spans[0]?.attributes["defjs.meta.owner"]).toBe(owner);
    expect(spans[1]?.attributes["defjs.meta.tags"]).toEqual(["live", "orders"]);
    expect(spans[2]?.attributes).toMatchObject({
      "defjs.meta.shard": 42,
      "defjs.meta.beta": false,
    });
  });

  test("an absent or empty meta adds no attributes", () => {
    const { tracer, spans } = createMockTracer();
    const options = { tracer, propagator: createMockPropagator() };

    for (const meta of [undefined, {}]) {
      startClientCall(
        options,
        { ...makeHttpRequest(), baseEndpoint: undefined, meta },
        resolveHttpUrl,
        "GET",
      );
    }

    expect(spans.map(({ attributes }) => Object.keys(attributes))).toEqual([
      ["http.request.method", "url.full"],
      ["http.request.method", "url.full"],
    ]);
  });

  test("startSpanHook attributes replace meta attributes", () => {
    const { tracer, spans } = createMockTracer();

    startClientCall(
      {
        tracer,
        propagator: createMockPropagator(),
        startSpanHook: () => ({ "defjs.meta.operation": "renamed" }),
      },
      { ...makeHttpRequest(), meta: { operation: "orders.read" } },
      resolveHttpUrl,
      "GET",
    );

    expect(spans[0]?.attributes["defjs.meta.operation"]).toBe("renamed");
  });

  test("meta is read for a logger without a tracer and skipped for metrics alone", () => {
    const req = { ...makeHttpRequest(), meta: { operation: "orders.read" } };
    const propagator = createMockPropagator();

    const logged = startClientCall(
      { propagator, logger: createMockLogger().logger },
      req,
      resolveHttpUrl,
      "GET",
    );
    const measured = startClientCall(
      { propagator, metrics: createMockMetrics() },
      req,
      resolveHttpUrl,
      "GET",
    );

    expect(logged.meta).toEqual({ "defjs.meta.operation": "orders.read" });
    expect(measured.meta).toEqual({});
    expect(measured.attributes).not.toHaveProperty("defjs.meta.operation");
  });
});
