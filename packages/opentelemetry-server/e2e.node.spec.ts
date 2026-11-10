import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";
import { describe, expect, inject, test } from "vitest";
import { withOpenTelemetryServer } from "./src/option";
import { createMockTracer } from "./src/test-utils";

describe("e2e: opentelemetry-server node transport", () => {
  test("a URL with credentials is rejected before it is sent and records one exception that carries only the type", async () => {
    const { tracer, spans } = createMockTracer();
    const host = inject("testServerHost");
    const client = createClient(
      withEndpoint(host.replace("http://", "http://svc-user:S3cretPassw0rd@")),
      withOpenTelemetryServer({ tracer }),
    );
    const useEcho = defineRequest({
      method: "GET",
      path: "/echo-headers",
      input: struct.object({ token: struct.string() }),
      builder: (input) => ({ query: { token: input.token } }),
    });

    const [error] = await useEcho(client, { token: "SECRET-QUERY-TOKEN" });

    expect(error).toMatchObject({ code: "REQ_BUILD_FAILED" });
    expect(spans).toHaveLength(1);
    const exceptions: unknown[] = [];
    for (const [exception] of spans[0]?.recordException.mock.calls ?? []) {
      exceptions.push(exception);
    }
    expect(exceptions).toHaveLength(1);
    expect(Object.getOwnPropertyNames(exceptions[0])).toEqual(["name"]);
  });
});
