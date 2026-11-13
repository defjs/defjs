import { describe, expect, test, vi } from "vitest";
import {
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

  test("never reads application meta into span names or attributes", () => {
    const { tracer, spans } = createMockTracer();
    const options = { tracer, propagator: createMockPropagator() };

    for (const [name, meta] of [
      [undefined, { operation: "zz-meta-read" }],
      ["SSE", { id: "zz-meta-watch" }],
      ["WebSocket", { tag: 42 }],
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
    expect(
      spans.every(
        ({ attributes }) => !JSON.stringify(attributes).includes("zz-meta"),
      ),
    ).toBe(true);
  });
});
